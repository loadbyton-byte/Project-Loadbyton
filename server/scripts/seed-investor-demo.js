// Investor demo data — creates exactly 2 accounts (1 shipper, 1 carrier)
// with a full, realistic UAE road-freight/drayage operating history covering
// nearly every platform feature, entirely isolated from real data via the
// `is_demo` flag (see server/migrations/003_demo_data_flag.sql and the
// matching query filters in job.service.js, job-extras.routes.js,
// rfp.routes.js, public.routes.js and admin.routes.js).
//
// Safe to run more than once — no-ops if the two demo accounts already exist.
// Never calls Stripe or any real payment processor: every payout/invoice/
// refund below is written directly into the database already in its final,
// settled state.
//
// Run inside the production container after the 003 migration has been
// applied and the container has been rebuilt with this file present:
//   docker exec loadbyton node server/scripts/seed-investor-demo.js

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { encryptField } = require('../lib/crypto');
const { getSettings, notify, saveUploadedFile } = require('../lib/helpers');
const { issueInvoice } = require('../lib/invoice');

const SHIPPER_EMAIL = 'demo.shipper@loadbyton-demo.ae';
const CARRIER_EMAIL = 'demo.carrier@loadbyton-demo.ae';
const SHIPPER_SEAT_EMAIL = 'ops@loadbyton-demo.ae';

function iso(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 3600 * 1000).toISOString();
}

