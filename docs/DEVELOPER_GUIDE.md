# Loadbyton — Developer Guide

How to set up, run, build, and troubleshoot the project. Pair with `ARCHITECTURE.md` (how it works), `API.md` (endpoints), and `DATA_MODEL.md` (schema).

---

## 1. Prerequisites

- **Node 22+** — the backend uses the built-in `node:sqlite` module (`require('node:sqlite')`). Node 20 and below will throw `Cannot find module 'node:sqlite'`. Check: `node -v`.
- npm (ships with Node).
- Nothing else — no PostgreSQL, no Redis, no cloud accounts.

## 2. Install

```bash
# API
cd server
npm install

# Web SPA
cd ../web
npm install
```

## 3. Run (development)

Terminal 1 — the API (port 4000):

```bash
cd server
node index.js
```

Expected log lines: the server listening on `:4000`, the generated `INTERNAL_KEY`, and the seed running on first boot.

Terminal 2 — the Vite dev server (port 5173):

```bash
cd web
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api/*` → `http://localhost:4000` (see `web/vite.config.js`), so the SPA can use relative `/api` paths and the `lb_session` cookie flows naturally.

### Demo logins
All password `demo1234`:
- Shipper: `shipper@jebelalilogistics.ae`
- Carriers: `carrier@dubaidrayage.com`, `falcon@containerxpress.ae`, `gulfheavy@fleet.ae` (verified) · `desertline@drayage.ae` (unverified — try to bid, watch it 403)
- Admin: `admin@loadbyton.ae`

## 4. Run (production)

```bash
cd web && npm run build      # emits web/dist
cd ../server && node index.js
```

Now **http://localhost:4000** serves everything: the API, the built SPA, the SEO pages, and the SPA fallback for deep links. One process, one port.

### 4.1 Custom domain + TLS (production)

- Register the domain, then in the Render dashboard: **Settings → Custom Domains** → add it (Render provisions the TLS certificate automatically; DNS = CNAME to `loadbyton.onrender.com`).
- Update the `FRONTEND_URL` env var to `https://<your-domain>` (it is the CORS allowlist in dev, and the payment checkout return URLs in production — see `docs/PAYMENTS.md`).
- The payment processor callback URL must be the public HTTPS endpoint: `https://<your-domain>/api/webhooks/payments`.
- **Fixed secrets before real data:** replace `ENCRYPTION_KEY: generateValue` in `render.yaml` with a secret you generate once (`openssl rand -base64 32`) and paste into the dashboard — a regenerated key orphans every encrypted IBAN/TRN. Same for `INTERNAL_KEY` (cron/auto-release) and `ADMIN_SETUP_KEY`.

## 5. Database

- Location: `server/data/loadbyton.db` (auto-created; env `DB_PATH` to relocate).
- WAL mode, foreign keys on.
- Seeds automatically on first boot (idempotent). To **reset**: stop the server and delete the file (and `-wal`/`-shm` siblings):
  ```bash
  rm -f server/data/loadbyton.db*
  ```
- Inspect it:
  ```bash
  node -e "const db=require('./server/db'); console.log(db.prepare('SELECT * FROM users').all())"
  ```

### Backups (production)

- **Automated backup script:** `scripts/backup-db.js` — SQLite path uses `sqlite3 .backup` for a consistent snapshot (handles WAL correctly); Postgres path uses `pg_dump --format=plain` (portable across pg_dump/pg_restore versions — see the script's own comment for why `--format=custom` was tried and rejected). Both gzip and, when `S3_BUCKET` is set, push a copy offsite to the same R2 bucket used for documents.
- **Scheduled via GitHub Actions**, not server cron: `.github/workflows/backup.yml` runs daily (02:17 UTC) and on manual dispatch, decoupled from the API server entirely — a crashed or redeploying backend never means a missed backup. Set the `DIRECT_DATABASE_URL` repo secret (Settings → Secrets and variables → Actions) — Supabase's **direct** (non-pooled, port 5432) connection string, not the pooled `DATABASE_URL` the app itself uses (pooled connections don't support the session-based operations `pg_dump` needs). Until the `S3_*` secrets exist (Cloudflare R2, still pending as of this writing), the dump is uploaded as a GitHub Actions artifact instead — the repo's own free storage, 90-day retention — so backups are real today and start also landing in R2 automatically the moment those secrets are added, no workflow change needed.
- **Restore (Postgres):** `gunzip -c backup.sql.gz | psql "$DIRECT_DATABASE_URL"` — verified end-to-end (dump → gzip → restore into a fresh database → data confirmed intact) as part of the Supabase cutover.
- **Restore (SQLite):** stop the API, replace `loadbyton.db*` files from the `.gz`, restart.
- **Test restores quarterly** — a backup you haven't restored is a backup you don't have.

