# Loadbyton — Architecture

This document explains **how the system works**: the request path, the auth model, the core business state machines (job lifecycle, escrow, payouts), the retention/analytics layer, the admin console, and the security posture. It is the "explanation" companion to the endpoint and schema references in `API.md` and `DATA_MODEL.md`.

---

## 1. System overview

```
┌─────────────────────────── Web client ───────────────────────────┐
│  React 18 SPA (web/src)                                           │
│  lib/api.js (fetch, credentials:'include', error normalization)   │
│  lib/auth.jsx (AuthProvider, RequireAuth, GuestOnly, roleHome)    │
│  pages/*.jsx  components/Shell.jsx + ui.jsx                       │
└──────────────────────────────┬───────────────────────────────────┘
                               │  /api/*  (lb_session cookie)
                               ▼
┌─────────────────────────── Express API ──────────────────────────┐
│  server/index.js — thin bootstrap only: app.listen(), kicks off   │
│  seed()/ensureDemoLogins(), the outbox worker, and Socket.IO init.│
│  server/app.js does the real work: CORS/security headers, then    │
│  mounts ~27 route files from server/routes/*.js.                  │
│   ┌──────────┐  ┌────────────┐  ┌──────────────────────────────┐  │
│   │ auth()   │→ │ roles      │→ │ routes/*.js → controllers/ →  │  │
│   │ session  │  │ SHIPPER/   │  │ services/ → lib/ (business    │  │
│   │ cookie   │  │ CARRIER/   │  │ logic: state machines, escrow,│  │
│   │(middleware│  │ ADMIN      │  │ payouts, disputes, settings)  │  │
│   │/auth.js) │  │            │  │                               │  │
│   └──────────┘  └────────────┘  └──────────────────────────────┘  │
│  ├─ auto-release sweep + scheduled-job publisher — setInterval    │
│  │   loops in server/routes/system.routes.js, logic lives in      │
│  │   server/services/escrow.service.js and .../scheduling.service │
│  ├─ express.static(web/dist) — built SPA + assets                 │
│  ├─ SEO pages (/, /features, /pricing, /about, /blog, /security,  │
│  │   /compliance, /terms, /privacy) — server/app.js's SEO_META    │
│  └─ SPA fallback → index.html (deep links work)                   │
└──────────────────────────────┬───────────────────────────────────┘
                               │  server/db.js (unified DB abstraction)
                               ▼
              ┌────────────────┴──────────────────┐
              ▼                                    ▼
      SQLite (default, zero-config)        Postgres (USE_POSTGRES=true
      node:sqlite DatabaseSync, sync,       + DATABASE_URL) — Supabase
      WAL mode, FK ON                       Postgres in production
      server/schema.js — DDL + migrations   server/migrations/
      data/loadbyton.db                     postgres_init.sql (parallel
                                             schema, async pg.Pool)
```

Two processes for development, one process for production:
- **Dev:** Vite on `:5173` proxies `/api` to Express on `:4000`. HMR for the frontend.
- **Prod:** `npm run build` emits `web/dist`; Express serves it, so `http://localhost:4000` is the whole app (or Vercel serves the static build and rewrites `/api/*` to the Oracle Cloud-hosted API — see §9).

### 1.1 Dual database: SQLite and Postgres
`server/db.js` is a single abstraction both backends sit behind. By default (`USE_POSTGRES` unset) it opens a `node:sqlite` `DatabaseSync` at `DB_PATH` (default `server/data/loadbyton.db`) and runs `server/schema.js` — the single source of truth for the DDL, `CREATE TABLE IF NOT EXISTS` plus a long tail of idempotent `addColumn()` migrations run on every boot. Setting `USE_POSTGRES=true` with a `postgres://` `DATABASE_URL` switches to an async `pg.Pool` instead: on first boot it runs `server/migrations/postgres_init.sql`, a hand-maintained parallel schema that mirrors `schema.js` table-for-table (same ~34 tables), and every `?`-placeholder query the rest of the codebase writes is rewritten to Postgres's `$1,$2,...` form (plus a shim that translates SQLite's `datetime('now', …)` into the Postgres equivalent) so route/service code doesn't need two code paths. Both backends expose the same `db.prepare(sql).get/all/run` shape (synchronous on SQLite, `Promise`-returning on Postgres) and an async `db.query()`/`db.transaction()` pair. Production runs on Supabase-managed Postgres (see §9); SQLite remains the zero-config default for local dev, CI, and demo deploys.

