# Contributing to Loadbyton

## Stack
- Node 22+ (`node:sqlite` for dev + `pg` for Postgres prod — dual DB via `server/db.js`, see `USE_POSTGRES`)
- Express, `zod` (validation), `bcryptjs`, `pg`/`ioredis` (optional prod), `stripe`/`@aws-sdk/client-s3` (when configured), `swagger-ui-express`
- React 18 + Vite + Tailwind 3 + `@tanstack/react-query` + `leaflet` for the SPA
- TypeScript strict for `types/` + `lib/` (see `server/tsconfig.json` — JS routes are `checkJs: false`)

## Branch workflow

- **`main`** — the live, deployed state. Protected: no direct pushes, requires
  a pull request with 1 approval and a passing CI check
  (`.github/workflows/ci.yml`) before merging. Every commit here is assumed
  to already be running in production or ready to be.
- **`development`** — the active integration branch. Unprotected on purpose,
  for fast iteration. Branch your feature/fix work off `development` (or off
  `main` for a small, self-contained fix — either is fine), open a PR, and
  merge there first.
- **`staging`** — kept in sync with `main`; not part of day-to-day work.

**To ship a change**: branch off `development`, commit, open a PR into
`development` and merge once it's reviewed and CI is green. Once a batch of
work on `development` is confirmed working, open a PR from `development`
into `main` to release it. Never push straight to `main` — even repo admins
go through a PR, so the CI check and review actually run on every change
that reaches production.

**If a change needs a manual step after deploy** (a database migration, a
new environment variable, a one-off script run on the Oracle server), say so
explicitly in the PR description — Vercel deploys the frontend automatically
on merge, but the backend on Oracle does not auto-update; someone has to
`git pull`, rebuild, and restart the container by hand.

## Setup
```bash
cd server && npm install && node index.js   # API on :4000
cd web && npm install && npm run dev        # SPA on :5173
```

## Database
- Schema lives in `server/db.js` (auto-creates tables + columns on boot).
- Seed runs once if `users` table is empty. Delete `server/data/loadbyton.db*` to reseed.
- `audit_log` is append-only — never update or delete rows.

## Testing
- `cd server && npm test` — isolated temp SQLite per run, real HTTP (harness `server/test/harness.js`), no mocks
- `cd server && npm run typecheck` — `tsc --noEmit` (types only, JS excluded)
- `cd web && npm run build` — Vite + prerender (9 SEO pages) must succeed
- `npm --prefix server audit` — 0 vulnerabilities expected

## Code style
- Server: CommonJS, no TypeScript, minimal dependencies.
- Frontend: JSX, no TypeScript, hand-rolled SVG icons in `web/src/components/icons.jsx`.
- All verification, contact gating, and status transitions enforced server-side.