## 6. Verification

Automated test suite: run `cd server There is no automated test suite yet (tracked as test harness — see `docs/ROADMAP.md`). Verify the build by hand:There is no automated test suite yet (tracked as test harness — see `docs/ROADMAP.md`). Verify the build by hand: npm test` (isolated temp DB per run). Manual verification:

```bash
curl -s localhost:4000/api/health
curl -s localhost:4000/api/public/lanes
```

...or walk `TUTORIAL.md` end to end with the demo accounts — every state transition, escrow move, and admin action described there is exercised against the live API.

## 7. Configuration knobs (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API + static host port |
| `FRONTEND_URL` | `http://localhost:5173` | CORS allowlist for the dev SPA |
| `DB_PATH` | `server/data/loadbyton.db` | SQLite file location |
| `INTERNAL_KEY` | random per boot | `x-internal-key` for `/api/system/auto-release` (admin also allowed) |
| `PLATFORM_TRN` | unset | Loadbyton's own TRN, printed on every commission tax invoice (`server/lib/invoice.js`). Invoices render a visible warning until this is set — never fabricate a placeholder TRN in production. |
| `PLATFORM_LEGAL_NAME` | `Loadbyton` | Supplier legal name on tax invoices |
| `ENCRYPTION_KEY` | none (required outside dev) | AES-256-GCM key for IBAN/TRN field encryption — see `server/lib/crypto.js` |
| `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | unset | Enables driver WhatsApp messaging (`server/lib/whatsapp.js`); safely no-ops and logs until both are set — see `docs/WHATSAPP_SETUP.md` (TODO-4) |
| `PAYMENTS_PROVIDER` | `internal` | Payment processor mode: `internal` (escrow is bookkeeping only — the pre-existing admin confirm-receipt / mark-transferred flows), `mock` (simulated processor for dev/CI — full end-to-end payment flow via signature-verified webhooks), or `telr` (real charges/refunds via Telr hosted checkout) — see `docs/PAYMENTS.md` |
| `PAYMENTS_WEBHOOK_SECRET` | unset | HMAC secret that verifies webhook callbacks in `mock` mode (and the mock side of any provider) |
| `TELR_STORE_ID` / `TELR_AUTH_KEY` | unset | Telr merchant credentials (sandbox first: set `TELR_TEST=1`) |
| `TELR_WEBHOOK_SECRET` | unset | Secret used to verify Telr's signed callbacks — **VERIFY the canonicalization against Telr's docs before go-live** (`server/lib/payments.js`) |
| `TELR_TEST` | `1` (safe default) | `0` only for real-money Telr processing — never default to live |

Platform settings (runtime, not env): `commission_rate_bps` (default 600) and `auto_release_hours` (default 24), editable by admin via `PATCH /api/admin/settings`.

## 7a. Removed: Document OCR processing

The "Scan with AI" OCR feature (TRN/trade-licence capture on Register/Profile,
document scanning on JobDetail — `web/src/components/ScanWithAi.jsx`,
`DocumentScanner.jsx`, `web/src/lib/puterOcr.js`) was **removed** in the
Industrial Trust pass: it violated the platform's own document-privacy rules
(docs are shared only after award) and sent shipper documents to a third-party
vision service. The script tag and CSP carve-out for
`https://*.puter.com` were removed with it. Do not reintroduce client-side OCR
on documents; registration fields are typed and validated (UAE phone, 15-digit
TRN, trade licence).

## 7b. Search Console & Analytics (SEO)

**GA4 is already live** — the property Measurement ID is baked into
`web/index.html` as the default, so no deploy-platform config is needed. It's
still overridable per-deploy via a build-time frontend env var if a separate
property (e.g. staging) is ever wanted. Search Console verification is not
yet wired — no property exists for `loadbyton.com` yet.

