-- Loadbyton — Postgres schema migration
-- Run with: psql $DATABASE_URL -f server/migrations/postgres_init.sql
-- Or via Prisma: npx prisma migrate deploy
-- Idempotent: all tables/indexes use IF NOT EXISTS.

BEGIN;

-- ---------------------------------------------------------------------------
-- Core schema
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  mfa_secret TEXT,
  tier TEXT NOT NULL DEFAULT 'BRONZE',
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  org_owner_id INTEGER REFERENCES users(id),
  seat_role TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  display_name TEXT,
  email_verified_at TEXT,
  email_verify_token_hash TEXT,
  email_verify_expires TEXT,
  password_reset_token_hash TEXT,
  password_reset_expires TEXT,
  notification_prefs_disabled TEXT NOT NULL DEFAULT '',
  account_approval_status TEXT NOT NULL DEFAULT 'APPROVED',
  account_approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_users_org_owner ON users(org_owner_id);

CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  trn_number TEXT,
  trade_license_number TEXT,
  phone TEXT,
  iban TEXT,
  coverage_zones TEXT,
  fleet_size INTEGER NOT NULL DEFAULT 0,
  owned_chassis INTEGER NOT NULL DEFAULT 0,
  insurance_uploaded INTEGER NOT NULL DEFAULT 0,
  rating_avg REAL NOT NULL DEFAULT 5.0,
  completed_jobs INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  processor_account_id TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  expires_at TEXT NOT NULL,
  impersonating_admin_id INTEGER,
  acting_seat_id INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  job_code TEXT UNIQUE NOT NULL,
  shipper_id INTEGER NOT NULL REFERENCES users(id),
  carrier_id INTEGER REFERENCES users(id),
  contract_lane_id INTEGER,
  template_id INTEGER,
  container_size TEXT NOT NULL,
  container_type TEXT NOT NULL,
  container_number TEXT,
  pickup_terminal TEXT NOT NULL,
  delivery_area TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  ready_at TEXT NOT NULL,
  deadline TEXT NOT NULL,
  max_budget_aed REAL,
  agreed_price_aed REAL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  awarded_bid_id INTEGER,
  notes TEXT,
  escrow_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  delivered_at TEXT,
  auto_release_processed INTEGER NOT NULL DEFAULT 0,
  payout_released_at TEXT,
  container_count INTEGER NOT NULL DEFAULT 1,
  truck_count INTEGER NOT NULL DEFAULT 1,
  equipment_type TEXT NOT NULL DEFAULT 'CONTAINER_CHASSIS',
  cargo_type TEXT NOT NULL DEFAULT 'GENERAL_GOODS',
  cargo_weight_tons REAL,
  assigned_driver_name TEXT,
  assigned_driver_phone TEXT,
  pickup_lat REAL,
  pickup_lng REAL,
  pickup_address_detail TEXT,
  delivery_lat REAL,
  delivery_lng REAL,
  delivery_address_detail TEXT,
  processor_payment_ref TEXT,
  processor_tranref TEXT,
  processor_payment_status TEXT NOT NULL DEFAULT 'PENDING',
  processor_amount_aed REAL,
  processor_last_error TEXT,
  loading_location TEXT,
  delivery_location TEXT,
  scheduled_post_at TEXT,
  shipment_type TEXT NOT NULL DEFAULT 'IMPORT',
  import_pickup_terminal TEXT,
  import_unloading_location TEXT,
  import_empty_return_location TEXT,
  export_empty_pickup_location TEXT,
  export_loading_location TEXT,
  export_deposit_terminal TEXT,
  leg_extra_lat REAL,
  leg_extra_lng REAL,
  currency TEXT NOT NULL DEFAULT 'AED',
  country_code TEXT NOT NULL DEFAULT 'AE',
  tax_rate_bps INTEGER NOT NULL DEFAULT 500,
  tax_amount REAL,
  dp_world_e_token TEXT,
  eir_photos TEXT,
  detention_free_days INTEGER NOT NULL DEFAULT 5,
  incidentals_buffer_aed REAL,
  buffer_released INTEGER NOT NULL DEFAULT 0,
  ledger_hash TEXT,
  prev_ledger_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_shipper ON jobs(shipper_id);
