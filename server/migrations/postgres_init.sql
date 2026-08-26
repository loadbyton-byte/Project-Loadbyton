-- Postgres / Supabase init — mirrors server/db.js (SQLite) + DATA_MODEL.md
-- Run: psql $DATABASE_URL -f server/migrations/postgres_init.sql
-- Supabase: paste in SQL editor, or `supabase db push`

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SHIPPER','CARRIER','ADMIN','DRIVER')),
  is_verified INTEGER NOT NULL DEFAULT 0,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  mfa_secret TEXT,
  tier TEXT NOT NULL DEFAULT 'BRONZE',
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  org_owner_id INTEGER REFERENCES users(id),
  seat_role TEXT CHECK (seat_role IN ('OPS','FINANCE','VIEWER')),
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')::text)
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Profiles (encrypted iban/trn via enc:v1: prefix — app layer)
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
  rating_avg DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  completed_jobs INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  processor_account_id TEXT
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acting_seat_id INTEGER REFERENCES users(id),
  impersonating_admin_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Jobs (core + all legs + currency + enterprise fields)
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
  max_budget_aed DOUBLE PRECISION,
  agreed_price_aed DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'OPEN',
  awarded_bid_id INTEGER,
  notes TEXT,
  escrow_status TEXT NOT NULL DEFAULT 'PENDING',
  delivered_at TEXT,
  auto_release_processed INTEGER NOT NULL DEFAULT 0,
  payout_released_at TEXT,
  container_count INTEGER NOT NULL DEFAULT 1,
  truck_count INTEGER NOT NULL DEFAULT 1,
  equipment_type TEXT NOT NULL DEFAULT 'CONTAINER_CHASSIS',
  cargo_weight_tons DOUBLE PRECISION,
  assigned_driver_name TEXT,
  assigned_driver_phone TEXT,
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  pickup_address_detail TEXT,
  delivery_lat DOUBLE PRECISION,
  delivery_lng DOUBLE PRECISION,
  delivery_address_detail TEXT,
  shipment_type TEXT NOT NULL DEFAULT 'IMPORT',
  import_pickup_terminal TEXT,
  import_unloading_location TEXT,
  import_empty_return_location TEXT,
  export_empty_pickup_location TEXT,
  export_loading_location TEXT,
  export_deposit_terminal TEXT,
  loading_location TEXT,
  delivery_location TEXT,
  scheduled_post_at TEXT,
  processor_payment_ref TEXT,
  processor_tranref TEXT,
  processor_payment_status TEXT NOT NULL DEFAULT 'PENDING',
  processor_amount_aed DOUBLE PRECISION,
  processor_last_error TEXT,
  currency TEXT NOT NULL DEFAULT 'AED',
  country_code TEXT NOT NULL DEFAULT 'AE',
  tax_rate_bps INTEGER NOT NULL DEFAULT 500,
  tax_amount DOUBLE PRECISION,
  dp_world_e_token TEXT,
  eir_photos TEXT,
  detention_free_days INTEGER NOT NULL DEFAULT 5,
  incidentals_buffer_aed DOUBLE PRECISION,
  buffer_released INTEGER NOT NULL DEFAULT 0,
  ledger_hash TEXT,
  prev_ledger_hash TEXT,
  leg_extra_lat DOUBLE PRECISION,
  leg_extra_lng DOUBLE PRECISION,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_jobs_shipper ON jobs(shipper_id);
