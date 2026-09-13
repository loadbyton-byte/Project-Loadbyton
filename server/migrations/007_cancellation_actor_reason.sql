-- Commercial-logic audit finding: cancellation had no structured actor/
-- reason record — job.status='CANCELLED' plus an audit-log free-text
-- DETAILS string was the only trace. Adds columns only; does not change
-- any fee/compensation logic (see server/services/job.service.js's
-- cancellation block comment for the fairness gap this does NOT resolve
-- on its own — that's a pricing decision for the platform operator).
--
-- Safe to run against existing data: all three columns default to NULL,
-- so no historical cancellation is retroactively (mis)labeled.
--
-- Run once against production:
--   psql "$DATABASE_URL" -f server/migrations/007_cancellation_actor_reason.sql
BEGIN;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_by_role TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_at TEXT;

COMMIT;
