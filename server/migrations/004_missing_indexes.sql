-- Adds indexes on foreign-key columns that were missing on production
-- Postgres (present in SQLite's schema.js as of this same change, and now
-- added to migrations/postgres_init.sql for future fresh installs too).
-- Every query already filters on these columns (e.g. WHERE shipper_id=?,
-- WHERE job_id=?) — without an index, each of those does a sequential
-- scan that only gets slower as the tables grow.
--
-- (messages.thread_id already has idx_messages_thread on Postgres via
-- postgres_init.sql — that gap was SQLite-only, fixed directly in
-- schema.js, no production migration needed for it.)
--
-- Run once against production:
--   psql "$DATABASE_URL" -f server/migrations/004_missing_indexes.sql
BEGIN;
CREATE INDEX IF NOT EXISTS idx_users_org_owner ON users(org_owner_id);
CREATE INDEX IF NOT EXISTS idx_contract_rfps_shipper ON contract_rfps(shipper_id);
CREATE INDEX IF NOT EXISTS idx_rfp_bids_rfp ON rfp_bids(rfp_id);
CREATE INDEX IF NOT EXISTS idx_rfp_milestones_rfp ON rfp_milestones(rfp_id);
CREATE INDEX IF NOT EXISTS idx_compliance_job ON compliance_declarations(job_id);
CREATE INDEX IF NOT EXISTS idx_debt_instruments_job ON debt_instruments(job_id);
CREATE INDEX IF NOT EXISTS idx_telematics_job ON telematics_logs(job_id);
COMMIT;
