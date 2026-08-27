-- Financial Core v2 — incremental migration for existing production DBs that already ran 001/postgres_init.sql
-- Run with: psql $DATABASE_URL -f server/migrations/002_financial_core.sql
BEGIN;

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','REVENUE','EXPENSE')),
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id SERIAL PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  job_id INTEGER REFERENCES jobs(id),
  payout_id INTEGER REFERENCES payouts(id),
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL REFERENCES ledger_accounts(code),
  amount_minor BIGINT NOT NULL CHECK (amount_minor != 0),
  currency TEXT NOT NULL DEFAULT 'AED',
  side TEXT NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_tx ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_code);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT,
  raw_payload TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  received_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_webhook_provider_event ON payment_webhook_events(provider, provider_event_id);

CREATE TABLE IF NOT EXISTS payout_attempts (
  id SERIAL PRIMARY KEY,
  payout_id INTEGER NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  provider TEXT NOT NULL,
  amount_aed REAL NOT NULL,
  destination TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,
  provider_response TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_payout_attempts_payout ON payout_attempts(payout_id);

CREATE TABLE IF NOT EXISTS outbox_events (
  id SERIAL PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_job_unique ON payouts(job_id);

INSERT INTO ledger_accounts (code, name, type) VALUES ('processor_clearing', 'Processor Clearing', 'ASSET') ON CONFLICT (code) DO NOTHING;
INSERT INTO ledger_accounts (code, name, type) VALUES ('escrow_liability', 'Escrow Liability', 'LIABILITY') ON CONFLICT (code) DO NOTHING;
INSERT INTO ledger_accounts (code, name, type) VALUES ('carrier_payable', 'Carrier Payable', 'LIABILITY') ON CONFLICT (code) DO NOTHING;
INSERT INTO ledger_accounts (code, name, type) VALUES ('platform_revenue', 'Platform Revenue', 'REVENUE') ON CONFLICT (code) DO NOTHING;
INSERT INTO ledger_accounts (code, name, type) VALUES ('refund_liability', 'Refund Liability', 'LIABILITY') ON CONFLICT (code) DO NOTHING;

COMMIT;