---

## 2. Authentication & authorization

### Sessions, not JWTs
There are **no tokens in the browser**. On login:

1. `POST /api/auth/login` verifies the email/password against `users.password_hash` (bcrypt, `bcryptjs`).
2. On success it creates a row in `sessions` with a random `session_token` and a 7-day `expires_at`.
3. The token goes into the `lb_session` cookie as `HttpOnly; SameSite=Lax` (not `Secure` so plain-HTTP localhost works — flip that flag in a real TLS deployment).
4. The browser sends the cookie automatically on every request; `auth()` looks the token up and hydrates the user + profile.

`requireAuth` (the frontend guard) and the server `auth()` middleware are consistent about the shape: `req.user` is the DB user, `req.user.profile` the nested profile row.

### Roles
`users.role` ∈ `SHIPPER | CARRIER | ADMIN` (schema also allows `DRIVER`, currently unused). Route handlers declare their role allow-list:

```js
auth(['CARRIER'])                    // any verified/no special
auth(['SHIPPER'])
auth(['ADMIN'])
auth(['SHIPPER', 'CARRIER'])
```

### Account approval gate (new registrations are read-only)
Registration validates UAE identity data (phone must normalize to a UAE mobile/landline, TRN exactly 15 digits, trade licence 5–15 chars with ≥1 digit) and inserts the account with `account_approval_status = 'PENDING'`. The `auth()` middleware then enforces the **approval gate**: a `PENDING` account may browse (`GET`/`HEAD`/`OPTIONS`) and reach `/api/auth/*`, `/api/system/*`, `/api/profile`, `/api/notifications/*` — but **every workflow action 403s** until an admin approves the account in the queue (`GET /api/admin/approvals` → `POST /api/admin/approve/:id`, audited `ACCOUNT_APPROVE`). Admins and `APPROVED` accounts are unaffected; seeded demo accounts are pre-approved. This is the single choke point — new routes get the gate for free by using `auth()`.

### Login throttling
Per-email failed-login accounting in memory: after **8 failed attempts in 15 minutes** the email is locked out (429). This is in-process state (resets on restart) — a real deployment puts this in Redis/DB and adds IP-based limits.

### MFA (TOTP, zero dependencies)
`POST /api/auth/mfa/setup` returns a provisioning URL with a generated `mfa_secret` (stored in `users.mfa_secret`). `POST /api/auth/mfa/disable` turns it back off. Login honors `mfa_enabled`. The TOTP math is implemented inline (HMAC-SHA1 6-digit, 30-second window) — no `otplib` dependency.

### Profile
`PATCH /api/profile` updates the nested `profiles` row: company name, TRN, trade licence, phone, IBAN, coverage zones, fleet size, owned chassis, insurance flag. Note the API returns/consumes the nested shape `user.profile.phone`, `user.profile.companyName`, `user.profile.iban`, etc.

---

## 3. The core loop: a load moves

### 3.1 Job posting (SHIPPER)
`POST /api/jobs` creates a job in `DRAFT`… actually `OPEN` (unless `scheduledPostAt` is in the future, in which case it starts `DRAFT` and the scheduled-post publisher promotes it later — see §3.8). Payload: `shipmentType` (`IMPORT`/`EXPORT`/`LOCAL` — drives which leg-location fields apply), `containerSize` (20FT/40FT/40HC/REEFER), `containerType` (DRY/REEFER/HAZMAT/OPEN_TOP/FLAT_RACK), `cargoType` (10 values, default `GENERAL_GOODS`), `pickupTerminal`, `deliveryArea`, `deliveryAddress`, `readyAt`, `deadline`, `targetPriceAed` (per-trip target price; the DB column stays `max_budget_aed`), `equipmentType` (13 values incl. `CUSTOM` — a written `customRequirement` is required for `CUSTOM`; `REEFER_TRUCK` is gone, unknown values fall back to `CONTAINER_CHASSIS`), and `notes`. Reefer/hazmat needs are expressed through `containerType`/`cargoType`, not separate boolean flags — there is no `requires_reefer`/`requires_hazmat` column in the current schema. A unique human-readable `job_code` (e.g. `LBT-DXB-2608-4921`) is generated. Optionally it can carry `templateId`/`contractLaneId` to link a recurrence.

