-- Bank-change payout hold (commercial-logic audit / backend P0 backlog
-- Phase 3). Adds profiles.iban_changed_at, set by PATCH /api/profile
-- whenever a carrier's IBAN actually changes (auth.routes.js), and reads
-- it in payout.service.js's executePayoutAsync against the new
-- iban_change_hold_hours setting to defer a transfer made shortly after
-- a bank-detail change — the same "re-auth stops a stolen cookie, this
-- stops a genuinely compromised account from cashing out immediately"
-- gap a stolen-session-only re-auth check can't close on its own.
--
-- Safe to run against existing data: the new column defaults to NULL
-- (no existing carrier has ever "just changed" their IBAN from this
-- migration's point of view), so no payout already in flight is held by
-- this alone.
--
-- Run once against production:
--   psql "$DATABASE_URL" -f server/migrations/006_iban_change_payout_hold.sql
BEGIN;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS iban_changed_at TEXT;

INSERT INTO settings (key, value) VALUES ('iban_change_hold_hours', '72')
ON CONFLICT (key) DO NOTHING;

COMMIT;