CREATE INDEX IF NOT EXISTS idx_jobs_carrier ON jobs(carrier_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS bids (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  amount_aed REAL NOT NULL,
  eta_minutes INTEGER NOT NULL DEFAULT 0,
  eta_at TEXT,
  truck_type TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_bids_job ON bids(job_id);
CREATE INDEX IF NOT EXISTS idx_bids_carrier ON bids(carrier_id);
-- Partial unique index: one PENDING bid per carrier per job
CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_one_pending_per_carrier ON bids(job_id, carrier_id) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS job_documents (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  storage_path TEXT,
  mime_type TEXT
);
CREATE INDEX IF NOT EXISTS idx_docs_job ON job_documents(job_id);

CREATE TABLE IF NOT EXISTS message_threads (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  party_a_role TEXT NOT NULL,
  party_b_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_job_parties ON message_threads(job_id, party_a_role, party_b_role);
CREATE INDEX IF NOT EXISTS idx_threads_job ON message_threads(job_id);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  thread_id INTEGER REFERENCES message_threads(id),
  content TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_messages_job ON messages(job_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);

CREATE TABLE IF NOT EXISTS ratings (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  rater_id INTEGER NOT NULL REFERENCES users(id),
  ratee_id INTEGER NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_ratings_job ON ratings(job_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_one_per_rater ON ratings(job_id, rater_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS templates (
  id SERIAL PRIMARY KEY,
  shipper_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  pickup_terminal TEXT NOT NULL,
  delivery_area TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  container_size TEXT NOT NULL,
  container_type TEXT NOT NULL DEFAULT 'DRY',
  cadence TEXT NOT NULL DEFAULT 'ONCE',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_templates_shipper ON templates(shipper_id);

CREATE TABLE IF NOT EXISTS contract_lanes (
  id SERIAL PRIMARY KEY,
  shipper_id INTEGER NOT NULL REFERENCES users(id),
  pickup_terminal TEXT NOT NULL,
  delivery_area TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  monthly_loads INTEGER NOT NULL,
  target_price_aed REAL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_contracts_shipper ON contract_lanes(shipper_id);

CREATE TABLE IF NOT EXISTS payouts (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  gross_aed REAL NOT NULL,
  platform_fee_aed REAL NOT NULL,
  net_aed REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  released_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  release_type TEXT,
  sla_deadline TEXT,
  transfer_executed_at TEXT,
  transfer_reference TEXT,
  processor_payout_status TEXT NOT NULL DEFAULT 'PENDING',
  processor_payout_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_payouts_carrier ON payouts(carrier_id);
CREATE INDEX IF NOT EXISTS idx_payouts_job ON payouts(job_id);

CREATE TABLE IF NOT EXISTS disputes (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  determination TEXT,
  decision TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_disputes_job ON disputes(job_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  entity_type TEXT,
  entity_id INTEGER,
  before_state TEXT,
  after_state TEXT,
  request_id TEXT,
  prev_hash TEXT,
  hash TEXT
);
-- Append-only: triggers prevent UPDATE/DELETE
CREATE OR REPLACE FUNCTION audit_log_no_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: UPDATE is not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_log_no_delete_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: DELETE is not permitted';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_log_no_update') THEN
    CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_no_update_fn();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_log_no_delete') THEN
    CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_no_delete_fn();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  job_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  type TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  payout_id INTEGER NOT NULL REFERENCES payouts(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  supplier_trn TEXT,
  customer_trn TEXT,
  gross_aed REAL NOT NULL,
  commission_aed REAL NOT NULL,
  vat_rate_bps INTEGER NOT NULL,
  taxable_aed REAL NOT NULL,
  vat_aed REAL NOT NULL,
  total_aed REAL NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_invoices_carrier ON invoices(carrier_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id);

-- ---------------------------------------------------------------------------
-- Enterprise tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS location_logs (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  speed REAL,
  heading REAL,
  recorded_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_location_job ON location_logs(job_id);

CREATE TABLE IF NOT EXISTS telematics_logs (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  speed REAL,
  temperature REAL,
  fuel_level REAL,
  recorded_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  raw_payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_telematics_job ON telematics_logs(job_id);

CREATE TABLE IF NOT EXISTS global_consignments (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  payload TEXT NOT NULL,
  linked_job_id INTEGER REFERENCES jobs(id),
  updated_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS compliance_declarations (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  hs_code TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  zk_proof TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  cleared_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_compliance_job ON compliance_declarations(job_id);

CREATE TABLE IF NOT EXISTS debt_instruments (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  bl_number TEXT NOT NULL,
  face_value_aed REAL NOT NULL,
  interest_rate_bps INTEGER NOT NULL,
  risk_score REAL NOT NULL,
  token_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_debt_instruments_job ON debt_instruments(job_id);

CREATE TABLE IF NOT EXISTS contract_rfps (
  id SERIAL PRIMARY KEY,
  shipper_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  total_containers INTEGER NOT NULL,
  duration_months INTEGER NOT NULL,
  budget_aed REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  awarded_carrier_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_contract_rfps_shipper ON contract_rfps(shipper_id);

CREATE TABLE IF NOT EXISTS rfp_bids (
  id SERIAL PRIMARY KEY,
  rfp_id INTEGER NOT NULL REFERENCES contract_rfps(id) ON DELETE CASCADE,
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  amount_aed REAL NOT NULL,
  eta_days INTEGER NOT NULL,
  proposal TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_rfp_bids_rfp ON rfp_bids(rfp_id);

CREATE TABLE IF NOT EXISTS rfp_milestones (
  id SERIAL PRIMARY KEY,
  rfp_id INTEGER NOT NULL REFERENCES contract_rfps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  amount_aed REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  invoice_id INTEGER REFERENCES invoices(id)
);
CREATE INDEX IF NOT EXISTS idx_rfp_milestones_rfp ON rfp_milestones(rfp_id);

CREATE TABLE IF NOT EXISTS fuel_advances (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  amount_aed REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('FUEL','SALIK')),
  status TEXT NOT NULL DEFAULT 'APPROVED',
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- Carrier driver roster — registered once per carrier org, picked from (not
-- retyped) when assigning to a job. One license doc + one vehicle doc slot
-- per driver, matching the ask exactly rather than a general multi-document
-- table this feature doesn't need.
CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  carrier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  license_number TEXT,
  license_expiry TEXT,
  license_doc_storage_path TEXT,
  license_doc_mime_type TEXT,
  vehicle_doc_storage_path TEXT,
  vehicle_doc_mime_type TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_drivers_carrier ON drivers(carrier_id);

-- jobs was created above, before drivers existed — added via ALTER rather
-- than reordering the file.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_driver_id INTEGER REFERENCES drivers(id);

-- Links a roster row to the driver's own login identity (a DRIVER seat
-- under the carrier's account).
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS seat_user_id INTEGER REFERENCES users(id);

-- Real company registration documents — profiles.insurance_uploaded was
-- previously just a self-reported boolean with no file behind it.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trade_license_doc_storage_path TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trade_license_doc_mime_type TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS insurance_doc_storage_path TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS insurance_doc_mime_type TEXT;

-- ---------------------------------------------------------------------------
-- Seed default settings (Postgres-compatible upsert)
-- ---------------------------------------------------------------------------

-- Payout idempotency column (deterministic key prevents duplicate external transfers)
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

-- Demo/investor-showcase data flag — see server/migrations/003_demo_data_flag.sql
-- for the hand-run production copy of this same change.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contract_rfps ADD COLUMN IF NOT EXISTS is_demo INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_is_demo ON users(is_demo);
CREATE INDEX IF NOT EXISTS idx_jobs_is_demo ON jobs(is_demo);
CREATE INDEX IF NOT EXISTS idx_contract_rfps_is_demo ON contract_rfps(is_demo);

-- ---------------------------------------------------------------------------
-- Financial Core v2 — double-entry ledger, webhook idempotency, payout attempts, outbox
-- ---------------------------------------------------------------------------

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
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
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

INSERT INTO settings (key, value) VALUES ('commission_rate_bps', '600')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES ('auto_release_hours', '24')
ON CONFLICT (key) DO NOTHING;

COMMIT;