### 3.2 Bidding (CARRIER, verified only)
`POST /api/jobs/:id/bids`:
- **Guard:** `auth(['CARRIER'])` **and** `profile.isVerified` must be truthy and the job must be `OPEN`. Otherwise 403 with an explicit message ("Carrier verification required to bid."). (Both this and every other workflow action sit behind the account-approval gate — see §2.1.)
- **Body:** `amountAed` (a number), `etaMinutes` (1–600), `truckType`, `notes`. Creates a `bids` row in `PENDING`. **Driver name/phone are not collected here** — driver contact is shared only post-award, via `PATCH /api/jobs/:id/driver` (which fires the `job_awarded_pickup_details` notification).

### 3.3 Award (SHIPPER, idempotent + transactional)
`POST /api/jobs/:id/award` with `{ bidId }`:
- Runs inside a **single SQLite transaction** (synchronous driver = naturally serialized).
- Re-checks the job is `OPEN` and the bid exists and is `PENDING`, to prevent double-award races.
- Sets `jobs.status = 'AWARDED'`, `jobs.awarded_bid_id = bidId`, `jobs.carrier_id`, `jobs.agreed_price_aed`.
- Marks the bid `ACCEPTED`, others `REJECTED`.
- Sets **escrow to `HELD`** and creates the **payout row** (gross = agreed price, platform fee = `commission_rate_bps` bps, net = gross − fee, status `PENDING`).
- Writes the state transitions to `audit_log`.

### 3.4 Status state machine
`PATCH /api/jobs/:id/status` with `{ status }` is role- and order-enforced:

```
                SHIPPER                  CARRIER
DRAFT ──► OPEN ──► AWARDED ──► PICKED_UP ──► IN_TRANSIT ──► DELIVERED ──► COMPLETED
                  │            │              │
                  └── CANCELLED (from OPEN/AWARDED/DRAFT by shipper)
                                               └── CANCELLED (carrier, before pickup)
Any state ──► DISPUTED (via admin dispute console)
```

- Carriers can only advance **forward, one step at a time** (Q2 state-enforcement) and only while `AWARDED → PICKED_UP → IN_TRANSIT → DELIVERED`.
- Shippers can cancel an open job and can complete a delivered one.
- Every transition is written to `audit_log` with `before_state`/`after_state`.
- When a job enters a terminal state (`COMPLETED`/`CANCELLED`), the escrow row is updated accordingly and notifications fire.

### 3.5 Proof of delivery & the auto-release window
`POST /api/jobs/:id/pod` (CARRIER, job must be `IN_TRANSIT`):
- Accepts an optional `document` (a POD upload) and marks `delivered_at = now`, status `DELIVERED`.
- Starts the release clock: the escrow will become releasable `auto_release_hours` (default **24**, configurable to 48/72) after delivery, even if the shipper never confirms — the shipper's silent assent default. If a POD document is uploaded, the window behavior is anchored to `delivered_at` regardless.

`GET /api/jobs/:id/track` returns a live tracking view: the decorated `job`, `shipperName`/`carrierName`, `statusIndex` (position in the lifecycle), `canProgress`, `hoursSinceDelivered`, `autoReleaseAt`, and simplified geofence flags (`atPickup`/`atDelivery` vs the pickup terminal / delivery area). Demurrage/detention exposure is a separate call, `GET /api/jobs/:id/detention` (`server/routes/enterprise.routes.js`): free days from `jobs.detention_free_days` (default 5) against days since `delivered_at`, at a flat AED 400/day rate (there is no per-job `demurrage_rate_aed` column — the rate is hardcoded), returning `{ freeDays, rateAed, daysSinceDelivery, daysLeft, status, alarm }`.

### 3.6 Escrow states (the money)

```
PENDING ──► HELD ──► FUNDED ──► RELEASED
            │   (admin confirm   (shipper confirms,
            │    receipt: POST    or auto after
            │    /api/admin/      auto_release_hours)
            │    confirm-receipt)
            └──► DISPUTED (admin opens dispute → escrow frozen)
```

