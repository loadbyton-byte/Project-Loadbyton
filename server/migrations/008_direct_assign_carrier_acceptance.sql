-- Commercial-logic audit finding: POST /api/jobs/:id/direct-assign
-- (broker.routes.js) created a bid on the carrier's behalf and awarded it
-- immediately, with no acceptance step — the carrier never proposed or
-- confirmed anything themselves. Adds columns only; the actual gate lives
-- in application code (broker.routes.js no longer auto-awards a
-- direct-assign bid, and a new POST /api/bids/:id/accept requires the
-- carrier to explicitly accept before award.service.js runs).
--
-- Safe to run against existing data: both columns default to
-- "not required" / NULL, so no historical bid is retroactively affected —
-- this only changes behavior for direct-assign bids created after this
-- migration (and the matching application-code deploy) lands.
--
-- Run once against production:
--   psql "$DATABASE_URL" -f server/migrations/008_direct_assign_carrier_acceptance.sql
BEGIN;

ALTER TABLE bids ADD COLUMN IF NOT EXISTS carrier_acceptance_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS carrier_accepted_at TEXT;

COMMIT;
