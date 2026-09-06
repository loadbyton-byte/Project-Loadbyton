# Loadbyton

**UAE Road Freight & Container Drayage Marketplace** — a full-stack platform that connects **shippers** who need a container, a flatbed load, or a multi-truck job moved across Dubai, Abu Dhabi, Sharjah, or Fujairah with **carriers** who truck them (across 13 equipment types, from a container chassis to a genset trailer to custom loads), and gives **admins** a verification, escrow and dispute console.

Built as a monorepo: an Express API (Node 22, dual DB — `node:sqlite` for dev + Postgres `pg` for production) and a React + Vite + Tailwind single-page app. Runs locally with `npm install` only; production uses Postgres + Redis + S3 via `docker-compose.yml`.
Deps: `express` 5, `pg` (opt-in via `USE_POSTGRES`), `ioredis` (rate limiting), `socket.io` (live tracking/notifications), `stripe` (Connect payouts), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (R2/S3 uploads), `@sentry/node` (error tracking), `zod` (validation), `bcryptjs`, `swagger-ui-express`.

> Escrow + payouts are double-entry ledger-backed (`server/lib/ledger.js` + `ledger_*` tables) with Stripe Connect + Telr + mock providers (`server/lib/payments.js`). Mock mode runs end-to-end without keys; licensed rails activate via env.

---

## What it does, in one paragraph

A shipper posts a drayage job (container size/type, pickup terminal, delivery area/address, ready time, deadline, budget). Verified carriers bid with a price (AED) and an ETA. The shipper awards one bid; the platform holds the agreed amount in **escrow**, charges a commission (default 6%), and tracks the job through `AWARDED → PICKED_UP → IN_TRANSIT → DELIVERED`. The carrier uploads proof of delivery; the payout is released either when the shipper confirms, or automatically 24 hours after delivery (configurable). Admins verify carriers, move escrow `HELD → FUNDED`, resolve disputes, adjust commission/auto-release settings, and audit every action.

---

## Feature map

| Area | What's built |
|---|---|
| **Auth** | Register (shipper/carrier, TRN, trade licence, referral codes), login with session cookie, logout, profile update, TOTP 2FA, per-email login throttling (8 fails / 15 min) |
| **Marketplace core** | Post job, browse open loads, bid (price + ETA), award (idempotent, transactional), job status state machine, live tracking, per-job messaging, document/POD upload, ratings |
| **Escrow & payouts** | `PENDING → HELD (award) → FUNDED (admin confirm) → RELEASED (shipper confirm or 24 h auto)`, disputes freeze escrow; payout rows with gross/fee/net + release type |
| **Retention layer** | Recurring job **templates** (with one-click re-post), **contract lanes** (committed monthly volume), role-based **analytics** (monthly trend, status breakdown, top lanes), loyalty **tiers**, **referrals** (with admin visibility), **notifications** (8 toast types via a shared `ToastProvider`, persistent notifications page) |
| **Enterprise lane** | RFP/contract-lane bidding with monthly milestones (`contract_rfps`), basic EDI ingestion (EDI 304/310, Cargo-XML → `global_consignments`), customs compliance declarations (HS code + simulated ZKP manifest commitment), driver fleet roster + driver-seat logins, hardware telematics ingestion, branded PDF-style documents (load confirmation, POD certificate, settlement statement, EIR summary, dispute notice) |
| **Admin console** | Carrier verification queue (approve with IBAN, reject), all-members directory with role/verified/search filters, audited time-limited impersonation, system health, revenue/GMV, escrow held, disputes + evidence dossier, payout SLA tracker, audit log (hash-chained, tamper-evident), platform settings |
| **Marketing/SEO** | Landing page + features/pricing/about/blog/security/compliance/terms/privacy pages, all server-injected meta tags and prerendered, favicon, Open Graph/Twitter cards |
| **Brand** | Hand-authored SVG mark + wordmark, 3-layer design-token system (primitive → semantic → component), light/dark themes with a nav toggle |
| **Onboarding** | 3-step first-login walkthrough, re-startable from Profile |

---

## Repository layout

