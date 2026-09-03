# Disaster Recovery & Incident Playbook

Replaces an earlier version of this file that described AWS RDS/Terraform/a
`RUNBOOK.md` — none of which this stack actually uses or has. What follows
is the real infrastructure, the real numbers, and the three incident
scenarios named during the Phase 1 hardening pass, mapped to the tools
actually configured (not generic AWS/RLS phrasing borrowed from elsewhere).

## Backups

- **Mechanism:** `scripts/backup-db.js`, scheduled by `.github/workflows/backup.yml` — daily at 02:17 UTC, decoupled from the API server entirely (a crashed or redeploying backend never means a missed backup).
- **What it does:** `pg_dump --format=plain` against Supabase's **direct** (non-pooled) connection, gzipped, uploaded as a GitHub Actions artifact (90-day retention) and — once Cloudflare R2 credentials exist as repo secrets — also pushed there automatically, no workflow change required.
- **RPO (Recovery Point Objective): ~24 hours.** Honest number for a once-daily backup, not an aspirational one. If that's ever too coarse (e.g. once real transaction volume justifies it), Supabase's paid tier adds point-in-time recovery — a plan upgrade, not a re-architecture.
- **RTO (Recovery Time Objective): under 30 minutes**, dominated by `pg_dump`/restore time at current data volume, not by anything infrastructural.
- **Restore, verified end-to-end (dump → gzip → restore → data confirmed intact) during the Supabase cutover:**
  ```bash
  gunzip -c backup.sql.gz | psql "$DIRECT_DATABASE_URL"
  ```
- **Test restores quarterly.** A backup you haven't restored is a backup you don't have.

## Incident playbook

### 1. Database connection exhaustion (`too many clients`, `remaining connection slots are reserved`)
- **Mitigation:** the app's `DATABASE_URL` already points at Supabase's **pooled** connection (Supavisor) — `server/db.js`'s `pgbouncer: true` config exists specifically for this. If exhaustion still happens under real load, the fix is raising Supabase's plan-tier connection limit or lowering `DB_POOL_MAX` (env var, default 20) so the app itself can't monopolize the pool — not read replicas, which aren't warranted at Phase 1 (1,000 concurrent user) scale.
- **Signal:** `/api/health`'s `db.ok` flips false, or Postgres error code `53300`.

### 2. Upload/IOPS pressure (many concurrent file uploads freeze the API)
- **Current state:** uploads still go through the Node process as base64 in the request body (`server/lib/storage.js`'s `saveUploadedFile`, 5MB cap) — this **is** a real pressure point today, because Cloudflare R2 (the fix) isn't wired in yet.
- **Mitigation, once R2 exists:** switch to presigned PUT URLs so the browser uploads directly to R2, bypassing the app server's CPU/memory entirely for file transfer — this is still open work, tracked as part of Stage 2's storage leg. Until then, the 5MB cap and single-file-per-request pattern keep any one upload's blast radius small.

### 3. Layer-7 DDoS
- **Mitigation:** Cloudflare (once DNS is proxied through it — see `docs/DEVELOPER_GUIDE.md`) → Security → **Under Attack Mode**, one click. Forces every visitor through a JS challenge at Cloudflare's edge before a request ever reaches the origin. The free Managed Ruleset and a rate-limiting rule on `/api/*` are the standing (always-on) layer; Under Attack Mode is the break-glass escalation for an active attack.
- **Signal:** request volume/latency spike with no matching real-traffic explanation; `/api/health` still responds but individual endpoints time out under load.

## What's intentionally not here

- **Terraform/infra-as-code failover** — not warranted at this scale; `infra/terraform/` exists as a later-phase sketch, not something in active use.
- **Multi-region/read replicas** — Phase 2+ territory (10,000+ concurrent users), not Phase 1.
