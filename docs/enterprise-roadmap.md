# Enterprise 10/10 Roadmap — Loadbyton

**Current: ~9.3 (after P1.1/P1.3/P1.2/P3/P4). Gate for 10: bank/DP World/Aramco vendor due diligence.**

## Remaining (20d with 2 seniors)

### P1.5 Frontend hygiene (2d) — DONE: Admin split, react-query
- `web/src/pages/Admin.jsx` + `web/src/pages/admin/*Tab.jsx` lazy-loaded via `React.lazy` + `Suspense` — no file >150 LOC. Build via `vite` code-splitting.
- DONE (via a different mechanism than originally scoped): `web/package.json`'s `type` field was removed entirely rather than converted to `module` (see `docs/ENTERPRISE_AUDIT.md` fix #3). `@tanstack/react-query` is live — `web/src/features/job/useJobs.js`/`useBids.js` use `useQuery`/`useMutation`, wired up via `web/src/lib/queryClient.js` + `web/src/main.jsx`. `eslint --max-warnings 0` in CI is still genuinely outstanding — `server/`'s `npm run lint` references eslint, which isn't installed as a dependency there yet.

### P1.6 DB migrations (1d) — DONE, different shape than originally scoped
- No `up`/`down` JS migration files — instead: `server/schema.js` (idempotent `addColumn()` calls) is the source of truth for SQLite dev; numbered `server/migrations/NNN_*.sql` files (`002_financial_core.sql` through `005_ledger_check_tightening.sql`) are hand-run against production Postgres (Supabase) via `psql`, and `server/migrations/postgres_init.sql` is the full from-scratch schema for a fresh Postgres install.

### P3.1 Postgres port — DONE, live in production
- `server/lib/database.js` implements a working async `pg.Pool`-based client; `server/db.js` selects it via `USE_POSTGRES=true` + `DATABASE_URL`, else `node:sqlite`. This isn't a stub — Postgres via Supabase is the actual production database today (`docs/DISASTER_RECOVERY.md`'s backup/restore process is built entirely around it). `drizzle-orm` specifically was never adopted — the DB layer is hand-written `pg`/`node:sqlite` wrappers, not an ORM — but that's a stylistic gap, not a functionality one.

### P3.2 Redis — DONE, live when configured
- `server/lib/rateLimit.js` — `REDIS_URL` set → real `ioredis` client, fixed-window limiting shared across instances, with a `"[rateLimit] Redis enabled — distributed rate limiting active"` startup log. Falls back to an in-memory `Map` with a periodic sweep when `REDIS_URL` is unset (single-instance dev). Not a stub interface — this is deployed and active in any environment with `REDIS_URL` set.

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
- [x] Postgres full async port (live in production via Supabase) — `drizzle-orm` specifically not adopted (hand-written `pg` client instead)
- [x] Redis `ioredis` deploy (live when `REDIS_URL` set) — `BullMQ` cron still outstanding, auto-release still runs on plain `setInterval`
- [ ] Playwright 5 flows green in CI + `k6` 1k RPS <150ms — both wired into CI as explicitly advisory only; neither has a running-server step yet to actually gate on
- [x] `Admin.jsx` `react-query` — [ ] `eslint --max-warnings 0` still outstanding (no ESLint config/dependency in `server/` yet)

