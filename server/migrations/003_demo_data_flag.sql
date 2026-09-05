-- Adds an is_demo flag so a small set of investor/demo accounts and their
-- jobs can be created without ever appearing in real users' listings, the
-- public site's stats, or the admin revenue/health dashboards. See the
-- matching filters added in server/services/job.service.js,
-- server/routes/job-extras.routes.js, server/routes/rfp.routes.js,
-- server/routes/public.routes.js and server/routes/admin.routes.js.
--
-- Run once against production:
--   psql "$DATABASE_URL" -f server/migrations/003_demo_data_flag.sql
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contract_rfps ADD COLUMN IF NOT EXISTS is_demo INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_is_demo ON users(is_demo);
CREATE INDEX IF NOT EXISTS idx_jobs_is_demo ON jobs(is_demo);
CREATE INDEX IF NOT EXISTS idx_contract_rfps_is_demo ON contract_rfps(is_demo);
COMMIT;