- `HELD` on award (price is earmarked). `FUNDED` when an admin confirms the funds actually arrived (`/api/admin/confirm-receipt`). `RELEASED` when released — manually by the shipper confirming delivery, or by the auto-release sweep.
- If a dispute exists, the escrow status is forced to `DISPUTED` and it is **frozen** — no payout moves until the admin resolves it (see §6).

### 3.7 Payouts and payment providers
One `payouts` row per awarded job, created at award time:
- `gross_aed` = agreed price; `platform_fee_aed` = round(gross × commission_rate_bps / 10000); `net_aed` = gross − fee.
- `status`: `PENDING → RELEASED | HELD | CANCELLED`.
- `release_type`: `MANUAL` (shipper/admin confirms), `AUTO` (the sweep in §3.8), or `DISPUTE_RESOLUTION` (admin dispute decision).
- Released payouts feed the carrier's `GET /api/earnings` page.

**Payment providers** (`server/lib/payments.js`, selected via `PAYMENTS_PROVIDER`):
- `internal` (default, unset) — escrow is pure internal bookkeeping; nothing here talks to a processor.
- `mock` — a simulated processor with an in-process ledger; `POST /api/webhooks/payments` (HMAC-signed with `PAYMENTS_WEBHOOK_SECRET`) drives the same confirm/refund/payout code paths a real processor would, so the whole escrow→fund→release→refund flow is testable end-to-end with zero credentials.
- `telr` — real charges and refunds via Telr's hosted checkout/gateway (`TELR_STORE_ID`/`TELR_AUTH_KEY`); carrier payouts via Telr are not yet implemented (`executePayout()` returns `not_implemented`), so released payouts still go through the admin "mark-transferred" flow in this mode.
- `stripe` — a live Stripe Connect marketplace integration (`server/lib/stripe.js`, `STRIPE_SECRET_KEY`). `createCheckoutOrder()` opens a hosted Stripe Checkout session; `checkout.session.completed`/`payment_intent.succeeded` webhooks fund escrow; `refundCharge()` calls Stripe Refunds; and **`executePayout()` calls Stripe's `createTransfer()` — a real Connect transfer to the carrier's onboarded account** (`profiles.processor_account_id`, provisioned via `POST /api/stripe/connect/onboard`). This is the path `POST /api/jobs/:id/release-payout` (`server/routes/stripe.routes.js`) uses in production — it is not a DB status flip.

**Payout safety on the Stripe path**: `release-payout` requires **HSM multi-sig** — 2-of-3 HMAC signatures (`x-hsm-sigs` header, verified against `HSM_SECRET` keys in `server/lib/hsm.js`; auto-passes only when no HSM keys are configured at all, and fails closed on a partial 1-key config) — before it will call `createTransfer()`. Every release/hold also writes a **hash-chained ledger** entry on the job (`jobs.ledger_hash`/`prev_ledger_hash`, `sha256(prevHash|jobId|action|amount|timestamp)`), and the actual transfer is guarded by a unique `payout_attempts.idempotency_key` per attempt so a race between two release requests can only ever execute one real transfer.

### 3.8 The auto-release sweep and the scheduled-post publisher
Two `setInterval` loops live in `server/routes/system.routes.js`, started at module load (so once per process boot):

- **Auto-release sweep** (every 10 minutes): calls `runAutoReleaseSweep()` in `server/services/escrow.service.js`, which finds jobs with `status = 'DELIVERED'`, `escrow_status IN ('HELD','FUNDED')`, and `delivered_at` older than `auto_release_hours`. For each it sets `escrow_status = 'RELEASED'`, stamps `payout_released_at`, marks the payout `RELEASED` with `release_type = 'AUTO'` and a 48h `sla_deadline`, writes an `ESCROW_AUTO_RELEASE` audit entry, and notifies both parties. A manual trigger is also exposed (`POST /api/system/auto-release`, admin-only or `x-internal-key`) so tests/cron can force a pass.
- **Scheduled-post publisher** (every 60 seconds): calls `publishScheduledJobs()` in `server/services/scheduling.service.js`, which promotes jobs whose `jobs.scheduled_post_at` has passed from a scheduled/draft state into `OPEN` so they start receiving bids without a human clicking publish. Also exposed manually via `POST /api/system/publish-scheduled` under the same auth rule.