```
Project-Loadbyton/
├── README.md                 # this file
├── CONTRIBUTING.md           # contributor guide + branch workflow
├── LICENSE                   # MIT license
├── deploy/
│   ├── oracle-cloud/          # production backend host — Dockerfile + README
│   └── vercel/                # production frontend host — README
├── docs/
│   ├── STRATEGY.md            # execution strategy & gap analysis
│   ├── STRATEGIC_REVIEW.md    # investor/CEO/engineering read on the build
│   ├── ARCHITECTURE.md        # how the system works (deep dive)
│   ├── API.md                 # REST endpoint reference
│   ├── DATA_MODEL.md          # database schema reference
│   ├── DEVELOPER_GUIDE.md     # setup, run, build, troubleshoot
│   ├── DEMO_DEPLOY.md         # spin up a live demo (Render blueprint)
│   ├── TUTORIAL.md            # end-to-end walkthrough of a load lifecycle
│   ├── PAYMENTS.md            # payment provider modes (mock/telr/stripe/internal)
│   ├── DISASTER_RECOVERY.md   # backups, restore, incident playbook
│   ├── ENTERPRISE_AUDIT.md    # audit log of production-readiness fixes
│   ├── ROADMAP.md             # shipped / next / known limits
│   ├── enterprise-roadmap.md  # longer-horizon technical roadmap
│   ├── GOOGLE_MAPS_SETUP.md   # optional Places Autocomplete API key
│   ├── WHATSAPP_SETUP.md      # WhatsApp Business API setup (gated on Meta approval)
│   ├── openapi.yaml           # machine-readable API spec
│   ├── brand/
│   │   ├── BRAND_GUIDELINES.md
│   │   ├── design-tokens.json
│   │   └── design-tokens.css
│   └── enterprise/             # deeper technical notes (multi-region, hardening)
├── server/                   # Express API (Node 22), port 4000
│   ├── index.js                # boot only — app.listen(), outbox worker, socket init
│   ├── app.js                  # Express app + middleware + all route mounting
│   ├── schema.js                # SQLite DDL + migrations (source of truth for dev)
│   ├── db.js                    # DB connection abstraction (SQLite or Postgres)
│   ├── seed.js                  # idempotent demo seeding
│   ├── routes/                  # ~27 route files (jobs, bids, stripe, rfp, edi, telematics, …)
│   ├── controllers/, services/, repositories/  # business logic layers
│   ├── lib/                     # stripe.js, payments.js, ledger.js, storage.js, whatsapp.js, …
│   ├── middleware/               # auth.js, validate.js
│   ├── workers/outbox.worker.js  # outbox-pattern async event processor
│   ├── migrations/               # postgres_init.sql + numbered production migrations
│   └── data/loadbyton.db         # SQLite DB (WAL mode, auto-created, gitignored, dev only)
└── web/                       # React 18 + Vite + Tailwind 3 SPA
    ├── index.html
    ├── vite.config.js          # dev port 5173, /api proxy → :4000
    ├── tailwind.config.js      # design tokens (primary/secondary/accent/…)
    ├── postcss.config.js
    └── src/
        ├── main.jsx            # entry, BrowserRouter, AuthProvider, ToastProvider
        ├── App.jsx             # routes + auth guards
        ├── index.css           # design tokens + component classes
        ├── lib/                # api.js, auth.jsx, seo.jsx, constants.js, googleMaps.js
        ├── components/         # Shell.jsx, ui.jsx, icons.jsx, Toast.jsx, LiveMap.jsx
        └── pages/               # 32 pages — Landing, Login, Register, Dashboard,
                                  # OpenLoads, MyBids, WonJobs, JobDetail, JobHistory,
                                  # JobDispute, Templates, Contracts, Analytics, Earnings,
                                  # Invoices, Compliance, DocumentCompliance, Drivers,
                                  # DriverHome, Messages, Notifications, Admin (+ 11 tabs),
                                  # Profile, Security, Features, Pricing, About, Blog,
                                  # Terms, Privacy, ForgotPassword, ResetPassword,
                                  # VerifyEmail, NotFound
```

---

## Quick start

Requirements: **Node 22+** (the backend uses the built-in `node:sqlite` module; earlier versions will not work).

```bash
# 1. Backend — API on :4000 (also serves the built SPA in production)
cd server
npm install
node index.js

# 2. Frontend — dev server on :5173 (proxies /api to :4000)
cd ../web
npm install
npm run dev
```

Open **http://localhost:5173** for development, or build (`cd web && npm run build`) and use **http://localhost:4000** for the production build served by Express.

The database seeds itself on first boot (see `server/seed.js`). To start clean, stop the server and delete `server/data/loadbyton.db*`.

### Demo accounts (all password `demo1234`)

| Role | Email | Notes |
|---|---|---|
| Shipper | `shipper@jebelalilogistics.ae` | Al-Majid Global Freight, SILVER |
| Carrier | `carrier@dubaidrayage.com` | Emirates Overland Haulage, GOLD, verified |
| Carrier | `falcon@containerxpress.ae` | Falcon Container Express, SILVER, verified |
| Carrier | `gulfheavy@fleet.ae` | Gulf Heavy Transport, GOLD, verified |
| Carrier | `desertline@drayage.ae` | **Unverified** — cannot bid until an admin approves |
| Admin | `admin@loadbyton.ae` | Full admin console |

### Key ports & config

- **API**: `http://localhost:4000` (`PORT` env override)
- **Dev SPA**: `http://localhost:5173`
- **DB path**: `server/data/loadbyton.db` (`DB_PATH` env override)
- **CORS origin**: `http://localhost:5173` (`FRONTEND_URL` env override)
- **Auto-release sweep**: in-process every 10 minutes, plus `POST /api/system/auto-release` (admin or `x-internal-key`)
- **Default commission**: 600 basis points (6%), key `commission_rate_bps`
- **Default auto-release window**: 24 h, key `auto_release_hours`

---

## How it fits together

