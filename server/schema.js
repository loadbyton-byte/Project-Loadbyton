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

  addColumn('sessions', 'impersonating_admin_id', 'impersonating_admin_id INTEGER');
  addColumn('sessions', 'acting_seat_id', 'acting_seat_id INTEGER REFERENCES users(id)');

  addColumn('payouts', 'release_type', 'release_type TEXT');

  addColumn('bids', 'driver_phone', 'driver_phone TEXT');
  addColumn('jobs', 'assigned_driver_name', 'assigned_driver_name TEXT');
  addColumn('jobs', 'assigned_driver_phone', 'assigned_driver_phone TEXT');

  addColumn('payouts', 'sla_deadline', 'sla_deadline TEXT');
  addColumn('payouts', 'transfer_executed_at', 'transfer_executed_at TEXT');
  addColumn('payouts', 'transfer_reference', 'transfer_reference TEXT');

  addColumn('users', 'org_owner_id', 'org_owner_id INTEGER REFERENCES users(id)');
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
  CREATE TABLE IF NOT EXISTS rfp_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfp_id INTEGER NOT NULL REFERENCES contract_rfps(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_at TEXT NOT NULL,
    amount_aed REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    invoice_id INTEGER REFERENCES invoices(id)
  );
  CREATE TABLE IF NOT EXISTS fuel_advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    carrier_id INTEGER NOT NULL REFERENCES users(id),
    amount_aed REAL NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('FUEL','SALIK')),
    status TEXT NOT NULL DEFAULT 'APPROVED',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
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
    amount_minor INTEGER NOT NULL CHECK (amount_minor != 0),
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
  `);

  // Seed canonical ledger accounts — idempotent
  const seedAccount = db.prepare('INSERT OR IGNORE INTO ledger_accounts (code, name, type) VALUES (?, ?, ?)');
  seedAccount.run('processor_clearing', 'Processor Clearing', 'ASSET');
  seedAccount.run('escrow_liability', 'Escrow Liability', 'LIABILITY');
  seedAccount.run('carrier_payable', 'Carrier Payable', 'LIABILITY');
  seedAccount.run('platform_revenue', 'Platform Revenue', 'REVENUE');
  seedAccount.run('refund_liability', 'Refund Liability', 'LIABILITY');

  // ---------------------------------------------------------------------------
  // Platform settings — seeded once, editable via /api/admin/settings.
  // ---------------------------------------------------------------------------

  const seedSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  seedSetting.run('commission_rate_bps', '600');
  seedSetting.run('auto_release_hours', '24');

  // ---------------------------------------------------------------------------
  // Expired sessions are purged on every boot.
  // ---------------------------------------------------------------------------

  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
};
