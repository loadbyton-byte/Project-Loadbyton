-- Commercial-logic audit finding: an AWARDED, INSTANT-tier job's
-- processor_payment_status can sit at REQUIRES_PAYMENT indefinitely if
-- the shipper never pays — award.service.js already decremented the
-- carrier's available_units at award time, so that capacity stays tied
-- up with no automatic resolution (either party CAN cancel manually, but
-- nothing prompts them to). Adds a settings row (6h placeholder — same
-- "mechanism real, policy owned by the operator" pattern as
-- cancellation_fee_bps_after_award / iban_change_hold_hours) and an
-- idempotency marker column so escrow.service.js's
-- runUnpaidAwardReminderSweep sends exactly one reminder per stuck job,
-- not one every sweep interval.
--
-- Safe to run against existing data: the column defaults to NULL (no
-- historical job is retroactively marked reminded) and the settings
-- insert is a no-op if the key already exists.
--
-- Run once against production:
--   psql "$DATABASE_URL" -f server/migrations/009_unpaid_award_reminder.sql
BEGIN;

INSERT INTO settings (key, value) VALUES ('unpaid_award_reminder_hours', '6')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_reminder_sent_at TEXT;

-- Precise "time of award" — jobs.updated_at is not a safe proxy (a
-- checkout attempt updates the row while staying at REQUIRES_PAYMENT,
-- resetting any naive "time since award" measurement).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS awarded_at TEXT;

COMMIT;