```
Browser (React SPA, hosted on Vercel in production)
   │  fetch('/api/…') with HttpOnly lb_session cookie
   ▼
Vercel rewrite (/api/* → Oracle Cloud) — dev: Vite proxies /api → :4000
   ▼
Express API  :4000  (server/app.js + server/routes/*.js, Oracle Cloud in prod)
   │
   ├─►  node:sqlite (dev) or Postgres via Supabase (prod, USE_POSTGRES=true)
   ├─►  Cloudflare R2 / S3-compatible storage (uploads — local disk fallback in dev)
   ├─►  Stripe Connect / Telr (escrow + payouts — mock/internal fallback with no keys)
   ├─ express.static(web/dist)   serves the SPA + assets directly when not on Vercel
   ├─ SEO routes (/, /features, /pricing, /about, /security, /compliance, /blog,
   │              /terms, /privacy) — meta-injected, prerendered HTML
   └─ SPA fallback — any non-/api GET returns index.html (deep links work)
```

- **Auth is session-cookie based, no JWT.** The client only ever holds an opaque random token in the `lb_session` HttpOnly cookie. Sessions live in the DB, expire after 7 days, and are cleaned on startup.
- **Every protected route reads the session from the cookie** via the `auth()` middleware, which also enforces role allow-lists (`auth(['SHIPPER'])`, `auth(['ADMIN'])`, …).
- **In production, the SPA and API are two separate hosts** — Vercel serves `web/dist` and rewrites `/api/*` to the Oracle Cloud-hosted Express API (`vercel.json`). Locally, Express can also serve `web/dist` directly as one process on one port, which is what happens in a plain `docker-compose`/single-VM deploy.

See `docs/ARCHITECTURE.md` for the deep dive, `docs/API.md` for the full endpoint reference, `docs/DATA_MODEL.md` for the schema, `docs/DEVELOPER_GUIDE.md` for setup/troubleshooting, and `docs/TUTORIAL.md` to click through the whole product as a demo. `docs/STRATEGY.md` and `docs/STRATEGIC_REVIEW.md` are the business case.

---

## Production readiness — enterprise checklist

| Area | Status | Detail |
|---|---|---|
| **DB** | ✅ Dual | SQLite (dev) + Postgres (prod, `USE_POSTGRES=true` + `DATABASE_URL`, WAL + FK, `server/migrations/postgres_init.sql` for fresh installs, numbered `NNN_*.sql` files for existing production) |
| **Ledger** | ✅ | Double-entry, idempotent `idempotency_key`, append-only `audit_log` triggers (`server/schema.js`, `audit_log_no_update`/`audit_log_no_delete`), outbox `server/workers/outbox.worker.js` |
| **Auth** | ✅ | HttpOnly `lb_session` 7d, bcrypt, TOTP, per-email login throttle (8 fails / 15 min), RBAC + org seat roles, re-auth required for IBAN/payout actions |
| **Rate limit** | ✅ | `server/lib/rateLimit.js` — Redis-distributed (`ioredis`) when `REDIS_URL` set, in-memory fallback with a startup warning |
| **Crypto** | ✅ | AES-256-GCM field encryption `server/lib/crypto.js` for TRN/IBAN (`enc:v1:`), `ENCRYPTION_KEY` required in prod |
| **Payments** | ✅ | Provider abstraction `internal/mock/telr/stripe` (`server/lib/payments.js`) — Stripe Connect is the live production rail (checkout, webhook-funded escrow, Connect payouts); Telr is the UAE-specific alternative; webhook idempotency + a payout-attempts ledger back both |
| **Storage** | ✅ | S3-compatible (Cloudflare R2 in production, via `S3_BUCKET`/`S3_ENDPOINT`) with presigned direct-to-storage uploads; local disk fallback for dev (`server/data/uploads/`) |
| **CI** | ✅ Partial | `.github/workflows/ci.yml` — server tests, TypeScript check, frontend build, and `npm audit` are real gates; lint/k6/Playwright steps are explicitly advisory (not yet wired to a running server or a working lint config — see the workflow file's own comments) |
| **Deploy** | ✅ | Production: Vercel (frontend, `vercel.json`) + Oracle Cloud (backend, `deploy/oracle-cloud/`) + Supabase (Postgres) + Cloudflare R2 (storage). `render.yaml` remains as a one-click demo/alternative deploy target (`docs/DEMO_DEPLOY.md`), not the production host. |

Known limits: WhatsApp Business API needs Meta approval for production templates (`server/lib/whatsapp.js` is code-complete and stays dark until then); `mock` payments are forbidden in `NODE_ENV=production` by `server/lib/config.js`; GCC multi-country expansion config exists (`server/lib/gcc.js`) but isn't wired into any route yet.

## Quick navigation

- **Landing page**: http://localhost:5173 (no login required)
- **Shipper dashboard**: `shipper@jebelalilogistics.ae` → post jobs, view bids, award
- **Carrier dashboard**: `carrier@dubaidrayage.com` → browse open loads, place bids, view won jobs
- **Admin console**: `admin@loadbyton.ae` → verification, disputes, revenue, settings
- **API docs**: `docs/API.md` — full endpoint reference
- **Tutorial**: `docs/TUTORIAL.md` — end-to-end walkthrough