---

## 4. Retention layer

The strategy doc (`docs/STRATEGY.md`) identifies "one-and-done" as the killer; these features are the anti-churn layer:

- **Templates** (`/api/templates`): a shipper saves a repeat lane (terminal, area, address, container, cadence `ONCE|WEEKLY|BIWEEKLY|MONTHLY`). `POST /api/templates/:id/rerun` clones it into a fresh job in one call.
- **Contract lanes** (`/api/contracts`): committed monthly volume per lane (`monthly_loads`, `target_price_aed`). Carriers get priority visibility of these jobs. The route is SHIPPER-scoped.
- **Analytics** (`/api/analytics/mine`): role-aware dashboards.
  - CARRIER: `totalBids`, `jobsWon`, `paidOutAED`, `pendingAED`, `rating`, `onTime`, `tier`.
  - SHIPPER: spend/savings (`totalSpentAED`, `savingsPercent`), plus bid/on-time aggregates.
  - ADMIN: sees the operations view via `/api/admin/*`.
- **Loyalty tiers**: `BRONZE → SILVER → GOLD` on `users.tier`, surfaced in the UI and seed data.
- **Referrals**: `referral_code`/`referred_by` columns; registration accepts a `referralCode` param.
- **Notifications**: `notifications` table; `GET /api/notifications` (unread first) and `POST /api/notifications/:id/read`. Fired on award, status change, new bid, payout release, verification outcome, disputes, etc.

---

## 5. Public data product & SEO

- `GET /api/public/lanes` — the **unified lane index** (6 canonical lanes built from `unifiedLanes` in `server/lib/lanes.js`, consumed by `server/routes/public.routes.js`: terminal ↔ area, base price, per-km rate, distance, base minutes, on-time percentage). Feeds the landing page "Lane Index" table (the old rate estimator and route optimizer were removed in the same pass). Aggregated only — never a single shipper's rate.
- `GET /api/public/carriers` — verified-carrier directory: name, rating, completed jobs, fleet size, licence status badge, coverage zones. **No phone/email/TRN/driver names** (contact gating).
- `GET /api/public/market` — market pulse stats (live loads, open loads, carriers online, escrow held).
- **SEO pages**: `/`, `/features`, `/pricing`, `/about`, `/blog`, `/security`, `/compliance`, `/terms`, `/privacy` are all keyed in `server/app.js`'s `SEO_META` map and rendered via `renderSeoHtml` — it injects title/description/Open Graph/Twitter meta (and a canonical URL) into `web/dist/index.html` and serves it, so marketing/legal pages are crawlable without the SPA. A route with a matching prerendered file under `web/dist/__prerendered__/` also gets its markup inlined into `#root`. All other non-`/api` GETs fall back to `index.html` (deep links work). The Vercel-static deploy path covers the same list independently via `web/scripts/vercel-static-seo.mjs` — keep both in sync.

---

## 6. Admin console

- **Verification queue**: `GET /api/admin/verification` lists unverified carriers. `POST /api/admin/verify/:id` with `{ action: 'approve'|'reject', iban? }` — approve requires an IBAN (payout destination), records `verified_at`, audits, notifies. This is the gate that unlocks bidding.
- **System health**: `GET /api/admin/health` — open jobs, total bids, avg bids/job, completion rate, escrow held, open disputes, plus live lane health from the unified index.
- **Audit log**: `GET /api/admin/audit` — last 100 entries. The table is **append-only**: DB triggers raise `ABORT` on any `UPDATE`/`DELETE` (see `DATA_MODEL.md`).
- **Disputes**: `GET /api/admin/disputes` (list), `POST /api/admin/disputes` (open one — sets job + escrow to `DISPUTED`), `POST /api/admin/disputes/:id/resolve` with a determination and decision `RELEASE_TO_CARRIER | REFUND_SHIPPER | SPLIT` (releases/freezes the payout accordingly), and `GET /api/admin/evidence/:jobId` (the evidence package: job, bids, docs, messages, ratings, audit trail — the "dispute dossier").
- **Revenue**: `GET /api/admin/revenue` — GMV, platform fees (take-rate realization), escrow held, average take rate.
- **Settings**: `GET/PATCH /api/admin/settings` — `commission_rate_bps` (0–10000) and `auto_release_hours` (1–168). These power the escrow/payout math everywhere.

