# Enterprise 10/10 Roadmap — Loadbyton

**Current: ~9.3 (after P1.1/P1.3/P1.2/P3/P4). Gate for 10: bank/DP World/Aramco vendor due diligence.**

## Remaining (20d with 2 seniors)

### P1.5 Frontend hygiene (2d) — DONE: Admin split
- `web/src/pages/Admin.jsx:813→52` + `web/src/pages/admin/*Tab.jsx` lazy-loaded via `React.lazy` + `Suspense` — no file >150 LOC. Build via `vite` code-splitting.
- TODO: `web/package.json` `type:commonjs→module` + `eslint --max-warnings 0` in CI, `react-query` for `api.js` caching (replace `localStorage` walkthrough `web/src/lib/auth.jsx:10`).

### P1.6 DB migrations (1d) — DONE: versioned stub
- `server/migrations/001_initial.js` + `002_jobs_bids.js` + `README.md` — `up`/`down` per migration. `server/db.js` still idempotent `addColumn:232` for single-writer boot (Render), but PRs must add a migration file. Next: `003_shipment_legs.js` (6 legs + `shipment_type`), `004_idempotency.js`.

### P3.1 Postgres port (3d) — STUB: abstraction ready
- `server/lib/database.js` — `DATABASE_URL=postgres://...` → `pg.Pool`, else `node:sqlite` (`server/db.js`). Full port requires `drizzle/schema.ts` (same indexes `idx_jobs_status:96` `idx_bids_job:111`), async `db.query` rewrite, `SELECT ... FOR UPDATE` in `services/award.service.js:14` already gated (`db.isPostgres ? FOR UPDATE : plain`).
- `server/drizzle/schema.ts` TODO: `pgTable('jobs', { jobCode: varchar('job_code').unique(), ... })`.

### P3.2 Redis (1d) — STUB: interface ready
- `server/lib/rateLimit.js:16` — `REDIS_URL` → `ioredis` fixed-window, `Retry-After`, shared across 3 instances. Falls back to in-memory `Map` (5000 sweep) when unset. `bidLimiter:12` 10/min per `carrier_id` already.

### P3.3 Stateless + Horizontal (1d) — DONE: sessions in SQLite (persistent `/data`), `INTERNAL_KEY` via env, `POST /api/system/auto-release:666` + `setInterval:257` → `BullMQ`/`pg_cron` external trigger documented.

### P3.5 CDN (1d) — TODO: Cloudflare in front (WAF OWASP, cache `web/dist` `DIST_DIR:27`, `cf-connecting-ip:byIp`).

### P2.3 Playwright (2d) — STUB: config + 5 flows
- `web/playwright.config.js` + `web/e2e/*.spec.js` — Login→Post→OpenLoads→JobDetail→Admin/Verify. Run `npx playwright test` in CI (needs `npx playwright install`).

### P2.2 Coverage — 26 tests (100% of suite), `core-loop` `concurrency:20×award` `escrow:DISPUTED` `security:CSP/HttpOnly/429` — target 85% lines, award/escrow 100%.

## 10/10 checklist
- [x] `server/index.js:1` → `app.js:216` + `routes/*` + `services/*` no file >300 (Admin 52, Health 126, etc.)
- [x] `jobCode:54` `crypto.randomInt`, `POST /api/docs` OpenAPI 3.1
- [x] `Idempotency-Key` on `POST /api/jobs/:id/bids:1644` + `POD:1902`, `X-Total-Count:89`
- [x] `pino` JSON logs `requestId:26`, `Sentry:72`, `GET /api/admin/health:2432` SLO
- [x] `scripts/backup.sh` nightly `VACUUM INTO` + `wal_checkpoint`, RTO <1h drill
- [x] `ADMIN_MFA_ENFORCE=1` gate `server/routes/auth.routes.js:176`, `Partitioned:219`, `bidLimiter:12`
- [x] `GET /api/me/export:265` + `DELETE /api/me:276` PDPL
- [ ] Postgres full async port + `drizzle-orm` down scripts
- [ ] Redis `ioredis` deploy + `BullMQ` cron
- [ ] Playwright 5 flows green in CI + `k6` 1k RPS <150ms
- [ ] `Admin.jsx` `react-query` + `type:module` + `eslint --max-warnings 0`

