# Disaster Recovery Drill Log

Every entry below is a real, executed test of restoring from a backup — not
a plan, not a schedule. `docs/DISASTER_RECOVERY.md` recommends a quarterly
restore drill in several places; this file is the proof it actually
happened, updated every time it does. An empty or stale log here means the
recovery process is unverified, whatever the runbook says.

## How to run a drill (for whoever does the next one)

1. Confirm the most recent `Database backup` GitHub Actions run succeeded
   (Actions tab, or `gh run list --workflow="Database backup"`).
2. Download that run's artifact (`gh run download <run-id>`).
3. Restore it into a **throwaway** Postgres instance (never the production
   database) — e.g. a local Docker container: `docker run -d -e
   POSTGRES_PASSWORD=test postgres:16-alpine`, then `gunzip -c
   loadbyton-*.sql.gz | psql "postgres://postgres:test@localhost:5432/postgres"`.
4. Verify: row counts on a few key tables (`users`, `jobs`, `payouts`,
   `ledger_entries`) look sane and non-zero; spot-check that a ledger
   transaction's DEBIT and CREDIT entries still balance; confirm the schema
   version looks current (no missing tables from a recent migration).
5. Time the whole thing — that's your real RTO, not the documented estimate.
6. Add a row below. Clean up the throwaway database and downloaded artifact
   afterward — never leave a copy of production data lying around locally.

## Log

| Date | Run by | Backup run tested | Result | RTO (actual) | Notes |
|---|---|---|---|---|---|
| 2026-09-07 | Claude (repo health audit) | *(none — see below)* | ⚠️ Could not run | N/A | Checked all 3 existing "Database backup" workflow runs (2026-09-04, 2026-09-05, 2026-09-06) — every one failed before producing an artifact, due to the IPv6 connectivity issue fixed in PR #22. There has never been a successful backup to test-restore. **First real drill is pending**: apply PR #22's fix (update the `DIRECT_DATABASE_URL` secret to Supabase's Session pooler string, per the PR description), manually trigger the workflow once to confirm it succeeds, then run the drill above against that artifact. |