---

## 7. Security posture

| Concern | Implementation |
|---|---|
| Password storage | bcrypt (bcryptjs, cost 10) |
| Session transport | HttpOnly cookie, 7-day expiry, DB-backed, cleaned on boot |
| Auth throttling | Per-email in-memory failure counter (`server/middleware/auth.js`): **8 failed attempts in a 15-minute window** locks the email out (429). Single threshold — no separate "soft" cap. Resets on process restart; a real deployment moves this to Redis/DB and adds IP-based limits. |
| 2FA | Optional TOTP (zero-dep inline implementation) |
| Authorization | Role allow-lists on every route handler, not just the UI |
| Verification gate | Unverified carriers get 403 on bidding, server-side |
| Contact gating | Public carrier directory strips PII; server-side, not UI-hidden |
| Idempotent awards | Single transaction, `OPEN`+`PENDING` re-check, no double-award |
| Immutable audit | SQLite triggers forbid UPDATE/DELETE on `audit_log` |
| Escrow safety | `DISPUTED` freezes payouts; release types recorded |
| Request tracing | `x-request-id` header generated/echoed; carried into audit entries |
| Headers | Helmet-style security headers + CSP on the HTML responses |
| Money | Depends on `PAYMENTS_PROVIDER` (see §3.7): `internal`/unset and `mock` are DB-only bookkeeping with no real money movement; `stripe` and `telr` move real funds. In `stripe` mode, `POST /api/jobs/:id/release-payout` calls Stripe Connect's `createTransfer()` for real — see `server/lib/stripe.js`, `server/routes/stripe.routes.js` |

---

## 8. Frontend architecture

- **Entry**: `main.jsx` → `BrowserRouter` → `App.jsx`.
- **App.jsx** declares the route table with guards: `RequireAuth` (redirects to `/login` unless `useAuth().user`), `GuestOnly` (logged-in users skip login/register), and `roleHome` (role-aware home redirect: SHIPPER → dashboard, CARRIER → open loads, ADMIN → admin console).
- **lib/api.js**: thin fetch wrapper — sets `credentials: 'include'`, JSON body serialization, throws `ApiError` with the backend's `{ error }` message, exports typed helpers for every endpoint.
- **lib/auth.jsx**: `AuthProvider` fetches `/api/auth/me` once at boot (sets loading), exposes `login()` / `register()` / `logout()` that update React state (this is what makes the "logged in" experience work — the UI never reads `localStorage` for auth).
- **lib/seo.jsx**: `usePageTitle`/`useMeta` set `document.title` and meta tags per route.
- **components/Shell.jsx**: layout chrome — top nav (role-aware links + user menu + logout), footer.
- **components/ui.jsx**: the design-system kit — `Button` (primary/secondary/ghost/danger/outline), `Card` (+Header/Title/Content/Footer), `Badge` (color variants), `Input`, `Textarea`, `Select`, `Label`, `Spinner`, `EmptyState`, `Stat`.
- **Design tokens**: Tailwind config + `index.css` define primitives (primary `#1e40af`, secondary `#3b82f6`, card surface, dark background `#0a0e17`) with `[data-theme="dark"]`/`[data-theme="light"]` overrides. Typography: **Inter** (body) + **Manrope** (display) via Google Fonts. Component classes: `.card`, `.btn-primary`, `.btn-secondary`, `.nav`, `.section`, `.container`, `.grid-responsive`, `.prose`.

---

## 9. File storage and deployment topology

