# Contributing to Loadbyton

## Stack
- Node 22+ (`node:sqlite` for dev + `pg` for Postgres prod — dual DB via `server/db.js`, see `USE_POSTGRES`)
- Express, `zod` (validation), `bcryptjs`, `pg`/`ioredis` (optional prod), `stripe`/`@aws-sdk/client-s3` (when configured), `swagger-ui-express`
- React 18 + Vite + Tailwind 3 + `@tanstack/react-query` + `leaflet` for the SPA
- TypeScript strict for `types/` + `lib/` (see `server/tsconfig.json` — JS routes are `checkJs: false`)

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
