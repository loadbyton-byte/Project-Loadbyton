-- Tightens ledger_entries.amount_minor's CHECK from `!= 0` to `> 0`.
-- lib/ledger.js's createTransaction already rejects any entry with
-- amountMinor <= 0 before insert (direction is carried by the separate
-- `side` DEBIT/CREDIT column, never by the sign of amount_minor) — this
-- constraint was looser than the actual invariant, silently allowing a
-- negative amount_minor through for any insert that bypassed that helper.
--
-- Safe to run against existing data: no legitimate row can have
-- amount_minor <= 0 given the application-level check above, so this
-- should find nothing to reject. If it does, that row needs investigation
-- before this migration is re-run.
--
-- Run once against production:
--   psql "$DATABASE_URL" -f server/migrations/005_ledger_check_tightening.sql
BEGIN;
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_amount_minor_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_amount_minor_check CHECK (amount_minor > 0);
COMMIT;
