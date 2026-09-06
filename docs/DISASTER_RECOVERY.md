# Disaster Recovery & Incident Playbook

Replaces an earlier version of this file that described AWS RDS/Terraform/a
`RUNBOOK.md` — none of which this stack actually uses or has. What follows
is the real infrastructure, the real numbers, and the three incident
scenarios named during the Phase 1 hardening pass, mapped to the tools
actually configured (not generic AWS/RLS phrasing borrowed from elsewhere).

## Backups

- **Mechanism:** `scripts/backup-db.js`, scheduled by `.github/workflows/backup.yml` — daily at 02:17 UTC, decoupled from the API server entirely (a crashed or redeploying backend never means a missed backup).
- **What it does:** `pg_dump --format=plain` against a non-pooled Supabase connection — specifically the **Session pooler** string, not "Direct connection" (Direct connection is IPv6-only on newer Supabase projects, and GitHub-hosted runners have no outbound IPv6 route — this silently failed the backup for three consecutive nights, 2026-09-04 through 2026-09-06, before being caught by a manual repo audit rather than an alert; see `.github/workflows/backup.yml`'s header comment) — gzipped, uploaded as a GitHub Actions artifact (90-day retention) and — once Cloudflare R2 credentials exist as repo secrets — also pushed there automatically, no workflow change required.
- **RPO (Recovery Point Objective): ~24 hours, *when the workflow is actually succeeding*.** Honest number for a once-daily backup, not an aspirational one — but this number is only as good as someone noticing a failed run. There is no alerting on backup failure today beyond GitHub's own default email notification to watchers (Settings → Notifications on the account that owns the repo — confirm "Actions" workflow-failure emails are actually enabled there). Check the Actions tab's "Database backup" workflow history periodically until real alerting exists. If that's ever too coarse (e.g. once real transaction volume justifies it), Supabase's paid tier adds point-in-time recovery — a plan upgrade, not a re-architecture.
- **RTO (Recovery Time Objective): under 30 minutes**, dominated by `pg_dump`/restore time at current data volume, not by anything infrastructural.
- **Restore, verified end-to-end (dump → gzip → restore → data confirmed intact) during the Supabase cutover:**
  ```bash
  gunzip -c backup.sql.gz | psql "$DIRECT_DATABASE_URL"
  ```
- **Test restores quarterly.** A backup you haven't restored is a backup you don't have. Log every real drill in `docs/DR_DRILL_LOG.md` — a recommendation with no log is just a hope.

## Incident playbook

### 1. Database connection exhaustion (`too many clients`, `remaining connection slots are reserved`)
- **Mitigation:** the app's `DATABASE_URL` already points at Supabase's **pooled** connection (Supavisor) — `server/db.js`'s `pgbouncer: true` config exists specifically for this. If exhaustion still happens under real load, the fix is raising Supabase's plan-tier connection limit or lowering `DB_POOL_MAX` (env var, default 20) so the app itself can't monopolize the pool — not read replicas, which aren't warranted at Phase 1 (1,000 concurrent user) scale.
- **Signal:** `/api/health`'s `db.ok` flips false, or Postgres error code `53300`.

### 2. Upload/IOPS pressure (many concurrent file uploads freeze the API)
- **Current state:** R2 is wired in (`server/lib/storage.js`, S3-compatible client, selected via `S3_BUCKET`/`S3_ENDPOINT`). Uploads go through `getPresignedUploadUrl` — the browser PUTs the file straight to R2 with a presigned URL, bypassing the app server's CPU/memory entirely for file transfer (used by `documents.routes.js`, `fleet.routes.js`, `job-extras.routes.js`). The base64-through-Node path (`saveUploadedFile`, 5MB cap) only runs as the local-disk fallback when `S3_BUCKET` isn't configured (e.g. local dev).
- **Mitigation:** with R2 configured in production this pressure point doesn't apply. If `S3_BUCKET` were ever unset in production, the 5MB cap and single-file-per-request pattern on the fallback path keep any one upload's blast radius small.

### 3. Layer-7 DDoS
- **Mitigation:** Cloudflare (once DNS is proxied through it — see `docs/DEVELOPER_GUIDE.md`) → Security → **Under Attack Mode**, one click. Forces every visitor through a JS challenge at Cloudflare's edge before a request ever reaches the origin. The free Managed Ruleset and a rate-limiting rule on `/api/*` are the standing (always-on) layer; Under Attack Mode is the break-glass escalation for an active attack.
- **Signal:** request volume/latency spike with no matching real-traffic explanation; `/api/health` still responds but individual endpoints time out under load.

## What's intentionally not here

- **Terraform/infra-as-code failover** — not warranted at this scale; `infra/terraform/` exists as a later-phase sketch, not something in active use.
- **Multi-region/read replicas** — Phase 2+ territory (10,000+ concurrent users), not Phase 1.
