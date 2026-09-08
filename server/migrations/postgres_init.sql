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

-- Payment tiers — see server/schema.js (the actual auto-migrating SQLite
-- path this app runs on) for the full reasoning; mirrored here for the
-- opt-in Postgres path.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_tier TEXT NOT NULL DEFAULT 'SPOT_ESCROW';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trust_score REAL NOT NULL DEFAULT 5.0;
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
  prev_hash TEXT,
  hash TEXT,
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

-- Live location via WhatsApp + DRIVER_ASSOCIATE Phase 1 — see server/schema.js.
ALTER TABLE location_logs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'BROWSER';

CREATE TABLE IF NOT EXISTS trip_offers (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','EXPIRED')),
  decline_reason TEXT,
  offered_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_trip_offers_job ON trip_offers(job_id);
CREATE INDEX IF NOT EXISTS idx_trip_offers_driver ON trip_offers(driver_id);

CREATE TABLE IF NOT EXISTS driver_wallet_entries (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  gross_amount_aed REAL NOT NULL,
  split_bps INTEGER NOT NULL,
  driver_share_aed REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID')),
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wallet_entries_driver ON driver_wallet_entries(driver_id);

INSERT INTO settings (key, value) VALUES ('driver_associate_default_split_bps', '8000') ON CONFLICT (key) DO NOTHING;

-- WhatsApp two-way: channel + dedup tracking, and a per-phone 24h
-- customer-service-window tracker — see server/schema.js.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'WEB';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  phone TEXT PRIMARY KEY,
  last_inbound_at TEXT NOT NULL,
  session_expires_at TEXT NOT NULL
);

-- Compliance-engine foundation for the future DRIVER_ASSOCIATE role
-- (Change 25) — see server/schema.js for rationale.
CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  carrier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plate_number TEXT,
  plate_type TEXT CHECK(plate_type IN ('COMMERCIAL','PRIVATE')),
  registration_expiry TEXT,
  insurance_expiry TEXT,
  permitted_emirates TEXT,
  vehicle_reg_doc_storage_path TEXT,
  vehicle_reg_doc_mime_type TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_vehicles_carrier ON vehicles(carrier_id);

CREATE TABLE IF NOT EXISTS compliance_rules (
  id SERIAL PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('RED','YELLOW','GREEN')),
  field TEXT NOT NULL,
  condition TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS visa_status TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS visa_expiry TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_category TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES vehicles(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_free_zone_registered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mainland_work_permitted INTEGER NOT NULL DEFAULT 0;

INSERT INTO compliance_rules (rule_code, description, severity, field, condition) VALUES
  ('PRIVATE_PLATE', 'Private (non-commercial) plate performing paid freight work', 'RED', 'vehicle.plate_type', '{"op":"eq","value":"PRIVATE"}'),
  ('VISA_INVALID', 'Visit-visa or no valid residence visa', 'RED', 'driver.visa_status', '{"op":"in","value":["VISIT","NONE"]}'),
  ('VISA_EXPIRED', 'Residence visa expired', 'RED', 'driver.visa_expiry', '{"op":"expired"}'),
  ('LICENSE_EXPIRED', 'Driver license expired', 'RED', 'driver.license_expiry', '{"op":"expired"}'),
  ('VEHICLE_REG_EXPIRED', 'Vehicle registration expired', 'RED', 'vehicle.registration_expiry', '{"op":"expired"}'),
  ('VEHICLE_INSURANCE_EXPIRED', 'Vehicle insurance expired', 'RED', 'vehicle.insurance_expiry', '{"op":"expired"}'),
  ('MAINLAND_WITHOUT_PERMIT', 'Free-zone carrier on mainland without the allowed-to-work-mainland document — restrict to free-zone/port-only jobs', 'YELLOW', 'special:mainland_permit', '{"op":"special"}'),
  ('OUTSIDE_PERMITTED_EMIRATES', 'Job outside this vehicle''s permitted emirates', 'YELLOW', 'special:permitted_emirates', '{"op":"special"}')
ON CONFLICT (rule_code) DO NOTHING;
-- Multi-container-type jobs (Change 2, Prompt 2) — see server/schema.js.
CREATE TABLE IF NOT EXISTS job_line_items (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  container_size TEXT NOT NULL,
  container_type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_job_line_items_job ON job_line_items(job_id);

INSERT INTO ledger_accounts (code, name, type) VALUES ('processor_clearing', 'Processor Clearing', 'ASSET') ON CONFLICT (code) DO NOTHING;
INSERT INTO ledger_accounts (code, name, type) VALUES ('escrow_liability', 'Escrow Liability', 'LIABILITY') ON CONFLICT (code) DO NOTHING;
INSERT INTO ledger_accounts (code, name, type) VALUES ('carrier_payable', 'Carrier Payable', 'LIABILITY') ON CONFLICT (code) DO NOTHING;
INSERT INTO ledger_accounts (code, name, type) VALUES ('platform_revenue', 'Platform Revenue', 'REVENUE') ON CONFLICT (code) DO NOTHING;
INSERT INTO ledger_accounts (code, name, type) VALUES ('refund_liability', 'Refund Liability', 'LIABILITY') ON CONFLICT (code) DO NOTHING;

INSERT INTO settings (key, value) VALUES ('commission_rate_bps', '600')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES ('auto_release_hours', '24')
ON CONFLICT (key) DO NOTHING;

-- Terms & Conditions acceptance, pre-award negotiation/ancillary charges,
-- haulier code/token, and EIR seal-number/two-stage photos — see
-- server/schema.js (the actual auto-migrating SQLite path this app runs
-- on) for the full reasoning; mirrored here for the opt-in Postgres path.
CREATE TABLE IF NOT EXISTS terms_acceptances (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('SIGNUP','JOB')),
  job_id INTEGER REFERENCES jobs(id),
  ip_address TEXT,
  accepted_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_terms_acceptances_user ON terms_acceptances(user_id, context);

CREATE TABLE IF NOT EXISTS bid_negotiations (
  id SERIAL PRIMARY KEY,
  bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_bid_negotiations_bid ON bid_negotiations(bid_id);

CREATE TABLE IF NOT EXISTS bid_ancillary_charges (
  id SERIAL PRIMARY KEY,
  bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('SALIK','ETOKEN','DEMURRAGE','INSPECTION_WAITING','OTHER')),
  amount_aed REAL NOT NULL,
  notes TEXT,
  proposed_by INTEGER NOT NULL REFERENCES users(id),
  agreed_by_shipper INTEGER NOT NULL DEFAULT 0,
  agreed_by_carrier INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_bid_ancillary_charges_bid ON bid_ancillary_charges(bid_id);

ALTER TABLE bids ADD COLUMN IF NOT EXISTS terms_confirmed_at TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS haulier_code TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS haulier_token TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS haulier_token_set_by INTEGER REFERENCES users(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS haulier_token_set_at TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seal_number TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS eir_photos_pickup TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS eir_photos_delivery TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seal_number_delivery TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requires_seal INTEGER NOT NULL DEFAULT 1;
-- Phase 3: equipment capacity, trust & safety, dispute typing/SLA/split —
-- see server/schema.js (the actual auto-migrating SQLite path) for the
-- full reasoning; mirrored here for the opt-in Postgres path.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS available_units INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS externally_engaged_units INTEGER NOT NULL DEFAULT 0;
UPDATE profiles SET available_units = fleet_size WHERE available_units IS NULL;

CREATE TABLE IF NOT EXISTS carrier_capacity_events (
  id SERIAL PRIMARY KEY,
  carrier_id INTEGER NOT NULL REFERENCES users(id),
  job_id INTEGER REFERENCES jobs(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('AWARDED','RESTORED','EXTERNAL_ENGAGE','EXTERNAL_RELEASE')),
  units_delta INTEGER NOT NULL,
  note TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_capacity_events_carrier ON carrier_capacity_events(carrier_id);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS payment_reliability_score REAL NOT NULL DEFAULT 5.0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reliability_score REAL NOT NULL DEFAULT 5.0;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS driver_id INTEGER REFERENCES drivers(id);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancellation_fee_aed REAL;

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS dispute_type TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS sla_deadline TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS split_shipper_pct REAL;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS split_carrier_pct REAL;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS police_report_filed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS police_report_reference TEXT;
-- Carrier onboarding: RTA permit + haulage insurance — see server/schema.js
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rta_permit_number TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rta_permit_doc_storage_path TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rta_permit_doc_mime_type TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS haulage_insurance_doc_storage_path TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS haulage_insurance_doc_mime_type TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS haulage_insurance_expiry TEXT;

-- GIT cargo insurance (Change 20) — see server/schema.js.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cargo_value_aed REAL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS insurance_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority_boost_until TEXT;
CREATE TABLE IF NOT EXISTS job_insurance (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  shipper_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL DEFAULT 'internal',
  cargo_value_aed REAL NOT NULL,
  premium_aed REAL NOT NULL,
  coverage_aed REAL NOT NULL,
  rate_bps INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CANCELLED','EXPIRED')),
  policy_ref TEXT,
  bound_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_insurance_shipper ON job_insurance(shipper_id);
INSERT INTO settings (key, value) VALUES ('insurance_rate_bps', '35') ON CONFLICT (key) DO NOTHING;

-- Change 27 (Phase 7b) — see server/schema.js.
CREATE TABLE IF NOT EXISTS forwarder_clients (
  id SERIAL PRIMARY KEY,
  forwarder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  contact_phone TEXT,
  contact_email TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_forwarder_clients_owner ON forwarder_clients(forwarder_id);
CREATE TABLE IF NOT EXISTS broker_carriers (
  id SERIAL PRIMARY KEY,
  broker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  carrier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  UNIQUE(broker_id, carrier_id)
);
CREATE INDEX IF NOT EXISTS idx_broker_carriers_broker ON broker_carriers(broker_id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS broker_id INTEGER REFERENCES users(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS forwarder_client_id INTEGER REFERENCES forwarder_clients(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS broker_spread_bps INTEGER NOT NULL DEFAULT 0;

-- Change 21 + 30 core — see server/schema.js.
INSERT INTO ledger_accounts (code, name, type) VALUES ('fee_receivable', 'Fee Receivable', 'ASSET') ON CONFLICT (code) DO NOTHING;
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS hash TEXT;
CREATE TABLE IF NOT EXISTS platform_fees (
  id SERIAL PRIMARY KEY,
  fee_code TEXT NOT NULL,
  job_id INTEGER REFERENCES jobs(id),
  user_id INTEGER REFERENCES users(id),
  amount_aed REAL NOT NULL,
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACCRUED' CHECK(status IN ('ACCRUED','COLLECTED','WAIVED')),
  idempotency_key TEXT UNIQUE NOT NULL,
  ledger_transaction_id INTEGER REFERENCES ledger_transactions(id),
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_platform_fees_job ON platform_fees(job_id);
CREATE INDEX IF NOT EXISTS idx_platform_fees_code ON platform_fees(fee_code);
CREATE TABLE IF NOT EXISTS admin_approvals (
  id SERIAL PRIMARY KEY,
  action_type TEXT NOT NULL CHECK(action_type IN ('MANUAL_ESCROW_RELEASE','MANUAL_REFUND')),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  payload TEXT,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  confirmed_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','REJECTED','EXECUTED')),
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_approvals_status ON admin_approvals(status);

-- Phase 8 (Change 28 remainder) — see server/schema.js.
CREATE TABLE IF NOT EXISTS job_stops (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  stop_type TEXT NOT NULL CHECK(stop_type IN ('PICKUP','DROP','WAYPOINT')),
  location TEXT NOT NULL,
  address_detail TEXT,
  lat REAL,
  lng REAL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_job_stops_job ON job_stops(job_id, seq);

COMMIT;