function id(row) {
  return Number(row.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// A tiny, byte-accurate, valid single-page PDF — used as a real placeholder
// for every "document" this script uploads (licenses, POD, manifests, EIR
// photos) so they actually open when clicked instead of being broken links.
// application/pdf is the only human-readable type in this app's upload
// allowlist (server/lib/storage.js's ALLOWED_UPLOAD_MIME_TYPES) — jpeg/png/
// webp would need a real image encoder this project doesn't have installed.
// ---------------------------------------------------------------------------
function makeDemoPdf(lines) {
  const esc = (s) => String(s).replace(/([()\\])/g, '\\$1');
  const body = lines
    .map((l, i) => `1 0 0 1 50 ${740 - i * 24} Tm (${esc(l)}) Tj`)
    .join('\n');
  const content = `BT /F1 13 Tf\n${body}\nET`;
  const contentLength = Buffer.byteLength(content, 'utf8');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

async function uploadDemoDoc(prefix, ...lines) {
  const buf = makeDemoPdf(['DEMO SAMPLE DOCUMENT — not a real record', '', ...lines]);
  const { storagePath, mimeType } = await saveUploadedFile(prefix, 'application/pdf', buf.toString('base64'));
  return { storagePath, mimeType };
}

async function main() {
  const already = await db.prepare('SELECT id FROM users WHERE email=?').get(SHIPPER_EMAIL);
  if (already) {
    console.log('[seed-investor-demo] demo accounts already exist — nothing to do.');
    return;
  }

  const password = crypto.randomBytes(9).toString('base64url'); // e.g. "kQ3z9F..." — printed once below, never stored in plaintext
  const passwordHash = bcrypt.hashSync(password, 10);
  const { commission_rate_bps } = await getSettings();
  const rate = commission_rate_bps / 10000;
  const fee = (amount) => Math.round(amount * rate);

  // ---------------------------------------------------------------------
  // 1. The two accounts
  // ---------------------------------------------------------------------
  const shipperResult = await db
    .prepare(
      `INSERT INTO users (email, password_hash, role, is_verified, tier, referral_code, email_verified_at, account_approval_status, account_approved_at, is_demo)
       VALUES (?,?,?,?,?,?,?,?,?,1) RETURNING id`
    )
    .run(SHIPPER_EMAIL, passwordHash, 'SHIPPER', 1, 'GOLD', 'DEMO-SHIPPER', iso(0), 'APPROVED', iso(0));
  const shipperId = id(shipperResult);

  const carrierResult = await db
    .prepare(
      `INSERT INTO users (email, password_hash, role, is_verified, tier, referral_code, email_verified_at, account_approval_status, account_approved_at, is_demo)
       VALUES (?,?,?,?,?,?,?,?,?,1) RETURNING id`
    )
    .run(CARRIER_EMAIL, passwordHash, 'CARRIER', 1, 'GOLD', 'DEMO-CARRIER', iso(0), 'APPROVED', iso(0));
  const carrierId = id(carrierResult);

  const shipperTradeLicense = await uploadDemoDoc(`profiles/${shipperId}`, 'Trade License — Falconview Demo Trading LLC');
  const shipperInsurance = await uploadDemoDoc(`profiles/${shipperId}`, 'Insurance Certificate — Falconview Demo Trading LLC');
  await db
    .prepare(
      `INSERT INTO profiles (user_id, company_name, trn_number, trade_license_number, phone, iban, coverage_zones, insurance_uploaded, rating_avg, completed_jobs, verified_at, trade_license_doc_storage_path, trade_license_doc_mime_type, insurance_doc_storage_path, insurance_doc_mime_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      shipperId,
      'Falconview Demo Trading LLC',
      encryptField('100234567800003'),
      'CN-1044829',
      '+971501234567',
      encryptField('AE070331234567890123456'),
      'Dubai, Abu Dhabi',
      1,
      4.8,
      9,
      iso(-1440),
      shipperTradeLicense.storagePath,
      shipperTradeLicense.mimeType,
      shipperInsurance.storagePath,
      shipperInsurance.mimeType
    );

  const carrierTradeLicense = await uploadDemoDoc(`profiles/${carrierId}`, 'Trade License — Al Waha Demo Logistics');
  const carrierInsurance = await uploadDemoDoc(`profiles/${carrierId}`, 'Insurance Certificate — Al Waha Demo Logistics');
  await db
    .prepare(
      `INSERT INTO profiles (user_id, company_name, trn_number, trade_license_number, phone, iban, coverage_zones, fleet_size, owned_chassis, insurance_uploaded, rating_avg, completed_jobs, verified_at, trade_license_doc_storage_path, trade_license_doc_mime_type, insurance_doc_storage_path, insurance_doc_mime_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      carrierId,
      'Al Waha Demo Logistics',
      encryptField('100987654300003'),
      'CN-2098111',
      '+971509876543',
      encryptField('AE070339876543210987654'),
      'Dubai, Sharjah',
      6,
      4,
      1,
      4.9,
      14,
      iso(-2000),
      carrierTradeLicense.storagePath,
      carrierTradeLicense.mimeType,
      carrierInsurance.storagePath,
      carrierInsurance.mimeType
    );

  // A second team member under the shipper — shows the multi-user org/team feature
  const seatHash = bcrypt.hashSync(password, 10);
  await db
    .prepare(
      `INSERT INTO users (email, password_hash, role, tier, org_owner_id, seat_role, display_name, is_verified, is_demo)
       VALUES (?,?,?,?,?,?,?,?,1)`
    )
    .run(SHIPPER_SEAT_EMAIL, seatHash, 'SHIPPER', 'BRONZE', shipperId, 'OPS', 'Amina — Ops Coordinator', 1);

  // ---------------------------------------------------------------------
  // 2. Fleet — 2 drivers under the demo carrier, with real (placeholder) docs
  // ---------------------------------------------------------------------
  const driver1License = await uploadDemoDoc(`drivers/${carrierId}`, 'UAE Driving License — Rashid Al Mheiri');
  const driver1Vehicle = await uploadDemoDoc(`drivers/${carrierId}`, 'Vehicle Registration — Truck DXB-A-44219');
  const driver1 = id(
    await db
      .prepare(
        `INSERT INTO drivers (carrier_id, name, phone, license_number, license_expiry, license_doc_storage_path, license_doc_mime_type, vehicle_doc_storage_path, vehicle_doc_mime_type, is_active)
         VALUES (?,?,?,?,?,?,?,?,?,1) RETURNING id`
      )
      .run(carrierId, 'Rashid Al Mheiri', '+971551234567', 'DXB-DL-887215', iso(24 * 365), driver1License.storagePath, driver1License.mimeType, driver1Vehicle.storagePath, driver1Vehicle.mimeType)
  );
  const driver2License = await uploadDemoDoc(`drivers/${carrierId}`, 'UAE Driving License — Prakash Nair');
  const driver2Vehicle = await uploadDemoDoc(`drivers/${carrierId}`, 'Vehicle Registration — Truck DXB-B-90142');
  const driver2 = id(
    await db
      .prepare(
        `INSERT INTO drivers (carrier_id, name, phone, license_number, license_expiry, license_doc_storage_path, license_doc_mime_type, vehicle_doc_storage_path, vehicle_doc_mime_type, is_active)
         VALUES (?,?,?,?,?,?,?,?,?,1) RETURNING id`
      )
      .run(carrierId, 'Prakash Nair', '+971557654321', 'DXB-DL-441029', iso(24 * 400), driver2License.storagePath, driver2License.mimeType, driver2Vehicle.storagePath, driver2Vehicle.mimeType)
  );

  // ---------------------------------------------------------------------
  // 3. The 11 job scenarios
  // ---------------------------------------------------------------------
  async function insertJob(fields) {
    const cols = Object.keys(fields);
    const placeholders = cols.map(() => '?').join(',');
    const r = await db
      .prepare(`INSERT INTO jobs (${cols.join(',')}, is_demo) VALUES (${placeholders}, 1) RETURNING id`)
      .run(...cols.map((c) => fields[c]));
    return id(r);
  }

  const baseJob = (code, note) => ({
    job_code: code,
    shipper_id: shipperId,
    container_size: '40FT',
    container_type: 'DRY',
    equipment_type: 'CONTAINER_CHASSIS',
    cargo_type: 'GENERAL_GOODS',
    notes: note,
  });

  // #1 — open load, bid pending
  const job1 = await insertJob({
    ...baseJob('DEMO-1001', 'DEMO SCENARIO: a freshly posted open load, currently taking bids from carriers — shows the core posting → bidding flow.'),
    pickup_terminal: 'JEBEL_ALI_T1',
    delivery_area: 'AL_QUOZ',
    delivery_address: 'Al Quoz Industrial Area 3, Dubai',
    ready_at: iso(24),
    deadline: iso(96),
    max_budget_aed: 1200,
    status: 'OPEN',
    escrow_status: 'PENDING',
  });
  await db
    .prepare(`INSERT INTO bids (job_id, carrier_id, amount_aed, eta_minutes, truck_type, driver_name, driver_phone, notes, status) VALUES (?,?,?,?,?,?,?,?, 'PENDING')`)
    .run(job1, carrierId, 1100, 90, 'Flatbed', 'Rashid Al Mheiri', '+971551234567', 'Can collect within 2 hours of award.');

  // #2 — open load, cancelled by shipper before award
  const job2 = await insertJob({
    ...baseJob('DEMO-1002', 'DEMO SCENARIO: the shipper cancelled this load before choosing a carrier — no carrier was ever involved, no money ever moved.'),
    pickup_terminal: 'JEBEL_ALI_T2',
    delivery_area: 'DIP',
    delivery_address: 'Dubai Investment Park, Dubai',
    ready_at: iso(-48),
    deadline: iso(-24),
    max_budget_aed: 1450,
    status: 'CANCELLED',
    escrow_status: 'PENDING',
  });
  void job2;

  // #3 — awarded, then cancelled by the carrier
  const job3 = await insertJob({
    ...baseJob('DEMO-1003', 'DEMO SCENARIO: the carrier accepted this job, then backed out after being awarded — escrow was released back (refunded) to the shipper automatically.'),
    pickup_terminal: 'KHALIFA_PORT',
    delivery_area: 'MUSAFFAH',
    delivery_address: 'Musaffah Industrial, Abu Dhabi',
    ready_at: iso(-72),
    deadline: iso(-48),
    max_budget_aed: 980,
    agreed_price_aed: 950,
    carrier_id: carrierId,
    status: 'CANCELLED',
    escrow_status: 'RELEASED',
  });
  await db
    .prepare(`INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status) VALUES (?,?,?,?,?, 'CANCELLED')`)
    .run(job3, carrierId, 950, fee(950), 950 - fee(950));

  // #4 — awarded, then cancelled by the shipper after granting
  const job4 = await insertJob({
    ...baseJob('DEMO-1004', 'DEMO SCENARIO: the shipper cancelled after already awarding the job — a real, committed booking being called off, handled the same way as a carrier-side cancellation.'),
    pickup_terminal: 'PORT_KHALID',
    delivery_area: 'SHARJAH_INDUSTRIAL',
    delivery_address: 'Sharjah Industrial Area 7',
    ready_at: iso(-30),
    deadline: iso(-6),
    max_budget_aed: 820,
    agreed_price_aed: 780,
    carrier_id: carrierId,
    status: 'CANCELLED',
    escrow_status: 'RELEASED',
  });
  await db
    .prepare(`INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status) VALUES (?,?,?,?,?, 'CANCELLED')`)
    .run(job4, carrierId, 780, fee(780), 780 - fee(780));

  // #5 — in transit, running normally, live GPS + telematics
  const job5 = await insertJob({
    ...baseJob('DEMO-1005', 'DEMO SCENARIO: a load currently in transit and on schedule — shows live GPS tracking and a hardware telematics reading (speed/fuel/temperature) from the truck.'),
    pickup_terminal: 'JEBEL_ALI_T1',
    delivery_area: 'AL_QUSAIS',
    delivery_address: 'Al Qusais Industrial 4, Dubai',
    ready_at: iso(-6),
    deadline: iso(6),
    max_budget_aed: 1500,
    agreed_price_aed: 1450,
    carrier_id: carrierId,
    assigned_driver_name: 'Rashid Al Mheiri',
    assigned_driver_phone: '+971551234567',
    assigned_driver_id: driver1,
    status: 'IN_TRANSIT',
    escrow_status: 'HELD',
  });
  await db.prepare(`INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status) VALUES (?,?,?,?,?, 'PENDING')`).run(job5, carrierId, 1450, fee(1450), 1450 - fee(1450));
  const route5 = [
    [25.0116, 55.1281],
    [25.05, 55.22],
    [25.09, 55.29],
    [25.12, 55.33],
  ];
  for (let i = 0; i < route5.length; i++) {
    await db
      .prepare(`INSERT INTO location_logs (job_id, carrier_id, lat, lng, speed, recorded_at) VALUES (?,?,?,?,?,?)`)
      .run(job5, carrierId, route5[i][0], route5[i][1], 62 + i * 3, iso(-6 + i * 1.5));
  }
  await db
    .prepare(`INSERT INTO telematics_logs (device_id, job_id, lat, lng, speed, temperature, fuel_level, raw_payload) VALUES (?,?,?,?,?,?,?,?)`)
    .run('DEMO-DEVICE-01', job5, route5[3][0], route5[3][1], 68, 4.2, 71, JSON.stringify({ demo: true }));

  // #6 — in transit but delayed at the port, detention alarm + fuel advance
  const job6 = await insertJob({
    ...baseJob(
      'DEMO-1006',
      'DEMO SCENARIO: the container has sat at the destination past its free time — this triggers the platform\'s demurrage/detention alarm, a very real Jebel Ali/Khalifa-port pain point. The carrier also requested a mid-trip fuel advance on this job.'
    ),
    pickup_terminal: 'JEBEL_ALI_T4',
    delivery_area: 'DUBAI_SOUTH',
    delivery_address: 'Dubai South Logistics District',
    ready_at: iso(-200),
    deadline: iso(-150),
    max_budget_aed: 1350,
    agreed_price_aed: 1300,
    carrier_id: carrierId,
    assigned_driver_name: 'Prakash Nair',
    assigned_driver_phone: '+971557654321',
    assigned_driver_id: driver2,
    status: 'IN_TRANSIT',
    escrow_status: 'HELD',
    delivered_at: iso(-168), // 7 days ago — past the 5-day free time, triggers the OVERDUE detention alarm
    detention_free_days: 5,
    incidentals_buffer_aed: 350,
  });
  await db.prepare(`INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status) VALUES (?,?,?,?,?, 'PENDING')`).run(job6, carrierId, 1300, fee(1300), 1300 - fee(1300));
  await db.prepare(`INSERT INTO fuel_advances (job_id, carrier_id, amount_aed, type, status) VALUES (?,?,?, 'FUEL', 'APPROVED')`).run(job6, carrierId, 200);

  // #7 — completed happy path, full paperwork
  const job7 = await insertJob({
    ...baseJob('DEMO-1007', 'DEMO SCENARIO: a completed, fully paid job — the clean reference case. Proof of delivery, ratings both ways, an auto-generated invoice and a released payout, all viewable and printable.'),
    pickup_terminal: 'JEBEL_ALI_T2',
    delivery_area: 'JAFZA_SOUTH',
    delivery_address: 'JAFZA South, Dubai',
    ready_at: iso(-120),
    deadline: iso(-96),
    max_budget_aed: 500,
    agreed_price_aed: 480,
    carrier_id: carrierId,
    assigned_driver_name: 'Rashid Al Mheiri',
    assigned_driver_phone: '+971551234567',
    assigned_driver_id: driver1,
    status: 'COMPLETED',
    escrow_status: 'RELEASED',
    delivered_at: iso(-100),
    payout_released_at: iso(-99),
  });
  await db
    .prepare(`INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, release_type, released_at, sla_deadline) VALUES (?,?,?,?,?, 'RELEASED', 'MANUAL', ?, ?)`)
    .run(job7, carrierId, 480, fee(480), 480 - fee(480), iso(-99), iso(-51));
  const pod7 = await uploadDemoDoc(`jobs/${job7}`, 'Proof of Delivery — DEMO-1007', 'Signed by receiver at JAFZA South');
  await db.prepare(`INSERT INTO job_documents (job_id, uploader_id, doc_type, title, file_url, storage_path, mime_type) VALUES (?,?,'POD',?,?,?,?)`).run(job7, carrierId, 'Proof of Delivery — DEMO-1007', pod7.storagePath, pod7.storagePath, pod7.mimeType);
  await db.prepare(`INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment) VALUES (?,?,?,5,?)`).run(job7, shipperId, carrierId, 'On time, careful handling — would book again.');
  await db.prepare(`INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment) VALUES (?,?,?,5,?)`).run(job7, carrierId, shipperId, 'Clear instructions, fast payment.');
  await issueInvoice(db, job7);
  // Tokenized invoice / financing record — the invoice-financing feature, shown on this one clean job
  const laneKey7 = 'JEBEL_ALI_T2->JAFZA_SOUTH';
  await db
    .prepare(`INSERT INTO debt_instruments (job_id, bl_number, face_value_aed, interest_rate_bps, risk_score, token_id) VALUES (?,?,?,?,?,?)`)
    .run(job7, 'BL-DEMO-778812', 480, 1180, 0.18, `BLT-${crypto.randomBytes(6).toString('hex').toUpperCase()}`);
  void laneKey7;

  // #8 — completed, disputed, resolved fully in the carrier's favor
  const job8 = await insertJob({
    ...baseJob('DEMO-1008', 'DEMO SCENARIO: the shipper raised a dispute claiming late delivery — after review, the platform resolved it fully in the carrier\'s favor and released the full payout.'),
    pickup_terminal: 'JEBEL_ALI_T1',
    delivery_area: 'AL_QUOZ',
    delivery_address: 'Al Quoz Industrial Area 1, Dubai',
    ready_at: iso(-260),
    deadline: iso(-236),
    max_budget_aed: 900,
    agreed_price_aed: 860,
    carrier_id: carrierId,
    assigned_driver_name: 'Prakash Nair',
    assigned_driver_phone: '+971557654321',
    assigned_driver_id: driver2,
    status: 'COMPLETED',
    escrow_status: 'RELEASED',
    delivered_at: iso(-240),
    payout_released_at: iso(-220),
  });
  await db
    .prepare(`INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, release_type, released_at, sla_deadline) VALUES (?,?,?,?,?, 'RELEASED', 'DISPUTE_RESOLUTION', ?, ?)`)
    .run(job8, carrierId, 860, fee(860), 860 - fee(860), iso(-220), iso(-172));
  const adminRow = await db.prepare(`SELECT id FROM users WHERE role='ADMIN' AND is_demo=0 ORDER BY id ASC LIMIT 1`).get();
  await db
    .prepare(`INSERT INTO disputes (job_id, opened_by, reason, status, determination, decision, resolved_by, resolved_at) VALUES (?,?,?, 'RESOLVED', ?, 'RELEASE_TO_CARRIER', ?, ?)`)
    .run(job8, shipperId, 'Shipper claimed delivery was 6 hours late.', 'Delivery timestamp confirmed within the agreed window via GPS trail — claim not upheld.', adminRow ? adminRow.id : shipperId, iso(-222));
  await issueInvoice(db, job8);

  // #9 — completed, disputed, resolved as a split decision
  const job9 = await insertJob({
    ...baseJob('DEMO-1009', 'DEMO SCENARIO: a cargo-condition dispute where the platform mediated and split the payment between shipper and carrier — the more nuanced dispute outcome, alongside #8\'s clean-win outcome.'),
    pickup_terminal: 'KHALIFA_PORT',
    delivery_area: 'MUSAFFAH',
    delivery_address: 'Musaffah Industrial, Abu Dhabi',
    ready_at: iso(-300),
    deadline: iso(-276),
    max_budget_aed: 1000,
    agreed_price_aed: 960,
    carrier_id: carrierId,
    assigned_driver_name: 'Rashid Al Mheiri',
    assigned_driver_phone: '+971551234567',
    assigned_driver_id: driver1,
    status: 'COMPLETED',
    escrow_status: 'RELEASED',
    delivered_at: iso(-280),
    payout_released_at: iso(-260),
  });
  await db
    .prepare(`INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, release_type, released_at, sla_deadline) VALUES (?,?,?,?,?, 'RELEASED', 'DISPUTE_RESOLUTION', ?, ?)`)
    .run(job9, carrierId, 960, fee(960), 960 - fee(960), iso(-260), iso(-212));
  await db
    .prepare(`INSERT INTO disputes (job_id, opened_by, reason, status, determination, decision, resolved_by, resolved_at) VALUES (?,?,?, 'RESOLVED', ?, 'SPLIT', ?, ?)`)
    .run(job9, shipperId, 'Shipper reported minor cargo damage on arrival, disputed the full amount.', 'Partial responsibility found on both sides — platform mediated a split settlement rather than a full reversal.', adminRow ? adminRow.id : shipperId, iso(-262));
  await issueInvoice(db, job9);

  // #10 — import shipment, compliance clearance + e-Token + EIR
  const job10 = await insertJob({
    ...baseJob('DEMO-1010', 'DEMO SCENARIO: an import shipment requiring customs/compliance clearance, a DP World e-Token gate pass, and the 3-photo container interchange (EIR) check — shows the import-specific and container-handover features together.'),
    pickup_terminal: 'JEBEL_ALI_T1',
    delivery_area: 'AL_QUOZ',
    delivery_address: 'Al Quoz Industrial Area 2, Dubai',
    ready_at: iso(-100),
    deadline: iso(-76),
    max_budget_aed: 1600,
    agreed_price_aed: 1550,
    carrier_id: carrierId,
    assigned_driver_name: 'Prakash Nair',
    assigned_driver_phone: '+971557654321',
    assigned_driver_id: driver2,
    status: 'COMPLETED',
    escrow_status: 'RELEASED',
    delivered_at: iso(-84),
    payout_released_at: iso(-80),
    shipment_type: 'IMPORT',
    import_pickup_terminal: 'JEBEL_ALI_T1',
    import_unloading_location: 'Al Quoz Industrial Area 2, Dubai',
    import_empty_return_location: 'JEBEL_ALI_T1',
    container_number: 'MSKU7291884',
    dp_world_e_token: 'ETK-DEMO-88213A',
  });
  await db
    .prepare(`INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, release_type, released_at, sla_deadline) VALUES (?,?,?,?,?, 'RELEASED', 'MANUAL', ?, ?)`)
    .run(job10, carrierId, 1550, fee(1550), 1550 - fee(1550), iso(-80), iso(-32));
  await db
    .prepare(`INSERT INTO compliance_declarations (job_id, hs_code, manifest_hash, zk_proof, status, cleared_at) VALUES (?,?,?,?, 'CLEARED', ?)`)
    .run(job10, '8471.30', crypto.createHash('sha256').update(`DEMO-MANIFEST-${job10}`).digest('hex'), `zk-demo-${crypto.randomBytes(8).toString('hex')}`, iso(-95));
  const eirLabels = ['Seal', 'Right Side', 'Left Side'];
  const eirPaths = [];
  for (const label of eirLabels) {
    const doc = await uploadDemoDoc(`jobs/${job10}`, `EIR ${label} — DEMO-1010`, 'Container MSKU7291884');
    eirPaths.push(doc.storagePath);
    await db.prepare(`INSERT INTO job_documents (job_id, uploader_id, doc_type, title, file_url, storage_path, mime_type) VALUES (?,?,'EIR',?,?,?,?)`).run(job10, carrierId, `EIR ${label} — DEMO-1010`, doc.storagePath, doc.storagePath, doc.mimeType);
  }
  await db.prepare(`UPDATE jobs SET eir_photos=? WHERE id=?`).run(JSON.stringify(eirPaths), job10);
  await issueInvoice(db, job10);

  // #11 — export shipment, completed
  const job11 = await insertJob({
    ...baseJob('DEMO-1011', 'DEMO SCENARIO: an export shipment (reverse direction of #10) — confirms the export-specific fields and flow work end to end too.'),
    pickup_terminal: 'JEBEL_ALI_T2',
    delivery_area: 'JAFZA_SOUTH',
    delivery_address: 'JAFZA South, Dubai',
    ready_at: iso(-60),
    deadline: iso(-36),
    max_budget_aed: 700,
    agreed_price_aed: 670,
    carrier_id: carrierId,
    assigned_driver_name: 'Rashid Al Mheiri',
    assigned_driver_phone: '+971551234567',
    assigned_driver_id: driver1,
    status: 'COMPLETED',
    escrow_status: 'RELEASED',
    delivered_at: iso(-44),
    payout_released_at: iso(-40),
    shipment_type: 'EXPORT',
    export_empty_pickup_location: 'JAFZA South Depot, Dubai',
    export_loading_location: 'JAFZA South, Dubai',
    export_deposit_terminal: 'JEBEL_ALI_T2',
    container_number: 'TCLU4471209',
  });
  await db
    .prepare(`INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, release_type, released_at, sla_deadline) VALUES (?,?,?,?,?, 'RELEASED', 'MANUAL', ?, ?)`)
    .run(job11, carrierId, 670, fee(670), 670 - fee(670), iso(-40), iso(8));
  await issueInvoice(db, job11);

  // ---------------------------------------------------------------------
  // 4. Templates + recurring contract lane
  // ---------------------------------------------------------------------
  await db
    .prepare(`INSERT INTO templates (shipper_id, name, pickup_terminal, delivery_area, delivery_address, container_size, container_type, cadence, notes) VALUES (?,?,?,?,?,?,?, 'WEEKLY', ?)`)
    .run(shipperId, 'Jebel Ali → Al Quoz (weekly)', 'JEBEL_ALI_T1', 'AL_QUOZ', 'Al Quoz Industrial Area 3, Dubai', '40FT', 'DRY', 'DEMO SCENARIO: a saved template for a lane the shipper books every week — repost in one click instead of re-entering details each time.');

  await db
    .prepare(`INSERT INTO contract_lanes (shipper_id, pickup_terminal, delivery_area, delivery_address, monthly_loads, target_price_aed, status) VALUES (?,?,?,?,?,?, 'ACTIVE')`)
    .run(shipperId, 'JEBEL_ALI_T2', 'JAFZA_SOUTH', 'JAFZA South, Dubai', 20, 470);

  // ---------------------------------------------------------------------
  // 5. RFP (enterprise contract tender) with a bid from the demo carrier
  // ---------------------------------------------------------------------
  const rfpResult = await db
    .prepare(
      `INSERT INTO contract_rfps (shipper_id, title, description, origin, destination, total_containers, duration_months, budget_aed, is_demo)
       VALUES (?,?,?,?,?,?,?,?,1) RETURNING id`
    )
    .run(
      shipperId,
      'Quarterly Jebel Ali → Dubai South drayage contract',
      'DEMO SCENARIO: an enterprise-style tender for a recurring block of containers over 3 months, with monthly milestone payments — shows the RFP/contract-tender workflow.',
      'JEBEL_ALI_T4',
      'DUBAI_SOUTH',
      45,
      3,
      54000
    );
  const rfpId = id(rfpResult);
  for (let m = 1; m <= 3; m++) {
    await db
      .prepare(`INSERT INTO rfp_milestones (rfp_id, title, due_at, amount_aed) VALUES (?,?,?,?)`)
      .run(rfpId, `Milestone ${m}/3`, iso(24 * 30 * m), 18000);
  }
  await db
    .prepare(`INSERT INTO rfp_bids (rfp_id, carrier_id, amount_aed, eta_days, proposal, status) VALUES (?,?,?,?,?, 'PENDING')`)
    .run(rfpId, carrierId, 52500, 3, 'Al Waha Demo Logistics — dedicated 2-truck allocation for this lane, weekly capacity confirmed.');

  // ---------------------------------------------------------------------
  // 6. Messaging across a few different jobs
  // ---------------------------------------------------------------------
  async function thread(jobId, exchanges) {
    const t = id(await db.prepare(`INSERT INTO message_threads (job_id, party_a_role, party_b_role) VALUES (?, 'SHIPPER', 'CARRIER') RETURNING id`).run(jobId));
    for (const [senderId, content, hoursAgo] of exchanges) {
      await db.prepare(`INSERT INTO messages (job_id, sender_id, thread_id, content, is_read, created_at) VALUES (?,?,?,?,1,?)`).run(jobId, senderId, t, content, iso(hoursAgo));
    }
  }
  await thread(job7, [
    [shipperId, 'Please confirm pickup slot for tomorrow morning.', -102],
    [carrierId, 'Confirmed — driver Rashid will be at JAFZA South by 8am.', -101.5],
    [shipperId, 'Perfect, thank you.', -101],
  ]);
  await thread(job6, [
    [carrierId, 'Container is still held at the yard — free time has lapsed, requesting a fuel advance to cover the extra runs.', -168],
    [shipperId, 'Approved, please keep us posted on release.', -166],
  ]);
  await thread(job9, [
    [shipperId, 'Cargo arrived with a damaged pallet on one side — raising this for review.', -282],
    [carrierId, 'Understood, photos were taken at both pickup and drop — sharing with the platform for review.', -281],
  ]);

  // ---------------------------------------------------------------------
  // 7. Notifications
  // ---------------------------------------------------------------------
  await notify(shipperId, 'Bid received', 'DEMO-1001 received a new bid.', job1, 'bid');
  await notify(shipperId, 'Payout released', 'DEMO-1007 was completed and the payout was released.', job7, 'payout');
  await notify(shipperId, 'Dispute resolved', 'DEMO-1009 dispute was resolved as a split settlement.', job9, 'dispute');
  await notify(carrierId, 'Job awarded', 'You were awarded DEMO-1005.', job5, 'award');
  await notify(carrierId, 'Funds on the way', 'DEMO-1007 payout has been released.', job7, 'payout');
  await notify(carrierId, 'New message', 'New message on DEMO-1006.', job6, 'message');

  console.log('[seed-investor-demo] Done.');
  console.log('[seed-investor-demo] Shipper login: ' + SHIPPER_EMAIL);
  console.log('[seed-investor-demo] Carrier login: ' + CARRIER_EMAIL);
  console.log('[seed-investor-demo] Shared password (shown once, not stored anywhere): ' + password);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[seed-investor-demo] FAILED:', e);
    process.exit(1);
  });