### 9.1 File storage: S3/R2 with local-disk fallback
`server/lib/storage.js` is a storage abstraction with the same fail-safe shape as the payments/email/WhatsApp integrations: it works out of the box with zero credentials (documents land on local disk under `UPLOADS_DIR`, next to the SQLite DB) and goes live the moment S3-shaped env vars are set — nothing else in the codebase touches S3 directly.
- Setting `S3_BUCKET` (+ `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, or falling back to the AWS SDK's default credential chain) switches uploads to S3-compatible object storage via `@aws-sdk/client-s3`.
- Setting `S3_ENDPOINT` alongside it targets **Cloudflare R2** specifically (forces `region: 'auto'` and path-style addressing) — this is the production storage target, paired with Oracle Cloud/Vercel in §9.2.
- `getPresignedUploadUrl()` issues short-lived (5 min) presigned `PutObject` URLs so the browser can upload documents straight to R2 without routing the bytes through the Node process — the mitigation for upload/IOPS pressure under load; it returns `null` when S3 isn't configured, and callers fall back to the base64-body upload path used by `POST /api/jobs/:id/documents`/`/pod`.
- `job_documents.storage_path`/`mime_type` (and the equivalent columns on `drivers`/`profiles` for licence/insurance docs) record the key; `getFile()`/`fileExists()` abstract reads the same way regardless of backend.

### 9.2 Deployment topology
Three deploy targets exist in the repo; only one is the real production path:

| Target | Role | Config |
|---|---|---|
| **Vercel** | Production frontend | `vercel.json` — static-builds `web/dist` and rewrites `/api/:path*` to `https://api.loadbyton.com/api/:path*`, so the SPA and API appear same-origin to the browser even though they're hosted separately. |
| **Oracle Cloud** (Always Free, `me-abudhabi-1`) | Production backend | `deploy/oracle-cloud/` — a single Arm VM (Docker + the app's own `Dockerfile`) behind a reverse proxy (Caddy/nginx) for TLS, with a persistent block volume mounted at `/data`. Chosen specifically for UAE data residency (TRN/IBAN/driver-phone PII staying in-region) and because it's the only free tier offering both a UAE region and persistent disk. Single instance/single disk — an MVP/pilot deployment, not yet HA. |
| **Supabase Postgres** | Production database | Reached via `USE_POSTGRES=true` + `DATABASE_URL` (Supavisor pooled connection) as described in §1.1; `DIRECT_DATABASE_URL` is used only by `scripts/backup-db.js`'s `pg_dump`. |
| **Cloudflare R2** | Production file storage | `S3_BUCKET` + `S3_ENDPOINT` per §9.1. |
| **Render** | Disposable demo path only | `render.yaml` — one Express service serving both API and SPA. Its free plan has no UAE/GCC region and no persistent disk (the SQLite file resets on every restart/redeploy), so it's wired for a paid `starter` plan + Frankfurt + a persistent disk as the "least-bad" option, or the same env vars used to point it at Postgres/R2/Redis instead — but it is documented as a demo/alternative target (see `docs/DEMO_DEPLOY.md`), never where real shipper/carrier data should live. |

Local dev and CI default to SQLite + local disk with no cloud dependencies at all.

---

## 10. Key flows end-to-end (where to read the code)

| Flow | Server | Client |
|---|---|---|
| Register / login / MFA / me | `server/routes/auth.routes.js`, `server/middleware/auth.js` | `web/src/pages/Login.jsx`, `Register.jsx` |
| Post job → award | `server/routes/jobs.routes.js`, `job-lifecycle.routes.js` | `Dashboard.jsx`, `JobDetail.jsx` |
| Carrier bid | `POST /api/jobs/:id/bids` (`job-lifecycle.routes.js`); withdraw/mine in `bids.routes.js` | `OpenLoads.jsx`, `JobDetail.jsx` |
| Status + POD + track | `job-lifecycle.routes.js` | `JobDetail.jsx` |
| Escrow + payout | `jobs.routes.js` (award), `stripe.routes.js` (pay/release-payout), `services/escrow.service.js` (auto-release sweep), `admin.routes.js` (confirm-receipt/disputes) | `Earnings.jsx`, `Dashboard.jsx` |
| Analytics | `GET /api/analytics/mine` (`retention.routes.js`) | `Dashboard.jsx` |
| Admin ops | `admin.routes.js` | `Admin.jsx` |
| SEO pages | `server/app.js`'s `SEO_META`/`renderSeoHtml` | `Features.jsx` etc. |
| File uploads | `server/lib/storage.js`, `documents.routes.js` | document upload widgets |
| Audit chain | `server/routes/audit.routes.js` | `Admin.jsx` audit tab |

See `API.md` for the full route/request/response reference and `DATA_MODEL.md` for the schema.