Set overrides as **Vercel project env vars** (Project → Settings →
Environment Variables), not in the server's `.env`, since Vercel builds
`web/` independently of the API.

| Var | Purpose |
|---|---|
| `VITE_GA_MEASUREMENT_ID` | Overrides the default GA4 property ID baked into `web/index.html`. Only needed for a separate (e.g. staging) property. |
| `VITE_GSC_VERIFICATION` | Search Console HTML-tag verification content string — required once, see step 2 below. |
| `SITE_ORIGIN` | Overrides the canonical/sitemap origin (defaults to `https://loadbyton.com`) — only needed for a staging domain. |

**Search Console — still needs your own Google login (one-time, ~5 min):**

1. [search.google.com/search-console](https://search.google.com/search-console) → Add property → "URL prefix" → `https://loadbyton.com` → choose the **HTML tag** verification method → copy the `content="…"` value.
2. Send it to whoever's deploying, or set it yourself as `VITE_GSC_VERIFICATION` in Vercel → redeploy → click Verify in Search Console.
3. Once verified, submit `https://loadbyton.com/sitemap.xml` under Search Console's Sitemaps section (already generated by `web/scripts/vercel-static-seo.mjs` on every build).

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Error: Cannot find module 'node:sqlite'` | Node < 22. Upgrade Node. |
| `EADDRINUSE :::4000` | A stale server is still running. `lsof -i :4000` / `kill <pid>` (or `pkill -f "node index.js"`) and restart. |
| Vite dev can't reach the API | Confirm `/api` proxy target in `web/vite.config.js` is `http://localhost:4000` and the server is up. |
| Can't log in — always bounced to /login | The page must call the auth provider's `login()`/`register()` so React state updates. Direct `fetch` + `navigate` leaves `AuthProvider.user` null and `RequireAuth` redirects forever. See `web/src/lib/auth.jsx` / `pages/Login.jsx`. |
| Auto-release never fires | The sweep is an in-process `setInterval` (10 min) — it only runs while the API process is alive and only on delivered jobs past their window. Force a pass: `POST /api/system/auto-release` as admin (Admin console → Settings → "Run sweep now"). |
| CORS errors in the browser | `FRONTEND_URL` must match the origin of the page making requests (`http://localhost:5173` in dev). |
| `audit_log` UPDATE/DELETE fails | By design — the table is append-only (DB triggers). |
| A Tailwind utility (`hidden`, `w-full`, …) doesn't override a `.btn-*`/`.card`/`.input` component class | Custom component classes must live inside `@layer components { ... }` in `web/src/index.css`, or their declarations land after Tailwind's utility layer in the compiled CSS and silently win regardless of class order in JSX. |
| A raw `0`/`1` integer field (e.g. `job.requires_hazmat`) renders as a literal "0" on the page | JSX only treats `false`/`null`/`undefined` as invisible — `{0 && <X/>}` renders the text `"0"`. Coerce with `!!field` before using it in `{cond && <X/>}`. |

## 9. Conventions to keep

- **`server/package.json` and `web/package.json` stay `"type": "commonjs"`** — `web/postcss.config.js` and `web/tailwind.config.js` are CJS (`module.exports`). Converting either to ESM breaks the build.
- **No new external UI icon library without installing the package** — the app currently uses small hand-rolled inline SVGs (`web/src/components/icons.jsx`) to avoid an extra dependency; if you do add an icon library, standardize on one and remove the hand-rolled set rather than mixing both.
- **Auth state lives in React context** (`web/src/lib/auth.jsx`), never `localStorage`.
- **Server-side guards are authoritative** — the UI hides PII, but the API strips it (`/api/public/carriers`, bid masking in `GET /api/jobs/:id`).
- **Audit every state transition** — awards, escrow actions, verifications, dispute resolutions all write `audit_log` with `before_state`/`after_state` and the `x-request-id`.
- **Idempotent seeds/migrations** — new columns go through the `addColumn()` pattern in `server/db.js`; seed data goes through `server/seed.js`'s user-count check.
- **Design tokens are the single source of truth** — colors, type, spacing live in `docs/brand/design-tokens.css` (mirrored into `web/src/index.css`) and are consumed via Tailwind's config, never hardcoded hex values in components.
