// Idempotent demo seed — skips entirely if any user already exists.
// Roster and job mix match docs/README.md and docs/TUTORIAL.md exactly, so
// the tutorial walkthrough works verbatim against a freshly-seeded DB.

const bcrypt = require('bcryptjs');
const db = require('./db');
const { encryptField } = require('./lib/crypto');

function sqliteTime(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');
}
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

module.exports = function seed() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount > 0) return; // idempotent

  const PASSWORD_HASH = bcrypt.hashSync('demo1234', 10);

  function insertUser({ email, role, tier, referral_code, is_verified }) {
    // email_verified_at is set for every seeded account (demo data doesn't
    // need the F3 verification flow) so the "verify your email" banner
    // never shows for a freshly-logged-in demo user. account_approval_status
    // is 'APPROVED' for every demo account (the approval gate is a real
    // registration flow, not a demo concern) — a brand-new registration via
    // /api/auth/register starts PENDING and is read-only until an admin
    // approves it.
    const r = db
      .prepare(
        `INSERT INTO users (email, password_hash, role, is_verified, tier, referral_code, email_verified_at, account_approval_status, account_approved_at)
         VALUES (?,?,?,?,?,?,datetime('now'),'APPROVED',datetime('now'))`
      )
      .run(email, PASSWORD_HASH, role, is_verified ? 1 : 0, tier, referral_code);
    return Number(r.lastInsertRowid);
  }
  function insertProfile(userId, p) {
    db.prepare(
      `INSERT INTO profiles (user_id, company_name, trn_number, trade_license_number, phone, iban, coverage_zones,
         fleet_size, owned_chassis, insurance_uploaded, rating_avg, completed_jobs, verified_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      userId,
      p.company,
      encryptField(p.trn),
      p.license || null,
      p.phone || null,
      encryptField(p.iban),
      p.zones || null,
      p.fleet || 0,
      p.chassis || 0,
      p.insurance ? 1 : 0,
      p.rating ?? 5.0,
      p.completed ?? 0,
      p.verifiedAt || null
    );
  }

  // --- Users -----------------------------------------------------------
  const shipperId = insertUser({ email: 'shipper@jebelalilogistics.ae', role: 'SHIPPER', tier: 'SILVER', referral_code: 'SHP-ALMAJID', is_verified: true });
  insertProfile(shipperId, {
    company: 'Al-Majid Global Freight', trn: '100234567800003', license: 'CN-1122334',
    phone: '+971 4 221 5566', zones: 'Jebel Ali, JAFZA, Dubai South', rating: 4.7, completed: 58,
  });

  const emiratesId = insertUser({ email: 'carrier@dubaidrayage.com', role: 'CARRIER', tier: 'GOLD', referral_code: 'CAR-EMIRATES', is_verified: true });
  insertProfile(emiratesId, {
    company: 'Emirates Overland Haulage', trn: '100987654300001', license: 'CN-5566778',
    phone: '+971 4 887 3210', iban: 'AE070331234567890123456', zones: 'JAFZA, Al Quoz, DIP',
    fleet: 42, chassis: 30, insurance: true, rating: 4.85, completed: 320, verifiedAt: sqliteTime(-120 * DAY),
  });

  const falconId = insertUser({ email: 'falcon@containerxpress.ae', role: 'CARRIER', tier: 'SILVER', referral_code: 'CAR-FALCON', is_verified: true });
  insertProfile(falconId, {
    company: 'Falcon Container Express', trn: '100112233400002', license: 'CN-3344556',
    phone: '+971 4 556 8899', iban: 'AE290331234567890111222', zones: 'Jebel Ali, Dubai South',
    fleet: 18, chassis: 12, insurance: true, rating: 4.6, completed: 140, verifiedAt: sqliteTime(-90 * DAY),
  });

  const gulfheavyId = insertUser({ email: 'gulfheavy@fleet.ae', role: 'CARRIER', tier: 'GOLD', referral_code: 'CAR-GULFHEAVY', is_verified: true });
  insertProfile(gulfheavyId, {
    company: 'Gulf Heavy Transport', trn: '100445566700003', license: 'CN-7788990',
    phone: '+971 6 553 4477', iban: 'AE330331234567890333444', zones: 'Jebel Ali, DIP, Al Quoz, Musaffah',
    fleet: 55, chassis: 40, insurance: true, rating: 4.9, completed: 410, verifiedAt: sqliteTime(-150 * DAY),
  });

  const desertlineId = insertUser({ email: 'desertline@drayage.ae', role: 'CARRIER', tier: 'BRONZE', referral_code: 'CAR-DESERTLINE', is_verified: false });
  insertProfile(desertlineId, {
    company: 'Desert Line Drayage', trn: '100667788900004', license: 'CN-9911223',
    phone: '+971 6 221 7788', zones: 'Sharjah, Al Quoz', fleet: 6, chassis: 2, insurance: false, rating: 5.0, completed: 0,
  });

  // F1 (gstack review): a publicly-known admin@loadbyton.ae/demo1234 account
  // was seeded unconditionally, including in production — admin can decrypt
  // carrier IBAN/TRN, impersonate any user, release escrow, and resolve
  // disputes, so that credential must never exist on a real deployment by
  // default. Every other demo account stays seeded everywhere (including
  // production) — the live site is an intentional public demo for the
  // shipper/carrier experience (see the footer disclosure); only the admin
  // account is gated. Set SEED_DEMO_ADMIN=1 to opt back in (e.g. a private
  // staging environment that needs to exercise the admin console).
  const seedAdmin = process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_ADMIN === '1';
  if (seedAdmin) {
    const adminId = insertUser({ email: 'admin@loadbyton.ae', role: 'ADMIN', tier: 'GOLD', referral_code: 'ADM-LOADBYTON', is_verified: true });
    insertProfile(adminId, { company: 'Loadbyton Ops', phone: '+971 4 000 1000' });
  } else {
    console.log('Loadbyton: skipping demo ADMIN seed in production (set SEED_DEMO_ADMIN=1 to override).');
  }

  // --- Jobs --------------------------------------------------------------
  function insertJob(j) {
    const shipmentType = j.shipmentType || 'IMPORT';
    const importPickup = j.importPickup || j.pickup;
    const importUnloading = j.importUnloading || j.area;
    const importEmptyReturn = j.importEmptyReturn || null;
    const exportEmptyPickup = j.exportEmptyPickup || null;
    const exportLoading = j.exportLoading || null;
    const exportDeposit = j.exportDeposit || null;
    // Backfill legacy pickup/area for old display paths
    const legacyPickup = j.pickup || (shipmentType === 'IMPORT' ? importPickup : exportDeposit) || 'JEBEL_ALI_T1';
    const legacyArea = j.area || (shipmentType === 'IMPORT' ? importUnloading : exportLoading) || 'AL_QUOZ';
    const r = db
      .prepare(
        `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, container_number,
           pickup_terminal, delivery_area, delivery_address, ready_at, deadline, max_budget_aed, agreed_price_aed,
           status, awarded_bid_id, notes,
           escrow_status, delivered_at, auto_release_processed, payout_released_at, created_at, updated_at,
           equipment_type, container_count, truck_count, cargo_weight_tons,
           shipment_type, import_pickup_terminal, import_unloading_location, import_empty_return_location,
           export_empty_pickup_location, export_loading_location, export_deposit_terminal)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        j.code, shipperId, j.carrierId || null, j.size, j.type, j.number || null,
        legacyPickup, legacyArea, j.address, j.readyAt, j.deadline, j.budget || null, j.price || null,
        j.status, null, j.notes || null,
        j.escrow, j.deliveredAt || null, j.autoReleased ? 1 : 0, j.payoutReleasedAt || null,
        j.createdAt || sqliteTime(-10 * DAY), sqliteTime(-1 * DAY),
        j.equipment || 'CONTAINER_CHASSIS', j.containerCount ?? 1, j.truckCount ?? 1,
        j.weight ?? null,
        shipmentType, importPickup, importUnloading, importEmptyReturn,
        exportEmptyPickup, exportLoading, exportDeposit
      );
    return Number(r.lastInsertRowid);
  }
  // Bids no longer carry a driver (driver details are shared only after the
  // shipper confirms the bid — see server/index.js bids/award/driver routes);
  // awarded jobs below get their assigned_driver_* via the post-award PATCH
  // flow instead, mirroring production behavior.
  function insertBid(jobId, carrierId, amount, eta, status, truckType) {
    const r = db
      .prepare('INSERT INTO bids (job_id, carrier_id, amount_aed, eta_minutes, eta_at, truck_type, status) VALUES (?,?,?,?,?,?,?)')
      .run(jobId, carrierId, amount, eta, new Date(Date.now() + eta * 60000).toISOString(), truckType, status);
    return Number(r.lastInsertRowid);
  }

  // Job 1 — OPEN, IMPORT 40HC dry: JEBEL_ALI_T2 -> JAFZA South -> JAFZA Depot
  const job1 = insertJob({
    code: 'LBT-DXB-2608-4921', size: '40HC', type: 'DRY', number: 'MSKU9281745',
    pickup: 'JEBEL_ALI_T2', area: 'JAFZA_SOUTH', address: 'Street 14, Warehouse 8B, JAFZA South, Dubai',
    readyAt: sqliteTime(1 * DAY), deadline: sqliteTime(4 * DAY), budget: 600, status: 'OPEN', escrow: 'PENDING',
    notes: 'Gate pass required — see message thread for customs contact.', weight: 24,
    shipmentType: 'IMPORT', importPickup: 'JEBEL_ALI_T2', importUnloading: 'JAFZA_SOUTH', importEmptyReturn: 'JAFZA_DEPOT',
  });
  insertBid(job1, falconId, 500, 30, 'PENDING', '3-axle flatbed');
  insertBid(job1, gulfheavyId, 480, 28, 'PENDING', '3-axle flatbed');
  db.prepare("INSERT INTO job_documents (job_id, uploader_id, doc_type, title, file_url) VALUES (?,?,?,?,?)").run(job1, shipperId, 'CUSTOMS', 'Customs release form', 'https://files.loadbyton.demo/customs-4921.pdf');
  db.prepare("INSERT INTO job_documents (job_id, uploader_id, doc_type, title, file_url) VALUES (?,?,?,?,?)").run(job1, shipperId, 'RECEIPT', 'Terminal handling receipt', 'https://files.loadbyton.demo/receipt-4921.pdf');
  const gatePassThread = [
    [shipperId, 'Gate pass for MSKU9281745 is under the company name Al-Majid Global Freight — confirm your driver ID is registered at JAFZA gate 3.'],
    [falconId, 'Noted — our driver Rashid Al Falasi is registered at gate 3. ETA on pickup is 30 min once awarded.'],
    [gulfheavyId, 'We can also do gate 3, Imran Sheikh is our registered driver. Happy to move today if awarded.'],
    [shipperId, 'Thanks both — deciding shortly, container must clear free time by the weekend.'],
  ];
  for (const [sender, content] of gatePassThread) {
    db.prepare('INSERT INTO messages (job_id, sender_id, content) VALUES (?,?,?)').run(job1, sender, content);
  }

  // Job 2 — OPEN, EXPORT 40FT hazmat: Al Qusais Depot -> Dubai South -> JEBEL_ALI_T4
  const job2 = insertJob({
    code: 'LBT-DXB-2608-4933', size: '40FT', type: 'HAZMAT', number: 'TCLU5512309',
    pickup: 'JEBEL_ALI_T4', area: 'DUBAI_SOUTH', address: 'Plot 22, Dubai South Logistics District',
    readyAt: sqliteTime(1 * DAY), deadline: sqliteTime(3 * DAY), budget: 800, status: 'OPEN', escrow: 'PENDING', notes: 'Class 3 flammable liquid — placarding required. EXPORT: empty from Al Qusais Depot, load at Dubai South, deposit at JEBEL_ALI_T4.', weight: 22,
    shipmentType: 'EXPORT', exportEmptyPickup: 'AL_QUSAIS_DEPOT', exportLoading: 'DUBAI_SOUTH', exportDeposit: 'JEBEL_ALI_T4',
  });
  insertBid(job2, emiratesId, 750, 40, 'PENDING', 'Hazmat-certified flatbed');

  // Job 3 — PICKED_UP, awarded to Emirates.
  const job3 = insertJob({
    code: 'LBT-DXB-2608-3810', size: '40HC', type: 'DRY', number: 'MSCU1147765',
    pickup: 'JEBEL_ALI_T1', area: 'AL_QUOZ', address: 'Al Quoz Industrial 3, Warehouse 14',
    readyAt: sqliteTime(-1 * DAY), deadline: sqliteTime(2 * DAY), price: 900, carrierId: emiratesId,
    status: 'PICKED_UP', escrow: 'HELD',
  });
  const job3Bid = insertBid(job3, emiratesId, 900, 50, 'ACCEPTED', '3-axle flatbed');
  db.prepare('UPDATE jobs SET awarded_bid_id=? WHERE id=?').run(job3Bid, job3);
  db.prepare("UPDATE jobs SET assigned_driver_name=?, assigned_driver_phone='+971501234567' WHERE id=?").run('Hamdan Youssef', job3);
  db.prepare('INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, release_type) VALUES (?,?,?,?,?,\'PENDING\',\'MANUAL\')').run(job3, emiratesId, 900, 54, 846);

  // Job 4 — IN_TRANSIT, EXPORT reefer, awarded to Gulf Heavy.
  const job4 = insertJob({
    code: 'LBT-DXB-2608-2277', size: 'REEFER', type: 'REEFER', number: 'CMAU8827761',
    pickup: 'JEBEL_ALI_T2', area: 'AL_QUOZ', address: 'Al Quoz Cold Chain Hub, Bay 6',
    readyAt: sqliteTime(-2 * DAY), deadline: sqliteTime(1 * DAY), price: 1600, carrierId: gulfheavyId,
    status: 'IN_TRANSIT', escrow: 'FUNDED', 
    equipment: 'TRAILER_WITH_GENSET', containerCount: 1, truckCount: 1,
    notes: 'Maintain -18C chain of custody throughout. EXPORT: empty from Khalifa Depot, loaded at Al Quoz, deposited at JEBEL_ALI_T2.', weight: 26,
    shipmentType: 'EXPORT', exportEmptyPickup: 'KHALIFA_DEPOT', exportLoading: 'AL_QUOZ', exportDeposit: 'JEBEL_ALI_T2',
  });
  const job4Bid = insertBid(job4, gulfheavyId, 1600, 65, 'ACCEPTED', 'Reefer trailer');
  db.prepare('UPDATE jobs SET awarded_bid_id=? WHERE id=?').run(job4Bid, job4);
  db.prepare("UPDATE jobs SET assigned_driver_name=?, assigned_driver_phone='+971501234567' WHERE id=?").run('Imran Sheikh', job4);
  db.prepare('INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, release_type) VALUES (?,?,?,?,?,\'PENDING\',\'MANUAL\')').run(job4, gulfheavyId, 1600, 96, 1504);

  // Job 5 — DELIVERED, awarded to Falcon; already past the 24h auto-release
  // window at seed time, so its payout is pre-released (AUTO_24H) while the
  // job itself stays DELIVERED until the shipper explicitly completes it —
  // auto-release only ever touches escrow/payout, never job status.
  const job5 = insertJob({
    code: 'LBT-DXB-2607-9042', size: '40HC', type: 'DRY', number: 'OOLU4471982',
    pickup: 'JEBEL_ALI_T2', area: 'JAFZA_SOUTH', address: 'JAFZA South, Warehouse 2C',
    readyAt: sqliteTime(-4 * DAY), deadline: sqliteTime(-1 * DAY), price: 520, carrierId: falconId,
    status: 'DELIVERED', escrow: 'RELEASED', deliveredAt: sqliteTime(-30 * HOUR), autoReleased: true,
    payoutReleasedAt: sqliteTime(-6 * HOUR),
  });
  const job5Bid = insertBid(job5, falconId, 520, 28, 'ACCEPTED', '3-axle flatbed');
  db.prepare('UPDATE jobs SET awarded_bid_id=? WHERE id=?').run(job5Bid, job5);
  db.prepare("UPDATE jobs SET assigned_driver_name=?, assigned_driver_phone='+971501234567' WHERE id=?").run('Rashid Al Falasi', job5);
  db.prepare("INSERT INTO job_documents (job_id, uploader_id, doc_type, title, file_url) VALUES (?,?,?,?,?)").run(job5, falconId, 'POD', 'Proof of delivery — signed', 'https://files.loadbyton.demo/pod-9042.pdf');
  db.prepare(
    "INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, release_type, released_at) VALUES (?,?,?,?,?,'RELEASED','AUTO_24H',?)"
  ).run(job5, falconId, 520, 31, 489, sqliteTime(-6 * HOUR));

  // Job 6 — COMPLETED, awarded to Emirates, fully closed out with ratings.
  const job6 = insertJob({
    code: 'LBT-DXB-2607-7715', size: '40FT', type: 'DRY', number: 'HLXU2209915',
    pickup: 'JEBEL_ALI_T4', area: 'DUBAI_SOUTH', address: 'Dubai South Logistics District, Bay 9',
    readyAt: sqliteTime(-8 * DAY), deadline: sqliteTime(-5 * DAY), price: 1200, carrierId: emiratesId,
    status: 'COMPLETED', escrow: 'RELEASED', deliveredAt: sqliteTime(-6 * DAY), autoReleased: false,
    payoutReleasedAt: sqliteTime(-6 * DAY),
  });
  const job6Bid = insertBid(job6, emiratesId, 1200, 60, 'ACCEPTED', '3-axle flatbed');
  db.prepare('UPDATE jobs SET awarded_bid_id=? WHERE id=?').run(job6Bid, job6);
  db.prepare("UPDATE jobs SET assigned_driver_name=?, assigned_driver_phone='+971501234567' WHERE id=?").run('Hamdan Youssef', job6);
  db.prepare(
    "INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, release_type, released_at) VALUES (?,?,?,?,?,'RELEASED','MANUAL',?)"
  ).run(job6, emiratesId, 1200, 72, 1128, sqliteTime(-6 * DAY));
  db.prepare('INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment) VALUES (?,?,?,?,?)').run(job6, shipperId, emiratesId, 5, 'Smooth pickup, on time, driver was easy to reach.');
  db.prepare('INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment) VALUES (?,?,?,?,?)').run(job6, emiratesId, shipperId, 5, 'Clear instructions, easy customs handoff.');

  // Job 7 — OPEN, general freight (non-container), Sharjah — Tripper hauling
  // aggregate for a construction site, 4 trucks needed in one volume inquiry.
  // Demonstrates equipment breadth + volume-by-trucks outside Dubai.
  const job7 = insertJob({
    code: 'LBT-SHJ-2608-1104', size: 'N/A', type: 'GENERAL',
    pickup: 'PORT_KHALID', area: 'SHARJAH_INDUSTRIAL', address: 'Sharjah Industrial Area 12, Site Gate 4',
    readyAt: sqliteTime(1 * DAY), deadline: sqliteTime(2 * DAY), budget: 3200, status: 'OPEN', escrow: 'PENDING',
    notes: 'Aggregate haul from Port Khalid stockyard to site — 4 tripper loads across the day, same address.',
    equipment: 'TRIPPER', truckCount: 4, weight: 44,
  });
  insertBid(job7, gulfheavyId, 3000, 35, 'PENDING', 'TRIPPER');
  insertBid(job7, desertlineId, 2850, 45, 'PENDING', 'TRIPPER');

  // Job 8 — OPEN, container drayage bulk inquiry, Fujairah — 6 containers,
  // one carrier to cover the full volume. Demonstrates volume-by-containers
  // on the UAE east coast, not just Dubai/Abu Dhabi.
  const job8 = insertJob({
    code: 'LBT-FJR-2608-2231', size: '40FT', type: 'DRY', number: 'BULK-FJR-0823',
    pickup: 'FUJAIRAH_PORT', area: 'FUJAIRAH_FREEZONE', address: 'Fujairah Free Zone, Warehouse Cluster C',
    readyAt: sqliteTime(2 * DAY), deadline: sqliteTime(6 * DAY), budget: 4200, status: 'OPEN', escrow: 'PENDING',
    notes: 'Weekly restock — 6× 40FT dry containers, same lane, one award covers the full batch.',
    equipment: 'CONTAINER_CHASSIS', containerCount: 6, weight: 96,
  });
  insertBid(job8, emiratesId, 3900, 55, 'PENDING', 'CONTAINER_CHASSIS');

  // --- Templates & contract lanes -----------------------------------------
  db.prepare(
    `INSERT INTO templates (shipper_id, name, pickup_terminal, delivery_area, delivery_address, container_size, container_type, cadence, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(shipperId, 'Weekly JAFZA South run', 'JEBEL_ALI_T2', 'JAFZA_SOUTH', 'Street 14, Warehouse 8B, JAFZA South, Dubai', '40HC', 'DRY', 'WEEKLY', 'Standing weekly lane — same warehouse as job 4921.');
  db.prepare(
    `INSERT INTO templates (shipper_id, name, pickup_terminal, delivery_area, delivery_address, container_size, container_type, cadence, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(shipperId, 'Monthly reefer to Al Quoz', 'JEBEL_ALI_T2', 'AL_QUOZ', 'Al Quoz Cold Chain Hub, Bay 6', 'REEFER', 'REEFER', 'MONTHLY', 'Maintain -18C chain of custody.');

  db.prepare('INSERT INTO contract_lanes (shipper_id, pickup_terminal, delivery_area, delivery_address, monthly_loads, target_price_aed, status) VALUES (?,?,?,?,?,?,?)').run(
    shipperId, 'JEBEL_ALI_T2', 'JAFZA_SOUTH', 'JAFZA South, various warehouses', 40, 460, 'ACTIVE'
  );
  db.prepare('INSERT INTO contract_lanes (shipper_id, pickup_terminal, delivery_area, delivery_address, monthly_loads, target_price_aed, status) VALUES (?,?,?,?,?,?,?)').run(
    shipperId, 'JEBEL_ALI_T1', 'AL_QUOZ', 'Al Quoz Industrial, various warehouses', 20, 900, 'ACTIVE'
  );

  // --- Notifications (a little history so the bell isn't empty) ----------
  db.prepare('INSERT INTO notifications (user_id, title, body, job_id) VALUES (?,?,?,?)').run(shipperId, 'New bid received', 'Falcon Container Express bid AED 500 on LBT-DXB-2608-4921.', job1);
  db.prepare('INSERT INTO notifications (user_id, title, body, job_id) VALUES (?,?,?,?)').run(emiratesId, 'Funds on the way', 'Your payout for LBT-DXB-2607-7715 was released.', job6);
  db.prepare('INSERT INTO notifications (user_id, title, body, job_id) VALUES (?,?,?,?)').run(falconId, 'Payout auto-released', 'LBT-DXB-2607-9042 funds were released 24h after delivery.', job5);

  // --- Audit trail for the historical actions above -----------------------
  const auditRow = db.prepare(
    'INSERT INTO audit_log (user_id, action, details, entity_type, entity_id, before_state, after_state) VALUES (?,?,?,?,?,?,?)'
  );
  auditRow.run(null, 'VERIFY', 'Approved carrier Emirates Overland Haulage', 'user', emiratesId, null, 'VERIFIED');
  auditRow.run(null, 'VERIFY', 'Approved carrier Falcon Container Express', 'user', falconId, null, 'VERIFIED');
  auditRow.run(null, 'VERIFY', 'Approved carrier Gulf Heavy Transport', 'user', gulfheavyId, null, 'VERIFIED');
  auditRow.run(shipperId, 'AWARD', 'LBT-DXB-2608-3810 awarded to Emirates Overland Haulage at AED 900', 'job', job3, 'OPEN', 'AWARDED');
  auditRow.run(shipperId, 'AWARD', 'LBT-DXB-2608-2277 awarded to Gulf Heavy Transport at AED 1600', 'job', job4, 'OPEN', 'AWARDED');
  auditRow.run(shipperId, 'AWARD', 'LBT-DXB-2607-9042 awarded to Falcon Container Express at AED 520', 'job', job5, 'OPEN', 'AWARDED');
  auditRow.run(shipperId, 'AWARD', 'LBT-DXB-2607-7715 awarded to Emirates Overland Haulage at AED 1200', 'job', job6, 'OPEN', 'AWARDED');
  auditRow.run(null, 'ESCROW_RELEASE', 'Auto-released LBT-DXB-2607-9042 after 24h (silent assent).', 'job', job5, 'HELD', 'RELEASED');
  auditRow.run(shipperId, 'STATUS', 'LBT-DXB-2607-7715: DELIVERED -> COMPLETED', 'job', job6, 'DELIVERED', 'COMPLETED');

  console.log(`Loadbyton: seeded demo data (${seedAdmin ? 6 : 5} users, 6 jobs, 7 bids, templates, contract lanes).`);
};

// ---------------------------------------------------------------------------
// Demo-login top-up for pre-existing databases.
//
// seed() above is all-or-nothing: it skips entirely if ANY user row exists.
// A deployment whose disk DB predates the current roster (older demo emails,
// a manually-created admin, real signups) therefore 401s every documented
// demo login with "Invalid email or password" — exactly what happened on
// the Render production disk. ensureDemoLogins() inserts ONLY the canonical
// demo accounts that are missing (user + profile rows, APPROVED + email
// verified), touching nothing else: no jobs, no bids, no existing users.
//
// Gated behind SEED_DEMO_ACCOUNTS=1 so a real customer deployment never
// grows publicly-known demo credentials by accident. The ADMIN account
// follows the same SEED_DEMO_ADMIN rule as the full seed.
// ---------------------------------------------------------------------------
const DEMO_LOGIN_ROSTER = [
  {
    email: 'shipper@jebelalilogistics.ae', role: 'SHIPPER', tier: 'SILVER', referral_code: 'SHP-ALMAJID',
    profile: { company: 'Al-Majid Global Freight', trn: '100234567800003', license: 'CN-1122334', phone: '+971 4 221 5566', zones: 'Jebel Ali, JAFZA, Dubai South', rating: 4.7, completed: 58 },
  },
  {
    email: 'carrier@dubaidrayage.com', role: 'CARRIER', tier: 'GOLD', referral_code: 'CAR-EMIRATES',
    profile: { company: 'Emirates Overland Haulage', trn: '100987654300001', license: 'CN-5566778', phone: '+971 4 887 3210', iban: 'AE070331234567890123456', zones: 'JAFZA, Al Quoz, DIP', fleet: 42, chassis: 30, insurance: true, rating: 4.85, completed: 320, verifiedAt: sqliteTime(-120 * DAY) },
  },
  {
    email: 'falcon@containerxpress.ae', role: 'CARRIER', tier: 'SILVER', referral_code: 'CAR-FALCON',
    profile: { company: 'Falcon Container Express', trn: '100112233400002', license: 'CN-3344556', phone: '+971 4 556 8899', iban: 'AE290331234567890111222', zones: 'Jebel Ali, Dubai South', fleet: 18, chassis: 12, insurance: true, rating: 4.6, completed: 140, verifiedAt: sqliteTime(-90 * DAY) },
  },
  {
    email: 'gulfheavy@fleet.ae', role: 'CARRIER', tier: 'GOLD', referral_code: 'CAR-GULFHEAVY',
    profile: { company: 'Gulf Heavy Transport', trn: '100445566700003', license: 'CN-7788990', phone: '+971 6 553 4477', iban: 'AE330331234567890333444', zones: 'Jebel Ali, DIP, Al Quoz, Musaffah', fleet: 55, chassis: 40, insurance: true, rating: 4.9, completed: 410, verifiedAt: sqliteTime(-150 * DAY) },
  },
  {
    email: 'desertline@drayage.ae', role: 'CARRIER', tier: 'BRONZE', referral_code: 'CAR-DESERTLINE', is_verified: false,
    profile: { company: 'Desert Line Drayage', trn: '100667788900004', license: 'CN-9911223', phone: '+971 6 221 7788', zones: 'Sharjah, Al Quoz', fleet: 6, chassis: 2, insurance: false, rating: 5.0, completed: 0 },
  },
];

function ensureDemoLogins() {
  const insertUserStmt = db.prepare(
    `INSERT INTO users (email, password_hash, role, is_verified, tier, referral_code, email_verified_at, account_approval_status, account_approved_at)
     VALUES (?,?,?,?,?,?,datetime('now'),'APPROVED',datetime('now'))`
  );
  const insertProfileStmt = db.prepare(
    `INSERT INTO profiles (user_id, company_name, trn_number, trade_license_number, phone, iban, coverage_zones,
       fleet_size, owned_chassis, insurance_uploaded, rating_avg, completed_jobs, verified_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const passwordHash = bcrypt.hashSync('demo1234', 10);
  let created = [];

  for (const acct of DEMO_LOGIN_ROSTER) {
    if (db.prepare('SELECT id FROM users WHERE email=?').get(acct.email)) continue;
    const p = acct.profile;
    const r = insertUserStmt.run(acct.email, passwordHash, acct.role, acct.is_verified === false ? 0 : 1, acct.tier, acct.referral_code);
    insertProfileStmt.run(
      Number(r.lastInsertRowid), p.company, encryptField(p.trn), p.license || null, p.phone || null,
      p.iban ? encryptField(p.iban) : null, p.zones || null, p.fleet || 0, p.chassis || 0,
      p.insurance ? 1 : 0, p.rating ?? 5.0, p.completed ?? 0, p.verifiedAt || null
    );
    created.push(acct.email);
  }

  // Same admin gating as the full seed: never a publicly-known admin on a
  // real deployment unless explicitly opted in.
  if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_ADMIN === '1') {
    if (!db.prepare("SELECT id FROM users WHERE email='admin@loadbyton.ae'").get()) {
      const r = insertUserStmt.run('admin@loadbyton.ae', passwordHash, 'ADMIN', 1, 'GOLD', 'ADM-LOADBYTON');
      insertProfileStmt.run(Number(r.lastInsertRowid), 'Loadbyton Ops', null, null, '+971 4 000 1000', null, null, 0, 0, 0, 5.0, 0, null);
      created.push('admin@loadbyton.ae');
    }
  }

  if (created.length) console.log(`Loadbyton: ensured demo logins exist (${created.join(', ')}).`);
}

module.exports.ensureDemoLogins = ensureDemoLogins;
