// Loadbyton — SQLite schema, migrations, and seed data.
// Called once at startup by server/db.js when running in SQLite mode.
// Accepts the raw node:sqlite DatabaseSync instance.

'use strict';

module.exports = function initSchema(db) {

  // ---------------------------------------------------------------------------
  // Core schema
  // ---------------------------------------------------------------------------

  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    is_verified INTEGER NOT NULL DEFAULT 0,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'BRONZE',
    referral_code TEXT UNIQUE,
    referred_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    verified_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_shipper ON jobs(shipper_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_carrier ON jobs(carrier_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

  CREATE TABLE IF NOT EXISTS bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    carrier_id INTEGER NOT NULL REFERENCES users(id),
    amount_aed REAL NOT NULL,
    eta_minutes INTEGER NOT NULL DEFAULT 0,
    eta_at TEXT,
    truck_type TEXT,
    driver_name TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bids_job ON bids(job_id);
  CREATE INDEX IF NOT EXISTS idx_bids_carrier ON bids(carrier_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_one_pending_per_carrier ON bids(job_id, carrier_id) WHERE status = 'PENDING';

  CREATE TABLE IF NOT EXISTS job_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    uploader_id INTEGER NOT NULL REFERENCES users(id),
    doc_type TEXT NOT NULL,
    title TEXT NOT NULL,
    file_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_docs_job ON job_documents(job_id);

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_job ON messages(job_id);

  -- One row per (job, role-pair) that has ever exchanged a message — created
  -- on demand, not pre-created for every job (most jobs never talk to
  -- admin). party_a_role/party_b_role are always stored in canonical order
  -- (server/lib/messaging.js's ROLE_ORDER) so "SHIPPER+ADMIN" and
  -- "ADMIN+SHIPPER" can never become two different rows for the same thread.
  CREATE TABLE IF NOT EXISTS message_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    party_a_role TEXT NOT NULL,
    party_b_role TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_job_parties ON message_threads(job_id, party_a_role, party_b_role);
  CREATE INDEX IF NOT EXISTS idx_threads_job ON message_threads(job_id);

  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    rater_id INTEGER NOT NULL REFERENCES users(id),
    ratee_id INTEGER NOT NULL REFERENCES users(id),
    score INTEGER NOT NULL,
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ratings_job ON ratings(job_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_one_per_rater ON ratings(job_id, rater_id);

  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipper_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    pickup_terminal TEXT NOT NULL,
    delivery_area TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    container_size TEXT NOT NULL,
    container_type TEXT NOT NULL DEFAULT 'DRY',
    cadence TEXT NOT NULL DEFAULT 'ONCE',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_templates_shipper ON templates(shipper_id);

  CREATE TABLE IF NOT EXISTS contract_lanes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipper_id INTEGER NOT NULL REFERENCES users(id),
    pickup_terminal TEXT NOT NULL,
    delivery_area TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    monthly_loads INTEGER NOT NULL,
    target_price_aed REAL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_contracts_shipper ON contract_lanes(shipper_id);

  CREATE TABLE IF NOT EXISTS payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    carrier_id INTEGER NOT NULL REFERENCES users(id),
    gross_aed REAL NOT NULL,
    platform_fee_aed REAL NOT NULL,
    net_aed REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    released_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_payouts_carrier ON payouts(carrier_id);
  CREATE INDEX IF NOT EXISTS idx_payouts_job ON payouts(job_id);

  CREATE TABLE IF NOT EXISTS disputes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    opened_by INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    determination TEXT,
    decision TEXT,
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_disputes_job ON disputes(job_id);

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT,
    job_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    issued_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_carrier ON invoices(carrier_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id);
  `);

  // ---------------------------------------------------------------------------
  // Migrations — columns added after first release. Idempotent on every boot.
  // ---------------------------------------------------------------------------

  function addColumn(table, column, ddl) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }

  addColumn('users', 'mfa_secret', 'mfa_secret TEXT');

  addColumn('jobs', 'delivered_at', 'delivered_at TEXT');
  addColumn('jobs', 'auto_release_processed', 'auto_release_processed INTEGER NOT NULL DEFAULT 0');
  addColumn('jobs', 'payout_released_at', 'payout_released_at TEXT');
  addColumn('jobs', 'container_count', 'container_count INTEGER NOT NULL DEFAULT 1');
  addColumn('jobs', 'truck_count', 'truck_count INTEGER NOT NULL DEFAULT 1');
  addColumn('jobs', 'equipment_type', "equipment_type TEXT NOT NULL DEFAULT 'CONTAINER_CHASSIS'");
  addColumn('jobs', 'cargo_type', "cargo_type TEXT NOT NULL DEFAULT 'GENERAL_GOODS'");
  addColumn('jobs', 'cargo_weight_tons', 'cargo_weight_tons REAL');
  // LOCAL-shipment truck specs (see web/src/lib/constants.js's
  // LOCAL_LENGTH_TYPES/LOCAL_BODY_TYPE_TYPES) — truck_length_m for the 7
  // "vehicle body" LOCAL equipment types, equipment_body_type (OPEN/COVERED)
  // for the 3 Pickup sizes. Both nullable — meaningless outside LOCAL jobs.
  addColumn('jobs', 'truck_length_m', 'truck_length_m REAL');
  addColumn('jobs', 'equipment_body_type', 'equipment_body_type TEXT');

  addColumn('sessions', 'impersonating_admin_id', 'impersonating_admin_id INTEGER');
  addColumn('sessions', 'acting_seat_id', 'acting_seat_id INTEGER REFERENCES users(id)');

  addColumn('payouts', 'release_type', 'release_type TEXT');

  addColumn('bids', 'driver_phone', 'driver_phone TEXT');
  addColumn('jobs', 'assigned_driver_name', 'assigned_driver_name TEXT');
  addColumn('jobs', 'assigned_driver_phone', 'assigned_driver_phone TEXT');
  addColumn('jobs', 'assigned_driver_id', 'assigned_driver_id INTEGER REFERENCES drivers(id)');
  addColumn('messages', 'thread_id', 'thread_id INTEGER REFERENCES message_threads(id)');
  // Postgres (migrations/postgres_init.sql) already had this index — SQLite
  // was missing it since thread_id here is a bolted-on column, not part of
  // the original CREATE TABLE that idx_messages_job sits next to.
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)');

  addColumn('payouts', 'sla_deadline', 'sla_deadline TEXT');
  addColumn('payouts', 'transfer_executed_at', 'transfer_executed_at TEXT');
  addColumn('payouts', 'transfer_reference', 'transfer_reference TEXT');

  addColumn('users', 'org_owner_id', 'org_owner_id INTEGER REFERENCES users(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_org_owner ON users(org_owner_id)');
  addColumn('users', 'seat_role', 'seat_role TEXT');
  addColumn('users', 'is_active', 'is_active INTEGER NOT NULL DEFAULT 1');
  addColumn('users', 'display_name', 'display_name TEXT');

  addColumn('audit_log', 'entity_type', 'entity_type TEXT');
  addColumn('audit_log', 'entity_id', 'entity_id INTEGER');
  addColumn('audit_log', 'before_state', 'before_state TEXT');
  addColumn('audit_log', 'after_state', 'after_state TEXT');
  addColumn('audit_log', 'request_id', 'request_id TEXT');

  addColumn('users', 'email_verified_at', 'email_verified_at TEXT');
  addColumn('users', 'email_verify_token_hash', 'email_verify_token_hash TEXT');
  addColumn('users', 'email_verify_expires', 'email_verify_expires TEXT');
  addColumn('users', 'password_reset_token_hash', 'password_reset_token_hash TEXT');
  addColumn('users', 'password_reset_expires', 'password_reset_expires TEXT');

  addColumn('notifications', 'type', "type TEXT NOT NULL DEFAULT 'system'");
  addColumn('users', 'notification_prefs_disabled', "notification_prefs_disabled TEXT NOT NULL DEFAULT ''");

  addColumn('users', 'account_approval_status', "account_approval_status TEXT NOT NULL DEFAULT 'APPROVED'");
  addColumn('users', 'account_approved_at', 'account_approved_at TEXT');

  addColumn('job_documents', 'storage_path', 'storage_path TEXT');
  addColumn('job_documents', 'mime_type', 'mime_type TEXT');

  addColumn('jobs', 'pickup_lat', 'pickup_lat REAL');
  addColumn('jobs', 'pickup_lng', 'pickup_lng REAL');
  addColumn('jobs', 'pickup_address_detail', 'pickup_address_detail TEXT');
  addColumn('jobs', 'delivery_lat', 'delivery_lat REAL');
  addColumn('jobs', 'delivery_lng', 'delivery_lng REAL');
  addColumn('jobs', 'delivery_address_detail', 'delivery_address_detail TEXT');

  addColumn('jobs', 'processor_payment_ref', 'processor_payment_ref TEXT');
  addColumn('jobs', 'processor_tranref', 'processor_tranref TEXT');
  addColumn('jobs', 'processor_payment_status', "processor_payment_status TEXT NOT NULL DEFAULT 'PENDING'");
  addColumn('jobs', 'processor_amount_aed', 'processor_amount_aed REAL');
  addColumn('jobs', 'processor_last_error', 'processor_last_error TEXT');

  addColumn('payouts', 'processor_payout_status', "processor_payout_status TEXT NOT NULL DEFAULT 'PENDING'");
  addColumn('payouts', 'processor_payout_ref', 'processor_payout_ref TEXT');

  addColumn('profiles', 'processor_account_id', 'processor_account_id TEXT');

  addColumn('bids', 'eta_at', 'eta_at TEXT');

  addColumn('jobs', 'loading_location', 'loading_location TEXT');
  addColumn('jobs', 'delivery_location', 'delivery_location TEXT');
  addColumn('jobs', 'scheduled_post_at', 'scheduled_post_at TEXT');

  addColumn('jobs', 'shipment_type', "shipment_type TEXT NOT NULL DEFAULT 'IMPORT'");
  addColumn('jobs', 'import_pickup_terminal', 'import_pickup_terminal TEXT');
  addColumn('jobs', 'import_unloading_location', 'import_unloading_location TEXT');
  addColumn('jobs', 'import_empty_return_location', 'import_empty_return_location TEXT');
  addColumn('jobs', 'export_empty_pickup_location', 'export_empty_pickup_location TEXT');
  addColumn('jobs', 'export_loading_location', 'export_loading_location TEXT');
  addColumn('jobs', 'export_deposit_terminal', 'export_deposit_terminal TEXT');
  addColumn('jobs', 'leg_extra_lat', 'leg_extra_lat REAL');
  addColumn('jobs', 'leg_extra_lng', 'leg_extra_lng REAL');

  // ---------------------------------------------------------------------------
  // audit_log append-only triggers
  // ---------------------------------------------------------------------------

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_log_no_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE is not permitted');
    END;

    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only: DELETE is not permitted');
    END;
  `);

  // ---------------------------------------------------------------------------
  // Enterprise tables (idempotent)
  // ---------------------------------------------------------------------------

  db.exec(`
  CREATE TABLE IF NOT EXISTS location_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    carrier_id INTEGER NOT NULL REFERENCES users(id),
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    speed REAL,
    heading REAL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_location_job ON location_logs(job_id);
  CREATE TABLE IF NOT EXISTS telematics_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    speed REAL,
    temperature REAL,
    fuel_level REAL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS compliance_declarations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    hs_code TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    zk_proof TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    cleared_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_compliance_job ON compliance_declarations(job_id);
  CREATE TABLE IF NOT EXISTS debt_instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    bl_number TEXT NOT NULL,
    face_value_aed REAL NOT NULL,
    interest_rate_bps INTEGER NOT NULL,
    risk_score REAL NOT NULL,
    token_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_debt_instruments_job ON debt_instruments(job_id);
  CREATE TABLE IF NOT EXISTS contract_rfps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_contract_rfps_shipper ON contract_rfps(shipper_id);
  CREATE TABLE IF NOT EXISTS rfp_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfp_id INTEGER NOT NULL REFERENCES contract_rfps(id) ON DELETE CASCADE,
    carrier_id INTEGER NOT NULL REFERENCES users(id),
    amount_aed REAL NOT NULL,
    eta_days INTEGER NOT NULL,
    proposal TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rfp_bids_rfp ON rfp_bids(rfp_id);
  CREATE TABLE IF NOT EXISTS rfp_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfp_id INTEGER NOT NULL REFERENCES contract_rfps(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_at TEXT NOT NULL,
    amount_aed REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    invoice_id INTEGER REFERENCES invoices(id)
  );
  CREATE INDEX IF NOT EXISTS idx_rfp_milestones_rfp ON rfp_milestones(rfp_id);
  CREATE TABLE IF NOT EXISTS fuel_advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    carrier_id INTEGER NOT NULL REFERENCES users(id),
    amount_aed REAL NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('FUEL','SALIK')),
    status TEXT NOT NULL DEFAULT 'APPROVED',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- The route's own SELECT-then-INSERT "already taken" check is a
  -- best-effort fast path, not the real safety boundary — two rapid
  -- concurrent requests could both pass it. This UNIQUE index is what
  -- actually blocks a duplicate advance for the same job+carrier.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_fuel_advances_job_carrier ON fuel_advances(job_id, carrier_id);
  `);

  addColumn('jobs', 'currency', "currency TEXT NOT NULL DEFAULT 'AED'");
  addColumn('jobs', 'country_code', "country_code TEXT NOT NULL DEFAULT 'AE'");
  addColumn('jobs', 'tax_rate_bps', "tax_rate_bps INTEGER NOT NULL DEFAULT 500");
  addColumn('jobs', 'tax_amount', 'tax_amount REAL');
  addColumn('jobs', 'dp_world_e_token', 'dp_world_e_token TEXT');
  addColumn('jobs', 'eir_photos', 'eir_photos TEXT');
  addColumn('jobs', 'detention_free_days', 'detention_free_days INTEGER NOT NULL DEFAULT 5');
  addColumn('jobs', 'incidentals_buffer_aed', 'incidentals_buffer_aed REAL');
  addColumn('jobs', 'buffer_released', 'buffer_released INTEGER NOT NULL DEFAULT 0');
  addColumn('jobs', 'ledger_hash', 'ledger_hash TEXT');
  addColumn('jobs', 'prev_ledger_hash', 'prev_ledger_hash TEXT');
  addColumn('audit_log', 'prev_hash', 'prev_hash TEXT');
  addColumn('audit_log', 'hash', 'hash TEXT');

  // Payout idempotency — deterministic key per payout prevents duplicate external transfers
  // SQLite does not allow UNIQUE via ALTER TABLE ADD COLUMN, so add plain column then index
  addColumn('payouts', 'idempotency_key', 'idempotency_key TEXT');

  // ---------------------------------------------------------------------------
  // Financial Core v2 — double-entry ledger, webhook idempotency, payout attempts, outbox
  // ---------------------------------------------------------------------------

  db.exec(`
  CREATE TABLE IF NOT EXISTS ledger_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','REVENUE','EXPENSE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ledger_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotency_key TEXT UNIQUE NOT NULL,
    job_id INTEGER REFERENCES jobs(id),
    payout_id INTEGER REFERENCES payouts(id),
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
    account_code TEXT NOT NULL REFERENCES ledger_accounts(code),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL DEFAULT 'AED',
    side TEXT NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    payload_hash TEXT,
    raw_payload TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS payout_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payout_id INTEGER NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    provider TEXT NOT NULL,
    amount_aed REAL NOT NULL,
    destination TEXT,
    idempotency_key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    provider_response TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS outbox_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aggregate_type TEXT NOT NULL,
    aggregate_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_entries_tx ON ledger_entries(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_code);
  CREATE INDEX IF NOT EXISTS idx_webhook_provider_event ON payment_webhook_events(provider, provider_event_id);
  CREATE INDEX IF NOT EXISTS idx_payout_attempts_payout ON payout_attempts(payout_id);
  CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_job_unique ON payouts(job_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_idempotency_key ON payouts(idempotency_key) WHERE idempotency_key IS NOT NULL;

  -- Carrier driver roster — registered once per carrier org, picked from
  -- (not retyped) when assigning to a job. One license doc + one vehicle
  -- doc slot per driver, matching the ask exactly rather than a general
  -- multi-document table this feature doesn't need.
  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_drivers_carrier ON drivers(carrier_id);
  `);

  // Links a roster row to the driver's own login identity (a DRIVER seat
  // under the carrier's account, see server/routes/fleet.routes.js's
  // POST /:id/seat) — added after CREATE TABLE drivers above since addColumn
  // needs the table to already exist.
  addColumn('drivers', 'seat_user_id', 'seat_user_id INTEGER REFERENCES users(id)');

  // Real company registration documents — profiles.insurance_uploaded was
  // previously just a self-reported boolean with no file behind it.
  addColumn('profiles', 'trade_license_doc_storage_path', 'trade_license_doc_storage_path TEXT');
  addColumn('profiles', 'trade_license_doc_mime_type', 'trade_license_doc_mime_type TEXT');
  addColumn('profiles', 'insurance_doc_storage_path', 'insurance_doc_storage_path TEXT');
  addColumn('profiles', 'insurance_doc_mime_type', 'insurance_doc_mime_type TEXT');

  // Demo/investor-showcase data flag — see server/migrations/003_demo_data_flag.sql
  // for the hand-run production (Postgres) copy of this same change.
  addColumn('users', 'is_demo', 'is_demo INTEGER NOT NULL DEFAULT 0');
  addColumn('jobs', 'is_demo', 'is_demo INTEGER NOT NULL DEFAULT 0');
  addColumn('contract_rfps', 'is_demo', 'is_demo INTEGER NOT NULL DEFAULT 0');

  // Payment tiers — a job's escrow/checkout model, set at posting time.
  // SPOT_ESCROW (the default, and today's only behavior) escrows the full
  // price at award, before pickup. PAY_ON_DELIVERY defers that to the
  // DELIVERED transition instead — see award.service.js and
  // job.service.js's updateJobStatus. CONTRACT_CREDIT and OFF_PLATFORM
  // skip per-job escrow entirely; CONTRACT_CREDIT's running credit-limit
  // ledger is deliberately not built yet, this column just lets a job be
  // tagged as belonging to that model without per-job escrow blocking it.
  // Every existing job backfills to SPOT_ESCROW via this DEFAULT, so
  // today's behavior is byte-for-byte unchanged for anything already in
  // the database.
  addColumn('jobs', 'payment_tier', "payment_tier TEXT NOT NULL DEFAULT 'SPOT_ESCROW'");
  // Shipper-side payment-history signal — distinct from a carrier's
  // rating_avg (a delivery-quality rating in the other direction) and
  // named separately on purpose so the two are never conflated. Not yet
  // computed from real signals or gated on anywhere; the field exists so
  // payment_tier eligibility has something concrete to check against once
  // that gating is built.
  addColumn('profiles', 'trust_score', 'trust_score REAL NOT NULL DEFAULT 5.0');
  // WhatsApp two-way: which channel a message came in on, plus dedup/
  // delivery-status tracking for inbound sends. Existing messages default
  // to 'WEB' since every one of them was — this doesn't retroactively
  // reclassify anything.
  addColumn('messages', 'channel', "channel TEXT NOT NULL DEFAULT 'WEB'");
  addColumn('messages', 'whatsapp_message_id', 'whatsapp_message_id TEXT');

  // Tracks Meta's 24h customer-service window per contact phone number —
  // outside that window a free-form reply can't be sent, only a
  // pre-approved template (see server/lib/whatsapp.js's sendSessionAware).
  db.exec(`
  CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    phone TEXT PRIMARY KEY,
    last_inbound_at TEXT NOT NULL,
    session_expires_at TEXT NOT NULL
  );
  `);

  // Compliance-engine foundation for the future DRIVER_ASSOCIATE role
  // (Change 25) — a vehicle as a structured, queryable entity (plate type,
  // per-emirate permits) is the single biggest gap underneath that role's
  // own guardrails ("no private plates," "auto-pause on expiry"), so this
  // is built first, before the role itself. drivers.vehicle_id is nullable
  // — a driver-with-no-truck pattern has none of their own.
  db.exec(`
  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    carrier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plate_number TEXT,
    plate_type TEXT CHECK(plate_type IN ('COMMERCIAL','PRIVATE')),
    registration_expiry TEXT,
    insurance_expiry TEXT,
    permitted_emirates TEXT,
    vehicle_reg_doc_storage_path TEXT,
    vehicle_reg_doc_mime_type TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_vehicles_carrier ON vehicles(carrier_id);

  -- Data-driven so admins can tune thresholds without a redeploy — not
  -- every rule fits the plain {field, condition} shape (two of the seeded
  -- rules below need two facts together), but keeping all of them in one
  -- table still gives one place to see/enable/disable every rule.
  CREATE TABLE IF NOT EXISTS compliance_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('RED','YELLOW','GREEN')),
    field TEXT NOT NULL,
    condition TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  );
  `);

  addColumn('drivers', 'visa_status', 'visa_status TEXT');
  addColumn('drivers', 'visa_expiry', 'visa_expiry TEXT');
  addColumn('drivers', 'license_category', 'license_category TEXT');
  addColumn('drivers', 'vehicle_id', 'vehicle_id INTEGER REFERENCES vehicles(id)');

  // Free-zone-vs-mainland gate (Change 25's operational-risk cluster) — no
  // upload UI yet, admin-settable via the same profiles-field pattern as
  // everything else in this table; the document-upload workflow is
  // deliberately follow-up work, not part of the engine itself.
  addColumn('profiles', 'is_free_zone_registered', 'is_free_zone_registered INTEGER NOT NULL DEFAULT 0');
  addColumn('profiles', 'mainland_work_permitted', 'mainland_work_permitted INTEGER NOT NULL DEFAULT 0');

  // Seed the five highest-severity/most mechanical compliance rules —
  // the rest of the 18-scenario matrix is explicit follow-up seed data,
  // not built here (see server/lib/compliance.js).
  const seedRule = db.prepare(
    `INSERT OR IGNORE INTO compliance_rules (rule_code, description, severity, field, condition) VALUES (?, ?, ?, ?, ?)`
  );
  seedRule.run('PRIVATE_PLATE', 'Private (non-commercial) plate performing paid freight work', 'RED', 'vehicle.plate_type', JSON.stringify({ op: 'eq', value: 'PRIVATE' }));
  seedRule.run('VISA_INVALID', 'Visit-visa or no valid residence visa', 'RED', 'driver.visa_status', JSON.stringify({ op: 'in', value: ['VISIT', 'NONE'] }));
  seedRule.run('VISA_EXPIRED', 'Residence visa expired', 'RED', 'driver.visa_expiry', JSON.stringify({ op: 'expired' }));
  seedRule.run('LICENSE_EXPIRED', 'Driver license expired', 'RED', 'driver.license_expiry', JSON.stringify({ op: 'expired' }));
  seedRule.run('VEHICLE_REG_EXPIRED', 'Vehicle registration expired', 'RED', 'vehicle.registration_expiry', JSON.stringify({ op: 'expired' }));
  seedRule.run('VEHICLE_INSURANCE_EXPIRED', 'Vehicle insurance expired', 'RED', 'vehicle.insurance_expiry', JSON.stringify({ op: 'expired' }));
  seedRule.run('MAINLAND_WITHOUT_PERMIT', 'Free-zone carrier on mainland without the allowed-to-work-mainland document — restrict to free-zone/port-only jobs', 'YELLOW', 'special:mainland_permit', JSON.stringify({ op: 'special' }));
  seedRule.run('OUTSIDE_PERMITTED_EMIRATES', 'Job outside this vehicle\'s permitted emirates', 'YELLOW', 'special:permitted_emirates', JSON.stringify({ op: 'special' }));

  // Multi-container-type jobs (Change 2, Prompt 2) — jobs.container_size/
  // container_type/container_count stays the "line item 1" record for
  // every existing job (zero migration needed, every current consumer
  // that reads those three columns directly keeps working unchanged);
  // this table holds any ADDITIONAL line items beyond the first for a job
  // that needs a mix (e.g. 2x 40HC + 1x 20FT in one posting). A carrier
  // still bids once, lump-sum, on the whole job — award/escrow logic is
  // unchanged, this is purely a richer description of what's being moved.
  db.exec(`
  CREATE TABLE IF NOT EXISTS job_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    container_size TEXT NOT NULL,
    container_type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_job_line_items_job ON job_line_items(job_id);
  `);

  // Live location via WhatsApp — a driver's shared-location message lands
  // here through the exact same location_logs table/GET endpoint the
  // browser-Geolocation path already uses (LiveMap.jsx), so the dashboard
  // needs no new UI to show it; `source` just distinguishes which channel
  // produced a given point. Existing rows default to 'BROWSER' — nothing
  // retroactively reclassified.
  addColumn('location_logs', 'source', "source TEXT NOT NULL DEFAULT 'BROWSER'");

  // DRIVER_ASSOCIATE Phase 1 (Change 25) — a carrier pushes a specific job
  // to a specific driver-associate; the driver accepts/declines over
  // WhatsApp (see server/routes/whatsapp.routes.js), never bids, never
  // sees the open marketplace. driver_id references the existing drivers
  // roster row (reused, not a parallel driver entity) — what's new is the
  // seat_role='DRIVER_ASSOCIATE' distinction (lib/constants.js's
  // SEAT_ROLES) and this offer/accept flow around it.
  db.exec(`
  CREATE TABLE IF NOT EXISTS trip_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    carrier_id INTEGER NOT NULL REFERENCES users(id),
    driver_id INTEGER NOT NULL REFERENCES drivers(id),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','EXPIRED')),
    decline_reason TEXT,
    offered_at TEXT NOT NULL DEFAULT (datetime('now')),
    responded_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_trip_offers_job ON trip_offers(job_id);
  CREATE INDEX IF NOT EXISTS idx_trip_offers_driver ON trip_offers(driver_id);

  -- One entry per completed job a DRIVER_ASSOCIATE executed — the running
  -- ledger behind "wallet + weekly payout." The actual weekly cadence is a
  -- carrier-driven action (mark-paid) for this first pass, not yet an
  -- automated payout schedule — stated honestly rather than implying more
  -- automation than exists, matching this codebase's existing pattern for
  -- every other "real ledger, manual settlement" piece (e.g. internal
  -- payment mode).
  CREATE TABLE IF NOT EXISTS driver_wallet_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL REFERENCES drivers(id),
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    carrier_id INTEGER NOT NULL REFERENCES users(id),
    gross_amount_aed REAL NOT NULL,
    split_bps INTEGER NOT NULL,
    driver_share_aed REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_wallet_entries_driver ON driver_wallet_entries(driver_id);
  `);

  const seedDriverAssociateSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  seedDriverAssociateSetting.run('driver_associate_default_split_bps', '8000');

  // GIT cargo insurance (Change 20) — optional per-job line item. cargo_value
  // + opt-in captured at posting (see validators/job.schema.js); the policy
  // row below is created on bind. Premium settlement rides existing rails
  // (escrow/admin) until Change 30's billing — stated honestly, not implied.
  addColumn('jobs', 'cargo_value_aed', 'cargo_value_aed REAL');
  addColumn('jobs', 'insurance_opt_in', 'insurance_opt_in INTEGER NOT NULL DEFAULT 0');
  // Priority placement (Change 30) — the actual boost the fee pays for; see
  // lib/constants.js's JOB_SORT_COLUMNS for where this is read.
  addColumn('jobs', 'priority_boost_until', 'priority_boost_until TEXT');
  db.exec(`
  CREATE TABLE IF NOT EXISTS job_insurance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    shipper_id INTEGER NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL DEFAULT 'internal',
    cargo_value_aed REAL NOT NULL,
    premium_aed REAL NOT NULL,
    coverage_aed REAL NOT NULL,
    rate_bps INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CANCELLED','EXPIRED')),
    policy_ref TEXT,
    bound_at TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_job_insurance_shipper ON job_insurance(shipper_id);
  `);
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('insurance_rate_bps', '35')`).run();

  // Change 27 (Phase 7b) — Forwarder client roster, Broker carrier roster,
  // and direct-assign columns. WhatsApp-in-dashboard + bulk CSV import are
  // explicit Phase 2 of this item (not built here).
  // One-hop broker rule is enforced in broker.routes.js: a job with
  // broker_id set rejects assignment attempts by any other broker, and a
  // broker can only direct-assign to a CARRIER/OWNER_OPERATOR in their own
  // roster — never to another broker/forwarder.
  db.exec(`
  CREATE TABLE IF NOT EXISTS forwarder_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    forwarder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_name TEXT NOT NULL,
    contact_phone TEXT,
    contact_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_forwarder_clients_owner ON forwarder_clients(forwarder_id);

  CREATE TABLE IF NOT EXISTS broker_carriers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    carrier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(broker_id, carrier_id)
  );
  CREATE INDEX IF NOT EXISTS idx_broker_carriers_broker ON broker_carriers(broker_id);
  `);
  addColumn('jobs', 'broker_id', 'broker_id INTEGER REFERENCES users(id)');
  addColumn('jobs', 'forwarder_client_id', 'forwarder_client_id INTEGER REFERENCES forwarder_clients(id)');
  addColumn('jobs', 'broker_spread_bps', 'broker_spread_bps INTEGER NOT NULL DEFAULT 0');

  // Seed canonical ledger accounts — idempotent
  const seedAccount = db.prepare('INSERT OR IGNORE INTO ledger_accounts (code, name, type) VALUES (?, ?, ?)');
  seedAccount.run('processor_clearing', 'Processor Clearing', 'ASSET');
  seedAccount.run('escrow_liability', 'Escrow Liability', 'LIABILITY');
  seedAccount.run('carrier_payable', 'Carrier Payable', 'LIABILITY');
  seedAccount.run('platform_revenue', 'Platform Revenue', 'REVENUE');
  seedAccount.run('refund_liability', 'Refund Liability', 'LIABILITY');
  seedAccount.run('fee_receivable', 'Fee Receivable', 'ASSET');

  // Change 21 — tamper-evident ledger hash chain. prev_hash/hash are set by
  // lib/ledger.js createTransaction (sha256 over prev|key|job|entries); the
  // audit_log_no_update/_no_delete triggers below are the same pattern for
  // audit_log. Existing rows backfill lazily (NULL until a new transaction
  // chains from GENESIS-or-latest — verifyChain() treats a NULL gap as
  // "pre-chain era", not as tampering).
  addColumn('ledger_transactions', 'prev_hash', 'prev_hash TEXT');
  addColumn('ledger_transactions', 'hash', 'hash TEXT');

  // Change 30 core — platform_fees: one row per fee event, reusing the
  // ledger via chargeFee() (lib/ledger.js). Status tracks collection, not
  // existence: ACCRUED bookkeeping exists in every mode; COLLECTED flips
  // when a real rail settles it (Change 30 billing follow-ups).
  db.exec(`
  CREATE TABLE IF NOT EXISTS platform_fees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fee_code TEXT NOT NULL,
    job_id INTEGER REFERENCES jobs(id),
    user_id INTEGER REFERENCES users(id),
    amount_aed REAL NOT NULL,
    amount_minor INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACCRUED' CHECK(status IN ('ACCRUED','COLLECTED','WAIVED')),
    idempotency_key TEXT UNIQUE NOT NULL,
    ledger_transaction_id INTEGER REFERENCES ledger_transactions(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_platform_fees_job ON platform_fees(job_id);
  CREATE INDEX IF NOT EXISTS idx_platform_fees_code ON platform_fees(fee_code);
  `);

  // Change 21 — two-person approval on sensitive admin actions. A requester
  // admin creates a PENDING request; a DIFFERENT admin confirms (or rejects)
  // and only confirmation executes the underlying state change via the
  // allowlisted executor in admin-approvals.routes.js. Same-admin
  // self-confirm is rejected; HSM multi-sig stays the aspirational version
  // (lib/hsm.js), this table is the real, buildable control.
  db.exec(`
  CREATE TABLE IF NOT EXISTS admin_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT NOT NULL CHECK(action_type IN ('MANUAL_ESCROW_RELEASE','MANUAL_REFUND')),
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    payload TEXT,
    requested_by INTEGER NOT NULL REFERENCES users(id),
    confirmed_by INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','REJECTED','EXECUTED')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_admin_approvals_status ON admin_approvals(status);
  `);

  // Phase 8 (Change 28 remainder) — multi-stop itinerary. The job's own
  // pickup_terminal/delivery_area stay the canonical first/last legs (every
  // existing consumer keeps working); this table holds INTERMEDIATE stops
  // (port → warehouse → multiple drops) in sequence order. Drivers execute
  // in seq order; shipper/carrier dashboards render the full itinerary.
  db.exec(`
  CREATE TABLE IF NOT EXISTS job_stops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    stop_type TEXT NOT NULL CHECK(stop_type IN ('PICKUP','DROP','WAYPOINT')),
    location TEXT NOT NULL,
    address_detail TEXT,
    lat REAL,
    lng REAL,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_job_stops_job ON job_stops(job_id, seq);
  `);

  // ---------------------------------------------------------------------------
  // Platform settings — seeded once, editable via /api/admin/settings.
  // ---------------------------------------------------------------------------

  const seedSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  seedSetting.run('commission_rate_bps', '600');
  seedSetting.run('auto_release_hours', '24');
  seedSetting.run('cancellation_fee_bps_after_award', '1000');
  seedSetting.run('priority_placement_fee_aed', '50');

  // ---------------------------------------------------------------------------
  // Equipment capacity tracking — profiles.fleet_size was a static,
  // self-reported number never checked at bid/award time, so a carrier
  // could bid on far more concurrent jobs than their fleet could ever
  // service, including capacity already privately engaged off-platform.
  // available_units is the new LIVE number: decremented automatically on
  // award, restored on delivery/cancellation, and separately reducible by
  // the carrier themselves via "mark N units externally engaged" — the
  // actual fix for a carrier who has privately committed some of their
  // fleet outside the platform. fleet_size itself stays the static
  // declared total, unchanged.
  // ---------------------------------------------------------------------------
  addColumn('profiles', 'available_units', 'available_units INTEGER');
  addColumn('profiles', 'externally_engaged_units', 'externally_engaged_units INTEGER NOT NULL DEFAULT 0');
  // Backfill available_units to fleet_size for every existing profile that
  // doesn't have it set yet (new column, so this runs once per row).
  db.exec(`UPDATE profiles SET available_units = fleet_size WHERE available_units IS NULL`);

  db.exec(`
  CREATE TABLE IF NOT EXISTS carrier_capacity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    carrier_id INTEGER NOT NULL REFERENCES users(id),
    job_id INTEGER REFERENCES jobs(id),
    event_type TEXT NOT NULL CHECK (event_type IN ('AWARDED','RESTORED','EXTERNAL_ENGAGE','EXTERNAL_RELEASE')),
    units_delta INTEGER NOT NULL,
    note TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_capacity_events_carrier ON carrier_capacity_events(carrier_id);
  `);

  // ---------------------------------------------------------------------------
  // Trust & safety: shipper payment-history score (distinct from a
  // carrier's rating_avg, which is a delivery-quality rating in the other
  // direction — named separately so the two directions are never
  // conflated), carrier reliability score (cancellation/no-show
  // accountability), and per-driver rating linkage so a pattern of issues
  // can be traced to a specific driver, not just the carrier account.
  // ---------------------------------------------------------------------------
  addColumn('profiles', 'payment_reliability_score', 'payment_reliability_score REAL NOT NULL DEFAULT 5.0');
  addColumn('profiles', 'reliability_score', 'reliability_score REAL NOT NULL DEFAULT 5.0');
  addColumn('ratings', 'driver_id', 'driver_id INTEGER REFERENCES drivers(id)');
  // Collusion-detection groundwork — capture going forward only, nothing
  // can be reconstructed retroactively for past actions. The actual
  // detection query is deliberately NOT built yet (see the planning
  // register's Change 24 note) — false positives from shared office
  // networks/VPNs need human review design first, not an automatic flag.
  addColumn('audit_log', 'ip_address', 'ip_address TEXT');
  addColumn('audit_log', 'user_agent', 'user_agent TEXT');
  addColumn('sessions', 'ip_address', 'ip_address TEXT');
  // Cancellation-fee schedule — see server/lib/constants.js's
  // CANCELLATION_FEE_BPS_AFTER_AWARD for the actual policy value.
  addColumn('jobs', 'cancellation_fee_aed', 'cancellation_fee_aed REAL');

  // ---------------------------------------------------------------------------
  // 7-bucket dispute types, typed evidence, real SLA, and a real SPLIT
  // resolution (previously accepted as a valid decision value but fell
  // through to the exact same full-release-to-carrier code path as
  // RELEASE_TO_CARRIER — a live bug, not just a missing feature).
  // ---------------------------------------------------------------------------
  addColumn('disputes', 'dispute_type', 'dispute_type TEXT');
  addColumn('disputes', 'sla_deadline', 'sla_deadline TEXT');
  addColumn('disputes', 'split_shipper_pct', 'split_shipper_pct REAL');
  addColumn('disputes', 'split_carrier_pct', 'split_carrier_pct REAL');
  addColumn('disputes', 'police_report_filed', 'police_report_filed INTEGER NOT NULL DEFAULT 0');
  addColumn('disputes', 'police_report_reference', 'police_report_reference TEXT');

  // ---------------------------------------------------------------------------
  // Terms & Conditions acceptance — a readable Terms page (web/src/pages/
  // Terms.jsx) existed with zero acceptance-recording mechanism anywhere.
  // context distinguishes a one-time SIGNUP acceptance from a per-JOB one
  // (job_id set only for the latter). terms_version is a plain string
  // (server/lib/constants.js's TERMS_VERSION) bumped by hand whenever
  // Terms.jsx's content materially changes — comparing a user's latest
  // acceptance for a context against the current version is what lets a
  // returning user skip re-accepting until it actually changes.
  // ---------------------------------------------------------------------------
  db.exec(`
  CREATE TABLE IF NOT EXISTS terms_acceptances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    terms_version TEXT NOT NULL,
    context TEXT NOT NULL CHECK (context IN ('SIGNUP','JOB')),
    job_id INTEGER REFERENCES jobs(id),
    ip_address TEXT,
    accepted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_terms_acceptances_user ON terms_acceptances(user_id, context);
  `);

  // ---------------------------------------------------------------------------
  // Pre-award negotiation + itemized ancillary charges + haulier code/token.
  // Deliberately a SEPARATE table from messages/message_threads, which are
  // scoped to jobs.carrier_id and only make sense once a carrier is
  // assigned — pre-award negotiation is commercial back-and-forth on a
  // specific bid, before any carrier is chosen, a different semantic than
  // post-award job chat. bid_ancillary_charges' two agreed_by flags require
  // BOTH the shipper and the carrier to independently confirm a charge line
  // before it counts as agreed — neither side can unilaterally mark it so.
  // ---------------------------------------------------------------------------
  db.exec(`
  CREATE TABLE IF NOT EXISTS bid_negotiations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bid_negotiations_bid ON bid_negotiations(bid_id);

  CREATE TABLE IF NOT EXISTS bid_ancillary_charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    charge_type TEXT NOT NULL CHECK (charge_type IN ('SALIK','ETOKEN','DEMURRAGE','INSPECTION_WAITING','OTHER')),
    amount_aed REAL NOT NULL,
    notes TEXT,
    proposed_by INTEGER NOT NULL REFERENCES users(id),
    agreed_by_shipper INTEGER NOT NULL DEFAULT 0,
    agreed_by_carrier INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bid_ancillary_charges_bid ON bid_ancillary_charges(bid_id);
  `);
  addColumn('bids', 'terms_confirmed_at', 'terms_confirmed_at TEXT');

  // Haulier code/token — modeled as free text, not tied to DP World's
  // specific process, so it still works for an Abu Dhabi Ports or Sharjah
  // Ports job where the actual mechanism differs (see the register's
  // Change 6 note: the marketing "whole UAE" positioning must hold up in
  // practice, not just in copy).
  addColumn('jobs', 'haulier_code', 'haulier_code TEXT');
  addColumn('jobs', 'haulier_token', 'haulier_token TEXT');
  addColumn('jobs', 'haulier_token_set_by', 'haulier_token_set_by INTEGER REFERENCES users(id)');
  addColumn('jobs', 'haulier_token_set_at', 'haulier_token_set_at TEXT');

  // EIR: a seal *number* (the actual verifiable fact in a damage/tamper
  // dispute — the photo alone only proves a seal existed, not which one)
  // captured alongside the existing photo checklist, plus splitting the
  // single eir_photos column into pickup/delivery stages so both ends of
  // the journey are documented, not just pickup.
  addColumn('jobs', 'seal_number', 'seal_number TEXT');
  addColumn('jobs', 'eir_photos_pickup', 'eir_photos_pickup TEXT');
  addColumn('jobs', 'eir_photos_delivery', 'eir_photos_delivery TEXT');
  addColumn('jobs', 'seal_number_delivery', 'seal_number_delivery TEXT');
  // Whether this job's container is sealed (carrying goods) vs. empty/
  // unsealed (a local move, or an empty-container repositioning leg) —
  // decides whether the EIR checklist requires 1 photo (Seal) or 2
  // (Right Side, Left Side). No existing field reliably implies this:
  // CARGO_TYPES has no "empty" value, and shipment_type/container_type
  // don't distinguish a loaded leg from an empty one either — checked
  // directly rather than guessed. Defaults by shipment_type (IMPORT/EXPORT
  // typically sealed customs containers; LOCAL typically not) but is a
  // real, shipper-editable field at posting time, not just a fixed rule.
  addColumn('jobs', 'requires_seal', "requires_seal INTEGER NOT NULL DEFAULT 1");

  // ---------------------------------------------------------------------------
  // Carrier onboarding: RTA permit + Haulage (goods-in-transit) insurance —
  // kept distinct from the existing generic insurance_doc_* fields, which
  // cover general business insurance, a materially different policy type.
  // ---------------------------------------------------------------------------
  addColumn('profiles', 'rta_permit_number', 'rta_permit_number TEXT');
  addColumn('profiles', 'rta_permit_doc_storage_path', 'rta_permit_doc_storage_path TEXT');
  addColumn('profiles', 'rta_permit_doc_mime_type', 'rta_permit_doc_mime_type TEXT');
  addColumn('profiles', 'haulage_insurance_doc_storage_path', 'haulage_insurance_doc_storage_path TEXT');
  addColumn('profiles', 'haulage_insurance_doc_mime_type', 'haulage_insurance_doc_mime_type TEXT');
  addColumn('profiles', 'haulage_insurance_expiry', 'haulage_insurance_expiry TEXT');

  // ---------------------------------------------------------------------------
  // CONTRACT_CREDIT — the running credit-limit ledger flagged as "not yet
  // built" when payment_tier was added above. An admin approves a shipper
  // for a limit + net terms (credit_approved_at null = not eligible);
  // award.service.js draws profiles.credit_balance_aed down at award time
  // and refuses an award that would exceed credit_limit_aed. The existing
  // `invoices` table is deliberately NOT used for this — per its own file
  // header (server/lib/invoice.js) it's a carrier-facing tax invoice for
  // Loadbyton's platform commission only, not what a shipper owes for the
  // freight itself. Instead, credit_due_at/credit_settled_at live directly
  // on the job — the natural per-debt unit here, one job = one draw
  // against the limit. Settling (admin marks credit_settled_at) restores
  // the balance by that job's agreed_price_aed; cancellation does the same
  // (job.service.js).
  // ---------------------------------------------------------------------------
  addColumn('profiles', 'credit_limit_aed', 'credit_limit_aed REAL NOT NULL DEFAULT 0');
  addColumn('profiles', 'credit_balance_aed', 'credit_balance_aed REAL NOT NULL DEFAULT 0');
  addColumn('profiles', 'credit_terms_days', 'credit_terms_days INTEGER NOT NULL DEFAULT 30');
  addColumn('profiles', 'credit_approved_at', 'credit_approved_at TEXT');
  addColumn('jobs', 'credit_due_at', 'credit_due_at TEXT');
  addColumn('jobs', 'credit_settled_at', 'credit_settled_at TEXT');

  // ---------------------------------------------------------------------------
  // Telr split-payment payout — closes the "NOT IMPLEMENTED" gap in
  // lib/payments.js's executePayout() for PAYMENTS_PROVIDER=telr. Unlike
  // Stripe Connect (charge now, transfer later as a separate call), Telr's
  // marketplace mechanism (docs.telr.com/reference/split-payment) applies
  // the carrier's share AT CHARGE-CREATION TIME via a `splits` array on the
  // order.json request — there is no later "send this carrier their money"
  // API call to make. A carrier's Split ID comes from Telr's own KYC/
  // approval process (their merchant dashboard, entirely outside this
  // platform — no self-serve onboarding API exists, unlike Stripe Connect's
  // hosted onboarding link), so it's carrier-entered here once Telr issues
  // it, the same trust level as any other self-declared bank/processor
  // detail on this table.
  // ---------------------------------------------------------------------------
  addColumn('profiles', 'telr_split_id', 'telr_split_id TEXT');
  // Durable record of whether THIS job's checkout actually included the
  // split (not just whether the carrier has a Split ID on file NOW — that
  // could be set after this job's checkout already happened without one).
  // executePayout() reads this, not the in-memory mock ledger (a plain
  // Map — doesn't survive a restart or exist on another instance), to
  // decide whether the carrier still needs a manual transfer.
  addColumn('jobs', 'telr_split_applied', 'telr_split_applied INTEGER NOT NULL DEFAULT 0');

  // ---------------------------------------------------------------------------
  // Expired sessions are purged on every boot.
  // ---------------------------------------------------------------------------

  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
};
