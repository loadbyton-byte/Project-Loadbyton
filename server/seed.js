// Idempotent demo seed — skips entirely if any user already exists.
// Roster and job mix match docs/README.md and docs/TUTORIAL.md exactly, so
// the tutorial walkthrough works verbatim against a freshly-seeded DB.

const bcrypt = require('bcryptjs');
const db = require('./db');
const { encryptField } = require('./lib/crypto');
const { TERMS_VERSION } = require('./lib/constants');

function sqliteTime(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');
}
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

module.exports = async function seed() {
  // db.prepare(sql).get/all/run() is synchronous on SQLite but returns a
  // Promise on Postgres (see server/db.js's top-of-file contract comment)
  // — every call in this file must be awaited or, on Postgres, results are
  // Promise objects (always truthy, no real properties) rather than rows,
  // which previously crashed boot outright (NaN passed to an integer
  // column when an un-awaited "insert" result's .lastInsertRowid was read
  // off a Promise instead of the real row).
  const userCount = (await db.prepare('SELECT COUNT(*) c FROM users').get()).c;
  if (userCount > 0) return; // idempotent

  const PASSWORD_HASH = bcrypt.hashSync('demo1234', 10);

  // approvalStatus defaults to the pre-existing 'APPROVED'/already-decided
  // behavior every original demo account relies on — only the one new
  // "pending review" shipper below passes 'PENDING', to demonstrate today's
  // requireApproved() gate without changing anything about the other 10
  // accounts this file creates.
  async function insertUser({ email, role, tier, referral_code, is_verified, approvalStatus = 'APPROVED' }) {
    // RETURNING id: without it, Postgres's run() shim has no way to report
    // lastInsertRowid (that's SQLite-native driver behavior, not
    // dialect-portable) and silently returns null -> Number(null) === 0,
    // which then fails every dependent INSERT's FK constraint instead of
    // the NaN this used to produce before the await fix. RETURNING is a
    // no-op addition on SQLite (still uses its own native tracking) so this
    // is safe on both.
    const approvedAt = approvalStatus === 'APPROVED' ? `datetime('now')` : 'NULL';
    const r = await db
      .prepare(
        `INSERT INTO users (email, password_hash, role, is_verified, tier, referral_code, email_verified_at, account_approval_status, account_approved_at)
         VALUES (?,?,?,?,?,?,datetime('now'),?,${approvedAt})
         RETURNING id`
      )
      .run(email, PASSWORD_HASH, role, is_verified ? 1 : 0, tier, referral_code, approvalStatus);
    const userId = Number(r.lastInsertRowid);
    // Seed/demo accounts simulate an already-established real user, not a
    // fresh signup — record a standing Terms acceptance so demo walkthroughs
    // and tests aren't blocked by the same T&C-required gate a brand-new
    // real signup goes through (server/routes/auth.routes.js).
    await db.prepare(
      `INSERT INTO terms_acceptances (user_id, terms_version, context) VALUES (?,?,'SIGNUP')`
    ).run(userId, TERMS_VERSION);
    return userId;
  }
  // Mirrors server/routes/org.routes.js's POST /api/org/members exactly (an
  // org-owner-scoped login seat: same `role` as the owner, org_owner_id set,
  // a real seat_role). Used for OPS/FINANCE/VIEWER seats below — never
  // 'DRIVER'/'DRIVER_ASSOCIATE', which go through insertDriverSeat instead
  // since those are tied to a drivers roster row, not a free-standing seat.
  async function insertSeat(ownerId, ownerRole, { email, seatRole, displayName }) {
    const r = await db
      .prepare(`INSERT INTO users (email, password_hash, role, tier, org_owner_id, seat_role, display_name, is_verified) VALUES (?,?,?,?,?,?,?,1) RETURNING id`)
      .run(email, PASSWORD_HASH, ownerRole, 'BRONZE', ownerId, seatRole, displayName);
    return Number(r.lastInsertRowid);
  }
  // Mirrors server/routes/fleet.routes.js's roster-registration + POST
  // /:id/seat pair. Real UAE mobile format (required by the same
  // UAE_LICENCE_RE-adjacent phone check that route enforces on writes,
  // even though this seed bypasses the HTTP layer entirely) and the exact
  // synthetic-email convention (`<digits>@drivers.loadbyton.internal`) so a
  // seeded driver seat is indistinguishable from one created through the
  // real UI.
  async function insertDriver(carrierId, { name, phone, license, licenseExpiry }) {
    const r = await db
      .prepare(`INSERT INTO drivers (carrier_id, name, phone, license_number, license_expiry) VALUES (?,?,?,?,?) RETURNING id`)
      .run(carrierId, name, phone, license || null, licenseExpiry || null);
    return Number(r.lastInsertRowid);
  }
  async function insertDriverSeat(driverId, ownerId, ownerRole, seatRole, displayName, phone) {
    const email = `${phone.replace(/[^0-9]/g, '')}@drivers.loadbyton.internal`;
    const r = await db
      .prepare(`INSERT INTO users (email, password_hash, role, tier, org_owner_id, seat_role, display_name, is_verified) VALUES (?,?,?,?,?,?,?,1) RETURNING id`)
      .run(email, PASSWORD_HASH, ownerRole, 'BRONZE', ownerId, seatRole, displayName);
    const seatUserId = Number(r.lastInsertRowid);
    await db.prepare(`UPDATE drivers SET seat_user_id=? WHERE id=?`).run(seatUserId, driverId);
    return { seatUserId, email };
  }
  async function insertProfile(userId, p) {
    await db.prepare(
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
    // available_units defaults NULL at the column level (server/schema.js)
    // — its one-time backfill runs during schema init, before any of these
    // seed rows exist, so every seeded profile needs this explicitly.
    await db.prepare(`UPDATE profiles SET available_units = fleet_size WHERE user_id=? AND available_units IS NULL`).run(userId);
  }

  // --- Users -----------------------------------------------------------
  const shipperId = await insertUser({ email: 'shipper@jebelalilogistics.ae', role: 'SHIPPER', tier: 'SILVER', referral_code: 'SHP-ALMAJID', is_verified: true });
  await insertProfile(shipperId, {
    company: 'Al-Majid Global Freight', trn: '100234567800003', license: 'CN-1122334',
    phone: '+971 4 221 5566', zones: 'Jebel Ali, JAFZA, Dubai South', rating: 4.7, completed: 58,
  });

  const emiratesId = await insertUser({ email: 'carrier@dubaidrayage.com', role: 'CARRIER', tier: 'GOLD', referral_code: 'CAR-EMIRATES', is_verified: true });
  await insertProfile(emiratesId, {
    company: 'Emirates Overland Haulage', trn: '100987654300001', license: 'CN-5566778',
    phone: '+971 4 887 3210', iban: 'AE070331234567890123456', zones: 'JAFZA, Al Quoz, DIP',
    fleet: 42, chassis: 30, insurance: true, rating: 4.85, completed: 320, verifiedAt: sqliteTime(-120 * DAY),
  });

  const falconId = await insertUser({ email: 'falcon@containerxpress.ae', role: 'CARRIER', tier: 'SILVER', referral_code: 'CAR-FALCON', is_verified: true });
  await insertProfile(falconId, {
    company: 'Falcon Container Express', trn: '100112233400002', license: 'CN-3344556',
    phone: '+971 4 556 8899', iban: 'AE290331234567890111222', zones: 'Jebel Ali, Dubai South',
    fleet: 18, chassis: 12, insurance: true, rating: 4.6, completed: 140, verifiedAt: sqliteTime(-90 * DAY),
  });

  const gulfheavyId = await insertUser({ email: 'gulfheavy@fleet.ae', role: 'CARRIER', tier: 'GOLD', referral_code: 'CAR-GULFHEAVY', is_verified: true });
  await insertProfile(gulfheavyId, {
    company: 'Gulf Heavy Transport', trn: '100445566700003', license: 'CN-7788990',
    phone: '+971 6 553 4477', iban: 'AE330331234567890333444', zones: 'Jebel Ali, DIP, Al Quoz, Musaffah',
    fleet: 55, chassis: 40, insurance: true, rating: 4.9, completed: 410, verifiedAt: sqliteTime(-150 * DAY),
  });

  const desertlineId = await insertUser({ email: 'desertline@drayage.ae', role: 'CARRIER', tier: 'BRONZE', referral_code: 'CAR-DESERTLINE', is_verified: false });
  await insertProfile(desertlineId, {
    company: 'Desert Line Drayage', trn: '100667788900004', license: 'CN-9911223',
    phone: '+971 6 221 7788', zones: 'Sharjah, Al Quoz', fleet: 6, chassis: 2, insurance: false, rating: 5.0, completed: 0,
  });

  const adminId = await insertUser({ email: 'admin@loadbyton.ae', role: 'ADMIN', tier: 'GOLD', referral_code: 'ADM-LOADBYTON', is_verified: true });
  await insertProfile(adminId, {
    company: 'Loadbyton Platform', trn: '100000000000001', license: 'LB-ADMIN001',
    phone: '+971 4 000 0001', zones: 'All UAE', fleet: 0, chassis: 0, insurance: false, rating: 5.0, completed: 0,
  });

  // --- Full account-type roster (investor demo) -------------------------
  // Everything above this line predates today's Change 27 (FORWARDER/
  // BROKER/OWNER_OPERATOR roles), multi-seat orgs, and driver logins — the
  // demo previously only showed SHIPPER/CARRIER/ADMIN. This section adds
  // one real, working account per remaining role plus multi-user org
  // structure, so an investor walkthrough (or anyone testing role-specific
  // UI) can log into every account type this platform actually supports.

  // FORWARDER — posts on behalf of client shippers (roleSatisfies() lets it
  // through every SHIPPER-role guard; server/routes/broker.routes.js's
  // client roster is what's actually new for this role).
  const forwarderId = await insertUser({ email: 'forwarder@gulfconnect.ae', role: 'FORWARDER', tier: 'GOLD', referral_code: 'FWD-GULFCONNECT', is_verified: true });
  await insertProfile(forwarderId, {
    company: 'Gulf Connect Logistics Forwarding', trn: '100778899000005', license: 'CN-4455667',
    phone: '+971 4 330 1122', zones: 'Dubai, Abu Dhabi, Sharjah', rating: 4.8, completed: 26,
  });
  await db.prepare(`INSERT INTO forwarder_clients (forwarder_id, client_name, contact_phone, contact_email) VALUES (?,?,?,?)`)
    .run(forwarderId, 'Al Rostamani Trading LLC', '+971 4 220 9911', 'logistics@alrostamani-trading.ae');

  // BROKER — direct-assigns to a roster of real carriers under the
  // disclosed one-hop rule (roleSatisfies() passes both SHIPPER- and
  // CARRIER-role guards; server/routes/broker.routes.js's carrier roster +
  // direct-assign are what's new).
  const brokerId = await insertUser({ email: 'broker@levantlogix.ae', role: 'BROKER', tier: 'GOLD', referral_code: 'BRK-LEVANTLOGIX', is_verified: true });
  await insertProfile(brokerId, {
    company: 'Levant Logix Brokerage', trn: '100889900100006', license: 'CN-5566778X',
    phone: '+971 4 448 2200', zones: 'Dubai, Abu Dhabi', rating: 4.65, completed: 41,
  });
  await db.prepare(`INSERT INTO broker_carriers (broker_id, carrier_id) VALUES (?,?)`).run(brokerId, emiratesId);

  // OWNER_OPERATOR — a single-truck carrier-equivalent (roleSatisfies()
  // treats it as CARRIER everywhere: bids, gets awarded, executes jobs —
  // same profile shape as a fleet carrier, just a fleet of one).
  const ownerOpId = await insertUser({ email: 'owner@singletruck.ae', role: 'OWNER_OPERATOR', tier: 'SILVER', referral_code: 'OWN-SINGLETRUCK', is_verified: true });
  await insertProfile(ownerOpId, {
    company: 'Khalid Al Suwaidi Transport (Owner-Operator)', trn: '100990011200007', license: 'CN-6677889',
    phone: '+971 50 123 4567', iban: 'AE440331234567890555666', zones: 'Jebel Ali, Al Quoz',
    fleet: 1, chassis: 1, insurance: true, rating: 4.75, completed: 34, verifiedAt: sqliteTime(-60 * DAY),
  });

  // Second SHIPPER, deliberately left PENDING approval — demonstrates
  // today's requireApproved() gate (middleware/auth.js): this account can
  // log in and browse, but every write action it attempts (post a job,
  // bid, etc.) gets a real 403 until an admin approves it from the console.
  const shipper2Id = await insertUser({ email: 'shipper2@arabianretail.ae', role: 'SHIPPER', tier: 'BRONZE', referral_code: 'SHP-ARABIANRETAIL', is_verified: true, approvalStatus: 'PENDING' });
  await insertProfile(shipper2Id, {
    company: 'Arabian Retail Group', trn: '100001122300008', license: 'CN-7788990X',
    phone: '+971 4 556 7788', zones: 'Dubai South, Al Quoz', rating: 5.0, completed: 0,
  });

  // Multi-user org — Emirates Overland Haulage (emiratesId) gets a real
  // 3-seat team, one per non-driver seat_role (server/lib/constants.js's
  // SEAT_ROLES), matching exactly what POST /api/org/members creates.
  await insertSeat(emiratesId, 'CARRIER', { email: 'ops@dubaidrayage.com', seatRole: 'OPS', displayName: 'Aisha Al Falasi (Ops)' });
  await insertSeat(emiratesId, 'CARRIER', { email: 'finance@dubaidrayage.com', seatRole: 'FINANCE', displayName: 'Mansoor Al Blooshi (Finance)' });
  await insertSeat(emiratesId, 'CARRIER', { email: 'viewer@dubaidrayage.com', seatRole: 'VIEWER', displayName: 'Fatima Al Zaabi (Viewer)' });

  // Driver roster + logins. Emirates Overland gets two roster drivers, one
  // with an actual DRIVER seat login (server/routes/fleet.routes.js's
  // POST /:id/seat); Gulf Heavy gets one DRIVER_ASSOCIATE seat specifically
  // (used by the wallet-entry scenario below — a pool driver pushed trip
  // offers over WhatsApp, distinct from a regular DRIVER seat).
  const driver1Id = await insertDriver(emiratesId, { name: 'Rashid Al Marri', phone: '0501234567', license: 'DXB-DRV1001', licenseExpiry: sqliteTime(300 * DAY).slice(0, 10) });
  const driver1Seat = await insertDriverSeat(driver1Id, emiratesId, 'CARRIER', 'DRIVER', 'Rashid Al Marri', '0501234567');
  const driver2Id = await insertDriver(emiratesId, { name: 'Hamdan Youssef', phone: '0501234568', license: 'DXB-DRV1002', licenseExpiry: sqliteTime(200 * DAY).slice(0, 10) });

  const associateDriverId = await insertDriver(gulfheavyId, { name: 'Faisal Obaid', phone: '0509876543', license: 'DXB-DRV2001', licenseExpiry: sqliteTime(250 * DAY).slice(0, 10) });
  const associateSeat = await insertDriverSeat(associateDriverId, gulfheavyId, 'CARRIER', 'DRIVER_ASSOCIATE', 'Faisal Obaid', '0509876543');

  // --- Jobs (mix of statuses for demo purposes) ------------------------
  const insertJob = db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, max_budget_aed, agreed_price_aed, status, escrow_status, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     RETURNING id`
  );
  // RETURNING id added (previously absent — none of the original 6 calls
  // below capture a return value, so this is purely additive) so the new
  // ancillary-charge scenario further down can attach a charge to a real
  // bid id without a second prepared statement.
  const insertBid = db.prepare(
    `INSERT INTO bids (job_id, carrier_id, amount_aed, eta_minutes, truck_type, notes, status)
     VALUES (?,?,?,?,?,?,?) RETURNING id`
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
  const j1 = await insertJob.run('LB-1001', shipperId, null, '40ft', 'DRY', 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 3', in2h, in24h, 2500, null, 'OPEN', 'PENDING', 'Urgent — container ready at gate');
  const j1id = Number(j1.lastInsertRowid);
  const j1bid1 = await insertBid.run(j1id, emiratesId, 1800, 120, '10-wheeler', 'Can pick up in 2 hours', 'PENDING');
  await insertBid.run(j1id, falconId, 2100, 90, 'lowboy', 'Faster route via E311', 'PENDING');
  // Ancillary charge declared at bid time (server/routes/bids.routes.js) —
  // Salik toll, agreed by both sides, exactly what a shipper reviewing this
  // bid would see as "+AED 25 anticipated extras" on JobDetail.jsx.
  await db.prepare(
    `INSERT INTO bid_ancillary_charges (bid_id, charge_type, amount_aed, proposed_by, agreed_by_shipper, agreed_by_carrier) VALUES (?,?,?,?,?,?)`
  ).run(Number(j1bid1.lastInsertRowid), 'SALIK', 25, emiratesId, 1, 1);

  // Job 2 — OPEN, 1 bid
  const j2 = await insertJob.run('LB-1002', shipperId, null, '20ft', 'REEFER', 'Khalifa Port', 'Dubai South', 'Dubai South Logistics District', in6h, in48h, 3200, null, 'OPEN', 'PENDING', 'Temperature-sensitive — maintain -18C');
  const j2id = Number(j2.lastInsertRowid);
  await insertBid.run(j2id, gulfheavyId, 2800, 180, 'reefer-truck', 'Reefer unit pre-cooled', 'PENDING');

  // Job 3 — AWARDED, in progress
  const j3 = await insertJob.run('LB-1003', shipperId, emiratesId, '40ft', 'OPEN_TOP', 'Jebel Ali', 'Musaffah', 'Musaffah Industrial Zone', twoDaysAgo, in24h, null, 2200, 'AWARDED', 'ESCROWED', 'Heavy cargo — 28 tons');
  const j3id = Number(j3.lastInsertRowid);
  await insertBid.run(j3id, emiratesId, 2200, 240, 'lowboy', 'Open-top available', 'ACCEPTED');

  // Job 4 — DELIVERED, pending release
  const j4 = await insertJob.run('LB-1004', shipperId, falconId, '20ft', 'DRY', 'Khalifa Port', 'Jebel Ali', 'Jebel Ali Free Zone Warehouse 7', threeDaysAgo, yesterday, null, 1500, 'DELIVERED', 'ESCROWED', null);
  const j4id = Number(j4.lastInsertRowid);
  await insertBid.run(j4id, falconId, 1500, 60, 'box-truck', 'Direct — no stops', 'ACCEPTED');

  // Job 5 — COMPLETED
  const j5 = await insertJob.run('LB-1005', shipperId, gulfheavyId, '40ft', 'DRY', 'Jebel Ali', 'Sharjah', 'Sharjah Industrial Area 5', threeDaysAgo, twoDaysAgo, null, 1900, 'COMPLETED', 'RELEASED', null);
  const j5id = Number(j5.lastInsertRowid);
  await insertBid.run(j5id, gulfheavyId, 1900, 150, '10-wheeler', 'Standard drayage', 'ACCEPTED');

  // Job 6 — CANCELLED
  await insertJob.run('LB-1006', shipperId, null, '20ft', 'DRY', 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 1', threeDaysAgo, twoDaysAgo, 2000, null, 'CANCELLED', 'PENDING', 'Shipper cancelled — route no longer needed');

  console.log(`[seed] created 6 demo jobs with bids`);

  // --- Feature-scenario data (investor demo) -----------------------------
  // Each block below is real data behind a specific feature, not another
  // generic job — matching the exact schema/state-machine each route
  // enforces, verified by reading the relevant route file. Raw INSERTs
  // (not the shared insertJob/insertBid statements above, which only cover
  // the original 6 jobs' column set) so each scenario can set the extra
  // columns it actually needs without touching those 6 call sites.

  // Job 7 — GIT cargo insurance bound (server/lib/insurance.js's real rate
  // card: 120,000 * 35bps = 420, within the 25–1,500 floor/cap).
  const j7 = await db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, max_budget_aed, status, escrow_status, notes, cargo_value_aed, insurance_opt_in)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`
  ).run('LB-1007', shipperId, null, '40ft', 'DRY', 'Jebel Ali', 'DIP', 'Dubai Investment Park Warehouse 12', in12h, in48h, 4500, 'OPEN', 'PENDING', 'High-value electronics — insured', 120000, 1);
  const j7id = Number(j7.lastInsertRowid);
  const insurancePremium = 420; // 120000 * 0.0035, matches lib/insurance.js's quote() exactly
  await db.prepare(
    `INSERT INTO job_insurance (job_id, shipper_id, provider, cargo_value_aed, premium_aed, coverage_aed, rate_bps, status, policy_ref) VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(j7id, shipperId, 'internal', 120000, insurancePremium, 120000, 35, 'ACTIVE', `INTERNAL-LB-1007-${Date.now().toString(36).toUpperCase()}`);

  // Job 8 — priority placement boost active (server/lib/constants.js's
  // JOB_SORT_COLUMNS reads priority_boost_until to sort this first).
  await db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, max_budget_aed, status, escrow_status, notes, priority_boost_until)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','+6 hours'))`
  ).run('LB-1008', shipperId, null, '20ft', 'DRY', 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 4', in6h, in24h, 2800, 'OPEN', 'PENDING', 'Boosted placement — visible first in Open Loads');

  // Job 9 — OPEN dispute (server/routes/job-lifecycle.routes.js's real
  // 7-type vocabulary; 48h SLA deadline like a freshly-opened one).
  const j9 = await insertJob.run('LB-1009', shipperId, falconId, '40ft', 'DRY', 'Khalifa Port', 'Musaffah', 'Musaffah Industrial Zone 3', threeDaysAgo, yesterday, null, 1750, 'DISPUTED', 'DISPUTED', 'Cargo shortage reported on delivery');
  const j9id = Number(j9.lastInsertRowid);
  await insertBid.run(j9id, falconId, 1750, 200, 'box-truck', 'Standard delivery', 'ACCEPTED');
  await db.prepare(
    `INSERT INTO disputes (job_id, opened_by, reason, status, dispute_type, sla_deadline) VALUES (?,?,?,?,?,datetime('now','+48 hours'))`
  ).run(j9id, shipperId, 'Delivered pallet count short by 2 units against the packing list', 'OPEN', 'DAMAGE_SHORTAGE');

  // Job 10 — RESOLVED dispute with a real SPLIT decision (previously a
  // real bug: SPLIT fell through to the same code path as full release —
  // see admin.routes.js's fix comment). 70/30 carrier/shipper split on a
  // AED 2,400 job: carrier gross 1,680, 6% commission (settings.
  // commission_rate_bps) = 100.8 -> 101, net 1,579; shipper refund 720.
  const j10 = await insertJob.run('LB-1010', shipperId, gulfheavyId, '40ft', 'OPEN_TOP', 'Jebel Ali', 'Sharjah', 'Sharjah Industrial Area 7', threeDaysAgo, twoDaysAgo, null, 2400, 'COMPLETED', 'RELEASED', 'Resolved: partial cargo damage, cost split');
  const j10id = Number(j10.lastInsertRowid);
  await insertBid.run(j10id, gulfheavyId, 2400, 210, 'lowboy', 'Open-top, heavy cargo', 'ACCEPTED');
  await db.prepare(
    `INSERT INTO disputes (job_id, opened_by, reason, status, dispute_type, determination, decision, resolved_by, resolved_at, split_shipper_pct, split_carrier_pct) VALUES (?,?,?,?,?,?,?,?,datetime('now','-6 hours'),?,?)`
  ).run(j10id, shipperId, 'Cargo arrived with visible crate damage on one of three pallets', 'RESOLVED', 'DAMAGE_SHORTAGE', 'One of three pallets confirmed damaged in transit per EIR photos — cost split 70/30 carrier/shipper', 'SPLIT', adminId, 30, 70);

  // Job 11 — GCC cross-border (server/lib/gcc.js's CountryConfig — Saudi
  // Arabia leg: SAR currency, 15% VAT-equivalent tax_rate_bps, distinct
  // from every other UAE-only (AE/AED/5%) job in this seed).
  await db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, agreed_price_aed, status, escrow_status, notes, country_code, currency, tax_rate_bps)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('LB-1011', shipperId, emiratesId, '40ft', 'DRY', 'Jebel Ali', 'Dammam', 'Dammam Third Industrial City', twoDaysAgo, in24h, 3600, 'AWARDED', 'ESCROWED', 'Cross-border GCC corridor — Dubai to Dammam, KSA', 'SA', 'SAR', 1500);

  // Job 12 — broker direct-assign (server/routes/broker.routes.js): Levant
  // Logix assigns a job straight to Emirates Overland, from its own roster
  // (broker_carriers, seeded above), with a disclosed 5% spread.
  await db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, agreed_price_aed, status, escrow_status, notes, broker_id, broker_spread_bps)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('LB-1012', shipperId, emiratesId, '20ft', 'DRY', 'Khalifa Port', 'Al Quoz', 'Al Quoz Industrial Area 2', yesterday, in24h, 1650, 'AWARDED', 'ESCROWED', 'Direct-assigned via broker — one-hop disclosed spread', brokerId, 500);

  // Job 13 — completed job executed by a DRIVER_ASSOCIATE seat (Faisal
  // Obaid, under Gulf Heavy Transport) — the wallet entry below is exactly
  // what job.service.js's real completion path creates automatically
  // (80% default split from settings.driver_associate_default_split_bps).
  const j13 = await insertJob.run('LB-1013', shipperId, gulfheavyId, '20ft', 'DRY', 'Jebel Ali', 'Musaffah', 'Musaffah Industrial Zone 5', threeDaysAgo, twoDaysAgo, null, 2100, 'COMPLETED', 'RELEASED', null);
  const j13id = Number(j13.lastInsertRowid);
  await insertBid.run(j13id, gulfheavyId, 2100, 220, '10-wheeler', 'Pool driver assigned', 'ACCEPTED');
  await db.prepare(`UPDATE jobs SET assigned_driver_id=?, assigned_driver_name=?, assigned_driver_phone=? WHERE id=?`)
    .run(associateDriverId, 'Faisal Obaid', '0509876543', j13id);
  const driverShareAed = Math.round(2100 * 0.8 * 100) / 100; // 8000 bps default split
  await db.prepare(
    `INSERT INTO driver_wallet_entries (driver_id, job_id, carrier_id, gross_amount_aed, split_bps, driver_share_aed, status) VALUES (?,?,?,?,?,?,?)`
  ).run(associateDriverId, j13id, gulfheavyId, 2100, 8000, driverShareAed, 'PENDING');

  // Ratings — both directions on two different COMPLETED jobs, plus one
  // attributed to a specific driver (ratings.driver_id), so the driver
  // roster view has a real quality signal behind it, not just a name.
  await db.prepare(`INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment) VALUES (?,?,?,?,?)`)
    .run(j5id, shipperId, gulfheavyId, 5, 'On time, driver called ahead, no issues.');
  await db.prepare(`INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment) VALUES (?,?,?,?,?)`)
    .run(j5id, gulfheavyId, shipperId, 5, 'Gate pass and paperwork ready on arrival.');
  await db.prepare(`INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment, driver_id) VALUES (?,?,?,?,?,?)`)
    .run(j13id, shipperId, gulfheavyId, 4, 'Smooth delivery — driver Faisal was professional and on time.', associateDriverId);

  // Contract lane — recurring weekly commitment (server/routes/
  // retention.routes.js's contract_lanes; distinct from the one-off RFP
  // below, which is a competitively-bid tender, not a standing lane).
  await db.prepare(
    `INSERT INTO contract_lanes (shipper_id, pickup_terminal, delivery_area, delivery_address, monthly_loads, target_price_aed, status) VALUES (?,?,?,?,?,?,?)`
  ).run(shipperId, 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 3', 12, 620, 'ACTIVE');

  // RFP — competitive tender with 2 bids, one awarded (server/routes/
  // rfp.routes.js: awarding sets the winning bid ACCEPTED, every other
  // REJECTED, exactly mirrored here rather than re-deriving the logic).
  const rfp1 = await db.prepare(
    `INSERT INTO contract_rfps (shipper_id, title, description, origin, destination, total_containers, duration_months, budget_aed, status, awarded_carrier_id) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`
  ).run(shipperId, 'Weekly JAFZA → Musaffah Contract Lane', 'Recurring weekly drayage, 40HC dry, 6-month commitment', 'Jebel Ali', 'Musaffah', 24, 6, 180000, 'AWARDED', emiratesId);
  const rfp1id = Number(rfp1.lastInsertRowid);
  const rfpBidWon = await db.prepare(
    `INSERT INTO rfp_bids (rfp_id, carrier_id, amount_aed, eta_days, proposal, status) VALUES (?,?,?,?,?,?) RETURNING id`
  ).run(rfp1id, emiratesId, 170000, 2, 'Dedicated 3-truck rotation, weekly reporting, fuel-surcharge locked for the term.', 'ACCEPTED');
  await db.prepare(
    `INSERT INTO rfp_bids (rfp_id, carrier_id, amount_aed, eta_days, proposal, status) VALUES (?,?,?,?,?,?)`
  ).run(rfp1id, falconId, 185000, 3, 'Standard rotation, monthly reporting.', 'REJECTED');
  for (let i = 1; i <= 6; i++) {
    const due = new Date(now + i * 30 * DAY).toISOString();
    await db.prepare(`INSERT INTO rfp_milestones (rfp_id, title, due_at, amount_aed) VALUES (?,?,?,?)`)
      .run(rfp1id, `Milestone ${i}/6`, due, 30000);
  }

  // EDI consignments (server/routes/edi.routes.js) — one linked to job 3
  // (already AWARDED/in-progress, so IN_TRANSIT fits), one standalone
  // CREATED consignment not yet linked to any Loadbyton job.
  await db.prepare(
    `INSERT INTO global_consignments (id, source, mode, status, origin, destination, payload, linked_job_id) VALUES (?,?,?,?,?,?,?,?)`
  ).run('EDI304-DEMO-001', 'EDI_304', 'DRAYAGE', 'IN_TRANSIT', 'JEBEL_ALI_T1', 'MUSAFFAH', JSON.stringify({ bol: 'EDI304-DEMO-001', shipper: 'Al-Majid Global Freight' }), j3id);
  await db.prepare(
    `INSERT INTO global_consignments (id, source, mode, status, origin, destination, payload, linked_job_id) VALUES (?,?,?,?,?,?,?,?)`
  ).run('CXML-DEMO-002', 'CARGO_XML', 'MARITIME', 'CREATED', 'JEBEL_ALI_T2', 'DAMMAM', JSON.stringify({ awb: 'CXML-DEMO-002', mode: 'MARITIME' }), null);

  console.log(`[seed] created 13 total demo jobs (6 original + 7 scenario), full account roster (FORWARDER/BROKER/OWNER_OPERATOR/multi-seat org/DRIVER+DRIVER_ASSOCIATE seats), RFP, GIT insurance, disputes (open+resolved SPLIT), contract lane, EDI consignments, ratings, and a driver wallet entry`);
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

// INSERT OR IGNORE is SQLite-only syntax (a hard Postgres syntax error) and
// isn't needed anyway — tryCreateAccount already pre-checks existence, and
// the try/catch below covers the one thing that check can't (two boots
// racing to create the same demo account at once) portably on both engines,
// without dialect-specific SQL.
async function tryCreateAccount(insertUserStmt, insertProfileStmt, passwordHash, { email, role, tier, referral_code, is_verified }, p) {
  const existing = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (existing) return null;
  try {
    const r = await insertUserStmt.run(email, passwordHash, role, is_verified === false ? 0 : 1, tier, referral_code);
    const userId = Number(r.lastInsertRowid);
    if (!userId) return null;
    await insertProfileStmt.run(
      userId, p.company, encryptField(p.trn), p.license || null, p.phone || null,
      p.iban ? encryptField(p.iban) : null, p.zones || null, p.fleet || 0, p.chassis || 0,
      p.insurance ? 1 : 0, p.rating ?? 5.0, p.completed ?? 0, p.verifiedAt || null
    );
    return email;
  } catch (e) {
    if (/unique|duplicate/i.test(e.message || '')) return null; // lost the race, fine
    throw e;
  }
}

async function ensureDemoLogins() {
  const insertUserStmt = db.prepare(
    `INSERT INTO users (email, password_hash, role, is_verified, tier, referral_code, email_verified_at, account_approval_status, account_approved_at)
     VALUES (?,?,?,?,?,?,datetime('now'),'APPROVED',datetime('now'))
     RETURNING id`
  );
  const insertProfileStmt = db.prepare(
    `INSERT INTO profiles (user_id, company_name, trn_number, trade_license_number, phone, iban, coverage_zones,
       fleet_size, owned_chassis, insurance_uploaded, rating_avg, completed_jobs, verified_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const passwordHash = bcryptLogin.hashSync('demo1234', 10);
  let created = [];

  for (const acct of DEMO_LOGIN_ROSTER) {
    const email = await tryCreateAccount(insertUserStmt, insertProfileStmt, passwordHash, acct, acct.profile);
    if (email) created.push(email);
  }

  if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_ADMIN === '1') {
    const email = await tryCreateAccount(
      insertUserStmt, insertProfileStmt, passwordHash,
      { email: 'admin@loadbyton.ae', role: 'ADMIN', tier: 'GOLD', referral_code: 'ADM-LOADBYTON', is_verified: true },
      { company: 'Loadbyton Platform', trn: '100000000000001', license: 'LB-ADMIN001', phone: '+971 4 000 0001', zones: 'All UAE' }
    );
    if (email) created.push(email);
  }

  if (created.length) console.log(`[seed] created demo accounts: ${created.join(', ')}`);
}

module.exports.ensureDemoLogins = ensureDemoLogins;