CREATE INDEX IF NOT EXISTS idx_jobs_carrier ON jobs(carrier_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- Bids
CREATE TABLE IF NOT EXISTS bids (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  amount_aed DOUBLE PRECISION NOT NULL,
  eta_minutes INTEGER NOT NULL DEFAULT 0,
  eta_at TEXT,
  truck_type TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_bids_job ON bids(job_id);
CREATE INDEX IF NOT EXISTS idx_bids_carrier ON bids(carrier_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_one_pending_per_carrier ON bids(job_id, carrier_id) WHERE status = 'PENDING';

-- Job documents
CREATE TABLE IF NOT EXISTS job_documents (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  storage_path TEXT,
  mime_type TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_docs_job ON job_documents(job_id);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_messages_job ON messages(job_id);

-- Ratings
CREATE TABLE IF NOT EXISTS ratings (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  rater_id INTEGER NOT NULL REFERENCES users(id),
  ratee_id INTEGER NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_ratings_job ON ratings(job_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_one_per_rater ON ratings(job_id, rater_id);

-- Payouts
CREATE TABLE IF NOT EXISTS payouts (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  gross_aed DOUBLE PRECISION NOT NULL,
  platform_fee_aed DOUBLE PRECISION NOT NULL,
  net_aed DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  release_type TEXT,
  released_at TEXT,
  sla_deadline TEXT,
  transfer_executed_at TEXT,
  transfer_reference TEXT,
  processor_payout_status TEXT NOT NULL DEFAULT 'PENDING',
  processor_payout_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_payouts_carrier ON payouts(carrier_id);
CREATE INDEX IF NOT EXISTS idx_payouts_job ON payouts(job_id);

-- Disputes
CREATE TABLE IF NOT EXISTS disputes (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  determination TEXT,
  decision TEXT CHECK (decision IN ('RELEASE_TO_CARRIER','REFUND_SHIPPER','SPLIT')),
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_disputes_job ON disputes(job_id);

-- Audit log (append-only)
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  before_state TEXT,
  after_state TEXT,
  request_id TEXT,
  prev_hash TEXT,
  hash TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
-- Postgres trigger for append-only (replaces SQLite RAISE(ABORT))
CREATE OR REPLACE FUNCTION audit_no_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only: UPDATE not permitted'; END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION audit_no_delete() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only: DELETE not permitted'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_no_update();
DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_no_delete();

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  job_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- Templates / contract lanes / invoices / idempotency / settings
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
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS contract_lanes (
  id SERIAL PRIMARY KEY,
  shipper_id INTEGER NOT NULL REFERENCES users(id),
  pickup_terminal TEXT NOT NULL,
  delivery_area TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  monthly_loads INTEGER NOT NULL,
  target_price_aed DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  payout_id INTEGER NOT NULL REFERENCES payouts(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  supplier_trn TEXT,
  customer_trn TEXT,
  gross_aed DOUBLE PRECISION NOT NULL,
  commission_aed DOUBLE PRECISION NOT NULL,
  vat_rate_bps INTEGER NOT NULL,
  taxable_aed DOUBLE PRECISION NOT NULL,
  vat_aed DOUBLE PRECISION NOT NULL,
  total_aed DOUBLE PRECISION NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('commission_rate_bps','600') ON CONFLICT DO NOTHING;
INSERT INTO settings (key, value) VALUES ('auto_release_hours','24') ON CONFLICT DO NOTHING;

-- Phase 3: location / telematics
CREATE TABLE IF NOT EXISTS location_logs (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  recorded_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_location_job ON location_logs(job_id);

CREATE TABLE IF NOT EXISTS telematics_logs (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  temperature DOUBLE PRECISION,
  fuel_level DOUBLE PRECISION,
  recorded_at TEXT NOT NULL DEFAULT (now()::text),
  raw_payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_telematics_job ON telematics_logs(job_id);

-- Phase 4: RFPs + fuel
CREATE TABLE IF NOT EXISTS contract_rfps (
  id SERIAL PRIMARY KEY,
  shipper_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  total_containers INTEGER NOT NULL,
  duration_months INTEGER NOT NULL,
  budget_aed DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  awarded_carrier_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS rfp_bids (
  id SERIAL PRIMARY KEY,
  rfp_id INTEGER NOT NULL REFERENCES contract_rfps(id) ON DELETE CASCADE,
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  amount_aed DOUBLE PRECISION NOT NULL,
  eta_days INTEGER NOT NULL,
  proposal TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS rfp_milestones (
  id SERIAL PRIMARY KEY,
  rfp_id INTEGER NOT NULL REFERENCES contract_rfps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  amount_aed DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  invoice_id INTEGER REFERENCES invoices(id)
);
CREATE TABLE IF NOT EXISTS fuel_advances (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  amount_aed DOUBLE PRECISION NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('FUEL','SALIK')),
  status TEXT NOT NULL DEFAULT 'APPROVED',
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

-- Phase 5: global consignment / compliance / debt
CREATE TABLE IF NOT EXISTS global_consignments (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  payload TEXT NOT NULL,
  linked_job_id INTEGER REFERENCES jobs(id),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS compliance_declarations (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  hs_code TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  zk_proof TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  cleared_at TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE TABLE IF NOT EXISTS debt_instruments (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  bl_number TEXT NOT NULL,
  face_value_aed DOUBLE PRECISION NOT NULL,
  interest_rate_bps INTEGER NOT NULL,
  risk_score DOUBLE PRECISION NOT NULL,
  token_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
