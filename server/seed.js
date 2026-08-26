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

  const adminId = insertUser({ email: 'admin@loadbyton.ae', role: 'ADMIN', tier: 'GOLD', referral_code: 'ADM-LOADBYTON', is_verified: true });
  insertProfile(adminId, {
    company: 'Loadbyton Platform', trn: '100000000000001', license: 'LB-ADMIN001',
    phone: '+971 4 000 0001', zones: 'All UAE', fleet: 0, chassis: 0, insurance: false, rating: 5.0, completed: 0,
  });

  // --- Jobs (mix of statuses for demo purposes) ------------------------
  const insertJob = db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, max_budget_aed, agreed_price_aed, status, escrow_status, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insertBid = db.prepare(
    `INSERT INTO bids (job_id, carrier_id, amount_aed, eta_minutes, truck_type, notes, status)
     VALUES (?,?,?,?,?,?,?)`
  );

  const now = Date.now();
  const in2h = new Date(now + 2 * HOUR).toISOString();
  const in6h = new Date(now + 6 * HOUR).toISOString();
  const in12h = new Date(now + 12 * HOUR).toISOString();
  const in24h = new Date(now + 24 * HOUR).toISOString();
  const in48h = new Date(now + 48 * HOUR).toISOString();
  const yesterday = new Date(now - 24 * HOUR).toISOString();
  const twoDaysAgo = new Date(now - 48 * HOUR).toISOString();
  const threeDaysAgo = new Date(now - 72 * HOUR).toISOString();

  // Job 1 — OPEN, 2 bids
  const j1 = insertJob.run('LB-1001', shipperId, null, '40ft', 'DRY', 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 3', in2h, in24h, 2500, null, 'OPEN', 'PENDING', 'Urgent — container ready at gate');
  const j1id = Number(j1.lastInsertRowid);
  insertBid.run(j1id, emiratesId, 1800, 120, '10-wheeler', 'Can pick up in 2 hours', 'PENDING');
  insertBid.run(j1id, falconId, 2100, 90, 'lowboy', 'Faster route via E311', 'PENDING');

  // Job 2 — OPEN, 1 bid
  const j2 = insertJob.run('LB-1002', shipperId, null, '20ft', 'REEFER', 'Khalifa Port', 'Dubai South', 'Dubai South Logistics District', in6h, in48h, 3200, null, 'OPEN', 'PENDING', 'Temperature-sensitive — maintain -18C');
  const j2id = Number(j2.lastInsertRowid);
  insertBid.run(j2id, gulfheavyId, 2800, 180, 'reefer-truck', 'Reefer unit pre-cooled', 'PENDING');

  // Job 3 — AWARDED, in progress
  const j3 = insertJob.run('LB-1003', shipperId, emiratesId, '40ft', 'OPEN_TOP', 'Jebel Ali', 'Musaffah', 'Musaffah Industrial Zone', twoDaysAgo, in24h, null, 2200, 'AWARDED', 'ESCROWED', 'Heavy cargo — 28 tons');
  const j3id = Number(j3.lastInsertRowid);
  insertBid.run(j3id, emiratesId, 2200, 240, 'lowboy', 'Open-top available', 'ACCEPTED');

  // Job 4 — DELIVERED, pending release
  const j4 = insertJob.run('LB-1004', shipperId, falconId, '20ft', 'DRY', 'Khalifa Port', 'Jebel Ali', 'Jebel Ali Free Zone Warehouse 7', threeDaysAgo, yesterday, null, 1500, 'DELIVERED', 'ESCROWED', null);
  const j4id = Number(j4.lastInsertRowid);
  insertBid.run(j4id, falconId, 1500, 60, 'box-truck', 'Direct — no stops', 'ACCEPTED');

  // Job 5 — COMPLETED
  const j5 = insertJob.run('LB-1005', shipperId, gulfheavyId, '40ft', 'DRY', 'Jebel Ali', 'Sharjah', 'Sharjah Industrial Area 5', threeDaysAgo, twoDaysAgo, null, 1900, 'COMPLETED', 'RELEASED', null);
  const j5id = Number(j5.lastInsertRowid);
  insertBid.run(j5id, gulfheavyId, 1900, 150, '10-wheeler', 'Standard drayage', 'ACCEPTED');

  // Job 6 — CANCELLED
  insertJob.run('LB-1006', shipperId, null, '20ft', 'DRY', 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 1', threeDaysAgo, twoDaysAgo, 2000, null, 'CANCELLED', 'PENDING', 'Shipper cancelled — route no longer needed');

  console.log(`[seed] created 6 demo jobs with bids`);
};

// ---------------------------------------------------------------------------
// ensureDemoLogins() — lightweight "make sure demo accounts exist" that
// runs on every boot (not just fresh DBs). This fixes the common case where
// the Render persistent disk has users but the demo accounts were never
// created (or the password hash was lost during a migration). Only touches
// the three canonical demo emails; never overwrites existing rows.
// ---------------------------------------------------------------------------
const bcryptLogin = require('bcryptjs');
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
    `INSERT OR IGNORE INTO users (email, password_hash, role, is_verified, tier, referral_code, email_verified_at, account_approval_status, account_approved_at)
     VALUES (?,?,?,?,?,?,datetime('now'),'APPROVED',datetime('now'))`
  );
  const insertProfileStmt = db.prepare(
    `INSERT OR IGNORE INTO profiles (user_id, company_name, trn_number, trade_license_number, phone, iban, coverage_zones,
       fleet_size, owned_chassis, insurance_uploaded, rating_avg, completed_jobs, verified_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const passwordHash = bcryptLogin.hashSync('demo1234', 10);
  let created = [];

  for (const acct of DEMO_LOGIN_ROSTER) {
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(acct.email);
    if (existing) continue;
    const p = acct.profile;
    const r = insertUserStmt.run(acct.email, passwordHash, acct.role, acct.is_verified === false ? 0 : 1, acct.tier, acct.referral_code);
    const userId = Number(r.lastInsertRowid);
    if (userId) {
      insertProfileStmt.run(
        userId, p.company, encryptField(p.trn), p.license || null, p.phone || null,
        p.iban ? encryptField(p.iban) : null, p.zones || null, p.fleet || 0, p.chassis || 0,
        p.insurance ? 1 : 0, p.rating ?? 5.0, p.completed ?? 0, p.verifiedAt || null
      );
      created.push(acct.email);
    }
  }

  if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_ADMIN === '1') {
    const adminExists = db.prepare('SELECT id FROM users WHERE email=?').get('admin@loadbyton.ae');
    if (!adminExists) {
      const r = insertUserStmt.run('admin@loadbyton.ae', passwordHash, 'ADMIN', 1, 'GOLD', 'ADM-LOADBYTON');
      const adminId = Number(r.lastInsertRowid);
      if (adminId) {
        insertProfileStmt.run(adminId, 'Loadbyton Platform', encryptField('100000000000001'), 'LB-ADMIN001', '+971 4 000 0001', null, 'All UAE', 0, 0, 0, 5.0, 0, null);
        created.push('admin@loadbyton.ae');
      }
    }
  }

  if (created.length) console.log(`[seed] created demo accounts: ${created.join(', ')}`);
}

module.exports.ensureDemoLogins = ensureDemoLogins;
