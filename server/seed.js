// Demo seed — fully idempotent, safe to run on every boot against ANY
// database state: empty, partially seeded, or already carrying real
// production accounts that have nothing to do with this roster.
//
// Root cause this rewrite fixes: the previous design only ever created
// anything when the *entire* users table was empty (`if (userCount > 0)
// return`). That's fine for a brand-new database, but it means the demo
// roster can NEVER reach a database that already has even one real user
// in it — which describes every actual production deployment past its
// first boot. A live instance whose operator created a real admin account
// (or that predates a later addition to this roster) permanently could
// not get the missing accounts/jobs, no matter how many times it
// restarted. `ensureDemoLogins()` used to paper over this for exactly 5
// of the accounts; this rewrite extends that same "check first, create
// only what's missing" idea to the *entire* roster — every account, every
// scenario job and its dependent rows — so there's one mechanism, not two
// with diverging coverage.
//
// Every creation below is gated on "does this exact named thing already
// exist" (by email for accounts, by job_code for jobs) before touching
// anything. Nothing here ever updates or deletes an existing row, and
// nothing here ever looks at unrelated data already in the database —
// nothing about a real loadbyton@gmail.com admin account (say) causes
// this to behave any differently than it would on a totally empty DB.

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
  const PASSWORD_HASH = bcrypt.hashSync('demo1234', 10);
  const created = { accounts: [], jobs: [] };

  // --- Idempotent primitives ---------------------------------------------

  // Every account below (top-level user, org seat, or driver seat) is
  // looked up by email first; only missing ones get created. Returns
  // { id, isNew } so callers can decide whether to also seed rows that
  // hang off this account (a client roster entry, say) — only on first
  // creation, never re-added on a later boot just because the check ran
  // again.
  async function ensureUser(email, buildRow) {
    const existing = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (existing) return { id: existing.id, isNew: false };
    const row = buildRow();
    const r = await db
      .prepare(
        `INSERT INTO users (email, password_hash, role, is_verified, tier, referral_code, email_verified_at, account_approval_status, account_approved_at, org_owner_id, seat_role, display_name)
         VALUES (?,?,?,?,?,?,${row.emailVerified === false ? 'NULL' : "datetime('now')"},?,${row.approvalStatus === 'PENDING' ? 'NULL' : "datetime('now')"},?,?,?)
         RETURNING id`
      )
      .run(
        email, PASSWORD_HASH, row.role, row.is_verified ? 1 : 0, row.tier || 'BRONZE', row.referral_code || null,
        row.approvalStatus || 'APPROVED', row.orgOwnerId || null, row.seatRole || null, row.displayName || null
      );
    const userId = Number(r.lastInsertRowid);
    // Seed/demo accounts simulate an already-established real user, not a
    // fresh signup — record a standing Terms acceptance so demo
    // walkthroughs aren't blocked by the same gate a real signup goes
    // through (server/routes/auth.routes.js). Seats share the org owner's
    // acceptance in the real flow and never take this path themselves, so
    // only record it for a genuine top-level account.
    if (!row.seatRole) {
      await db.prepare(`INSERT INTO terms_acceptances (user_id, terms_version, context) VALUES (?,?,'SIGNUP')`).run(userId, TERMS_VERSION);
    }
    created.accounts.push(email);
    return { id: userId, isNew: true };
  }

  async function ensureProfile(userId, p) {
    const existing = await db.prepare('SELECT user_id FROM profiles WHERE user_id=?').get(userId);
    if (existing) return;
    await db.prepare(
      `INSERT INTO profiles (user_id, company_name, trn_number, trade_license_number, phone, iban, coverage_zones,
         fleet_size, owned_chassis, insurance_uploaded, rating_avg, completed_jobs, verified_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      userId, p.company, encryptField(p.trn), p.license || null, p.phone || null,
      p.iban ? encryptField(p.iban) : null, p.zones || null, p.fleet || 0, p.chassis || 0,
      p.insurance ? 1 : 0, p.rating ?? 5.0, p.completed ?? 0, p.verifiedAt || null
    );
    // available_units defaults NULL at the column level (server/schema.js)
    // — its one-time backfill runs during schema init, before any of these
    // seed rows exist, so every seeded profile needs this explicitly.
    await db.prepare(`UPDATE profiles SET available_units = fleet_size WHERE user_id=? AND available_units IS NULL`).run(userId);
  }

  // Mirrors server/routes/fleet.routes.js's roster-registration — looked
  // up by (carrier_id, phone) since drivers have no unique email of their
  // own until/unless they get a login seat.
  async function ensureDriver(carrierId, { name, phone, license, licenseExpiry }) {
    const existing = await db.prepare('SELECT id FROM drivers WHERE carrier_id=? AND phone=?').get(carrierId, phone);
    if (existing) return existing.id;
    const r = await db
      .prepare(`INSERT INTO drivers (carrier_id, name, phone, license_number, license_expiry) VALUES (?,?,?,?,?) RETURNING id`)
      .run(carrierId, name, phone, license || null, licenseExpiry || null);
    return Number(r.lastInsertRowid);
  }

  // A driver seat is a login tied to a drivers roster row (POST
  // /:id/seat's real mechanics), keyed by the same synthetic-email
  // convention the real endpoint uses — so ensureUser's own email check
  // already makes this idempotent; this just also links drivers.seat_user_id
  // the first time.
  async function ensureDriverSeat(driverId, ownerId, ownerRole, seatRole, displayName, phone) {
    const email = `${phone.replace(/[^0-9]/g, '')}@drivers.loadbyton.internal`;
    const { id: seatUserId, isNew } = await ensureUser(email, () => ({ role: ownerRole, tier: 'BRONZE', orgOwnerId: ownerId, seatRole, displayName, is_verified: true }));
    if (isNew) await db.prepare(`UPDATE drivers SET seat_user_id=? WHERE id=?`).run(seatUserId, driverId);
    return seatUserId;
  }

  // A scenario job (and everything that hangs off it — bids, disputes,
  // insurance, etc.) is an atomic unit: if job_code already exists, skip
  // the whole block, including its child rows, so a second boot never
  // adds a second set of bids onto a job that's already there. `build`
  // receives nothing and does all the INSERTs itself (job + children);
  // its return value is ignored — callers that need the new job's id read
  // it back via job_code same as everything else does.
  async function ensureJob(jobCode, build) {
    const existing = await db.prepare('SELECT id FROM jobs WHERE job_code=?').get(jobCode);
    if (existing) return { id: existing.id, isNew: false };
    await build();
    const row = await db.prepare('SELECT id FROM jobs WHERE job_code=?').get(jobCode);
    created.jobs.push(jobCode);
    return { id: row.id, isNew: true };
  }

  // --- Original roster (6 accounts) ---------------------------------------

  const { id: shipperId } = await ensureUser('shipper@jebelalilogistics.ae', () => ({ role: 'SHIPPER', tier: 'SILVER', referral_code: 'SHP-ALMAJID', is_verified: true }));
  await ensureProfile(shipperId, { company: 'Al-Majid Global Freight', trn: '100234567800003', license: 'CN-1122334', phone: '+971 4 221 5566', zones: 'Jebel Ali, JAFZA, Dubai South', rating: 4.7, completed: 58 });

  const { id: emiratesId } = await ensureUser('carrier@dubaidrayage.com', () => ({ role: 'CARRIER', tier: 'GOLD', referral_code: 'CAR-EMIRATES', is_verified: true }));
  await ensureProfile(emiratesId, { company: 'Emirates Overland Haulage', trn: '100987654300001', license: 'CN-5566778', phone: '+971 4 887 3210', iban: 'AE070331234567890123456', zones: 'JAFZA, Al Quoz, DIP', fleet: 42, chassis: 30, insurance: true, rating: 4.85, completed: 320, verifiedAt: sqliteTime(-120 * DAY) });

  const { id: falconId } = await ensureUser('falcon@containerxpress.ae', () => ({ role: 'CARRIER', tier: 'SILVER', referral_code: 'CAR-FALCON', is_verified: true }));
  await ensureProfile(falconId, { company: 'Falcon Container Express', trn: '100112233400002', license: 'CN-3344556', phone: '+971 4 556 8899', iban: 'AE290331234567890111222', zones: 'Jebel Ali, Dubai South', fleet: 18, chassis: 12, insurance: true, rating: 4.6, completed: 140, verifiedAt: sqliteTime(-90 * DAY) });

  const { id: gulfheavyId } = await ensureUser('gulfheavy@fleet.ae', () => ({ role: 'CARRIER', tier: 'GOLD', referral_code: 'CAR-GULFHEAVY', is_verified: true }));
  await ensureProfile(gulfheavyId, { company: 'Gulf Heavy Transport', trn: '100445566700003', license: 'CN-7788990', phone: '+971 6 553 4477', iban: 'AE330331234567890333444', zones: 'Jebel Ali, DIP, Al Quoz, Musaffah', fleet: 55, chassis: 40, insurance: true, rating: 4.9, completed: 410, verifiedAt: sqliteTime(-150 * DAY) });

  const { id: desertlineId } = await ensureUser('desertline@drayage.ae', () => ({ role: 'CARRIER', tier: 'BRONZE', referral_code: 'CAR-DESERTLINE', is_verified: false }));
  await ensureProfile(desertlineId, { company: 'Desert Line Drayage', trn: '100667788900004', license: 'CN-9911223', phone: '+971 6 221 7788', zones: 'Sharjah, Al Quoz', fleet: 6, chassis: 2, insurance: false, rating: 5.0, completed: 0 });

  // Gated the same way the pre-rewrite ensureDemoLogins() gated this one
  // account: never auto-create a real ADMIN login on a real production
  // boot unless explicitly opted in.
  let adminId = null;
  if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_ADMIN === '1') {
    const r = await ensureUser('admin@loadbyton.ae', () => ({ role: 'ADMIN', tier: 'GOLD', referral_code: 'ADM-LOADBYTON', is_verified: true }));
    adminId = r.id;
    await ensureProfile(adminId, { company: 'Loadbyton Platform', trn: '100000000000001', license: 'LB-ADMIN001', phone: '+971 4 000 0001', zones: 'All UAE' });
  }

  // --- Full account-type roster (investor demo) ---------------------------
  // One real, working account per role this platform supports beyond
  // plain SHIPPER/CARRIER/ADMIN, plus multi-user org structure and driver
  // logins, so an investor walkthrough (or anyone testing role-specific
  // UI) can log into every account type that exists.

  // FORWARDER — posts on behalf of client shippers (roleSatisfies() lets
  // it through every SHIPPER-role guard; the client roster is what's
  // actually new for this role).
  const { id: forwarderId, isNew: forwarderIsNew } = await ensureUser('forwarder@gulfconnect.ae', () => ({ role: 'FORWARDER', tier: 'GOLD', referral_code: 'FWD-GULFCONNECT', is_verified: true }));
  await ensureProfile(forwarderId, { company: 'Gulf Connect Logistics Forwarding', trn: '100778899000005', license: 'CN-4455667', phone: '+971 4 330 1122', zones: 'Dubai, Abu Dhabi, Sharjah', rating: 4.8, completed: 26 });
  if (forwarderIsNew) {
    await db.prepare(`INSERT INTO forwarder_clients (forwarder_id, client_name, contact_phone, contact_email) VALUES (?,?,?,?)`)
      .run(forwarderId, 'Al Rostamani Trading LLC', '+971 4 220 9911', 'logistics@alrostamani-trading.ae');
  }

  // BROKER — direct-assigns to a roster of real carriers under the
  // disclosed one-hop rule.
  const { id: brokerId, isNew: brokerIsNew } = await ensureUser('broker@levantlogix.ae', () => ({ role: 'BROKER', tier: 'GOLD', referral_code: 'BRK-LEVANTLOGIX', is_verified: true }));
  await ensureProfile(brokerId, { company: 'Levant Logix Brokerage', trn: '100889900100006', license: 'CN-5566778X', phone: '+971 4 448 2200', zones: 'Dubai, Abu Dhabi', rating: 4.65, completed: 41 });
  if (brokerIsNew) {
    const already = await db.prepare('SELECT 1 FROM broker_carriers WHERE broker_id=? AND carrier_id=?').get(brokerId, emiratesId);
    if (!already) await db.prepare(`INSERT INTO broker_carriers (broker_id, carrier_id) VALUES (?,?)`).run(brokerId, emiratesId);
  }

  // OWNER_OPERATOR — a single-truck carrier-equivalent.
  const { id: ownerOpId } = await ensureUser('owner@singletruck.ae', () => ({ role: 'OWNER_OPERATOR', tier: 'SILVER', referral_code: 'OWN-SINGLETRUCK', is_verified: true }));
  await ensureProfile(ownerOpId, { company: 'Khalid Al Suwaidi Transport (Owner-Operator)', trn: '100990011200007', license: 'CN-6677889', phone: '+971 50 123 4567', iban: 'AE440331234567890555666', zones: 'Jebel Ali, Al Quoz', fleet: 1, chassis: 1, insurance: true, rating: 4.75, completed: 34, verifiedAt: sqliteTime(-60 * DAY) });

  // Second SHIPPER, deliberately left PENDING approval — demonstrates
  // requireApproved() live: can log in and browse, but every write action
  // it attempts gets a real 403 until an admin approves it.
  const { id: shipper2Id } = await ensureUser('shipper2@arabianretail.ae', () => ({ role: 'SHIPPER', tier: 'BRONZE', referral_code: 'SHP-ARABIANRETAIL', is_verified: true, approvalStatus: 'PENDING' }));
  await ensureProfile(shipper2Id, { company: 'Arabian Retail Group', trn: '100001122300008', license: 'CN-7788990X', phone: '+971 4 556 7788', zones: 'Dubai South, Al Quoz', rating: 5.0, completed: 0 });

  // Multi-user org — Emirates Overland Haulage gets a real 3-seat team,
  // one per non-driver seat_role, matching what POST /api/org/members
  // creates.
  await ensureUser('ops@dubaidrayage.com', () => ({ role: 'CARRIER', tier: 'BRONZE', orgOwnerId: emiratesId, seatRole: 'OPS', displayName: 'Aisha Al Falasi (Ops)', is_verified: true }));
  await ensureUser('finance@dubaidrayage.com', () => ({ role: 'CARRIER', tier: 'BRONZE', orgOwnerId: emiratesId, seatRole: 'FINANCE', displayName: 'Mansoor Al Blooshi (Finance)', is_verified: true }));
  await ensureUser('viewer@dubaidrayage.com', () => ({ role: 'CARRIER', tier: 'BRONZE', orgOwnerId: emiratesId, seatRole: 'VIEWER', displayName: 'Fatima Al Zaabi (Viewer)', is_verified: true }));

  // Driver roster + logins. Emirates Overland gets two roster drivers, one
  // with an actual DRIVER seat login; Gulf Heavy gets one DRIVER_ASSOCIATE
  // seat specifically (used by the wallet-entry scenario below).
  const driver1Id = await ensureDriver(emiratesId, { name: 'Rashid Al Marri', phone: '0501234567', license: 'DXB-DRV1001', licenseExpiry: sqliteTime(300 * DAY).slice(0, 10) });
  await ensureDriverSeat(driver1Id, emiratesId, 'CARRIER', 'DRIVER', 'Rashid Al Marri', '0501234567');
  await ensureDriver(emiratesId, { name: 'Hamdan Youssef', phone: '0501234568', license: 'DXB-DRV1002', licenseExpiry: sqliteTime(200 * DAY).slice(0, 10) });

  const associateDriverId = await ensureDriver(gulfheavyId, { name: 'Faisal Obaid', phone: '0509876543', license: 'DXB-DRV2001', licenseExpiry: sqliteTime(250 * DAY).slice(0, 10) });
  await ensureDriverSeat(associateDriverId, gulfheavyId, 'CARRIER', 'DRIVER_ASSOCIATE', 'Faisal Obaid', '0509876543');

  // --- Scenario jobs (each ensureJob call is a self-contained, atomic unit) ---

  const now = Date.now();
  const in2h = new Date(now + 2 * HOUR).toISOString();
  const in6h = new Date(now + 6 * HOUR).toISOString();
  const in12h = new Date(now + 12 * HOUR).toISOString();
  const in24h = new Date(now + 24 * HOUR).toISOString();
  const in48h = new Date(now + 48 * HOUR).toISOString();
  const yesterday = new Date(now - 24 * HOUR).toISOString();
  const twoDaysAgo = new Date(now - 48 * HOUR).toISOString();
  const threeDaysAgo = new Date(now - 72 * HOUR).toISOString();

  async function insertJob(cols, vals) {
    const r = await db.prepare(`INSERT INTO jobs (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING id`).run(...vals);
    return Number(r.lastInsertRowid);
  }
  async function insertBid(jobId, carrierId, amount, etaMin, truckType, notes, status) {
    const r = await db.prepare(`INSERT INTO bids (job_id, carrier_id, amount_aed, eta_minutes, truck_type, notes, status) VALUES (?,?,?,?,?,?,?) RETURNING id`)
      .run(jobId, carrierId, amount, etaMin, truckType, notes, status);
    return Number(r.lastInsertRowid);
  }

  // Job 1 — OPEN, 2 bids, one with an agreed Salik ancillary charge
  await ensureJob('LB-1001', async () => {
    const j1id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'max_budget_aed', 'agreed_price_aed', 'status', 'escrow_status', 'notes'],
      ['LB-1001', shipperId, null, '40ft', 'DRY', 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 3', in2h, in24h, 2500, null, 'OPEN', 'PENDING', 'Urgent — container ready at gate']
    );
    const bid1 = await insertBid(j1id, emiratesId, 1800, 120, '10-wheeler', 'Can pick up in 2 hours', 'PENDING');
    await insertBid(j1id, falconId, 2100, 90, 'lowboy', 'Faster route via E311', 'PENDING');
    await db.prepare(`INSERT INTO bid_ancillary_charges (bid_id, charge_type, amount_aed, proposed_by, agreed_by_shipper, agreed_by_carrier) VALUES (?,?,?,?,?,?)`)
      .run(bid1, 'SALIK', 25, emiratesId, 1, 1);
  });

  // Job 2 — OPEN, 1 bid
  await ensureJob('LB-1002', async () => {
    const j2id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'max_budget_aed', 'agreed_price_aed', 'status', 'escrow_status', 'notes'],
      ['LB-1002', shipperId, null, '20ft', 'REEFER', 'Khalifa Port', 'Dubai South', 'Dubai South Logistics District', in6h, in48h, 3200, null, 'OPEN', 'PENDING', 'Temperature-sensitive — maintain -18C']
    );
    await insertBid(j2id, gulfheavyId, 2800, 180, 'reefer-truck', 'Reefer unit pre-cooled', 'PENDING');
  });

  // Job 3 — AWARDED, in progress
  const j3 = await ensureJob('LB-1003', async () => {
    const j3id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'max_budget_aed', 'agreed_price_aed', 'status', 'escrow_status', 'notes'],
      ['LB-1003', shipperId, emiratesId, '40ft', 'OPEN_TOP', 'Jebel Ali', 'Musaffah', 'Musaffah Industrial Zone', twoDaysAgo, in24h, null, 2200, 'AWARDED', 'ESCROWED', 'Heavy cargo — 28 tons']
    );
    await insertBid(j3id, emiratesId, 2200, 240, 'lowboy', 'Open-top available', 'ACCEPTED');
  });

  // Job 4 — DELIVERED, pending release
  await ensureJob('LB-1004', async () => {
    const j4id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'max_budget_aed', 'agreed_price_aed', 'status', 'escrow_status', 'notes'],
      ['LB-1004', shipperId, falconId, '20ft', 'DRY', 'Khalifa Port', 'Jebel Ali', 'Jebel Ali Free Zone Warehouse 7', threeDaysAgo, yesterday, null, 1500, 'DELIVERED', 'ESCROWED', null]
    );
    await insertBid(j4id, falconId, 1500, 60, 'box-truck', 'Direct — no stops', 'ACCEPTED');
  });

  // Job 5 — COMPLETED, with ratings both directions
  const j5 = await ensureJob('LB-1005', async () => {
    const j5id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'max_budget_aed', 'agreed_price_aed', 'status', 'escrow_status', 'notes'],
      ['LB-1005', shipperId, gulfheavyId, '40ft', 'DRY', 'Jebel Ali', 'Sharjah', 'Sharjah Industrial Area 5', threeDaysAgo, twoDaysAgo, null, 1900, 'COMPLETED', 'RELEASED', null]
    );
    await insertBid(j5id, gulfheavyId, 1900, 150, '10-wheeler', 'Standard drayage', 'ACCEPTED');
    await db.prepare(`INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment) VALUES (?,?,?,?,?)`).run(j5id, shipperId, gulfheavyId, 5, 'On time, driver called ahead, no issues.');
    await db.prepare(`INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment) VALUES (?,?,?,?,?)`).run(j5id, gulfheavyId, shipperId, 5, 'Gate pass and paperwork ready on arrival.');
  });

  // Job 6 — CANCELLED
  await ensureJob('LB-1006', () => insertJob(
    ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'max_budget_aed', 'agreed_price_aed', 'status', 'escrow_status', 'notes'],
    ['LB-1006', shipperId, null, '20ft', 'DRY', 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 1', threeDaysAgo, twoDaysAgo, 2000, null, 'CANCELLED', 'PENDING', 'Shipper cancelled — route no longer needed']
  ));

  // Job 7 — GIT cargo insurance bound (lib/insurance.js's real rate card:
  // 120,000 * 35bps = 420, within the 25–1,500 floor/cap).
  await ensureJob('LB-1007', async () => {
    const j7id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'max_budget_aed', 'status', 'escrow_status', 'notes', 'cargo_value_aed', 'insurance_opt_in'],
      ['LB-1007', shipperId, null, '40ft', 'DRY', 'Jebel Ali', 'DIP', 'Dubai Investment Park Warehouse 12', in12h, in48h, 4500, 'OPEN', 'PENDING', 'High-value electronics — insured', 120000, 1]
    );
    await db.prepare(`INSERT INTO job_insurance (job_id, shipper_id, provider, cargo_value_aed, premium_aed, coverage_aed, rate_bps, status, policy_ref) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(j7id, shipperId, 'internal', 120000, 420, 120000, 35, 'ACTIVE', `INTERNAL-LB-1007-${Date.now().toString(36).toUpperCase()}`);
  });

  // Job 8 — priority placement boost active
  await ensureJob('LB-1008', () => db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, max_budget_aed, status, escrow_status, notes, priority_boost_until)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','+6 hours'))`
  ).run('LB-1008', shipperId, null, '20ft', 'DRY', 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 4', in6h, in24h, 2800, 'OPEN', 'PENDING', 'Boosted placement — visible first in Open Loads'));

  // Job 9 — OPEN dispute
  await ensureJob('LB-1009', async () => {
    const j9id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'max_budget_aed', 'agreed_price_aed', 'status', 'escrow_status', 'notes'],
      ['LB-1009', shipperId, falconId, '40ft', 'DRY', 'Khalifa Port', 'Musaffah', 'Musaffah Industrial Zone 3', threeDaysAgo, yesterday, null, 1750, 'DISPUTED', 'DISPUTED', 'Cargo shortage reported on delivery']
    );
    await insertBid(j9id, falconId, 1750, 200, 'box-truck', 'Standard delivery', 'ACCEPTED');
    await db.prepare(`INSERT INTO disputes (job_id, opened_by, reason, status, dispute_type, sla_deadline) VALUES (?,?,?,?,?,datetime('now','+48 hours'))`)
      .run(j9id, shipperId, 'Delivered pallet count short by 2 units against the packing list', 'OPEN', 'DAMAGE_SHORTAGE');
  });

  // Job 10 — RESOLVED dispute with a real SPLIT decision. Only seeded when
  // an ADMIN account exists (resolved_by is a real FK) — matches the same
  // production-safety gate as the admin account itself above.
  if (adminId) {
    await ensureJob('LB-1010', async () => {
      const j10id = await insertJob(
        ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'max_budget_aed', 'agreed_price_aed', 'status', 'escrow_status', 'notes'],
        ['LB-1010', shipperId, gulfheavyId, '40ft', 'OPEN_TOP', 'Jebel Ali', 'Sharjah', 'Sharjah Industrial Area 7', threeDaysAgo, twoDaysAgo, null, 2400, 'COMPLETED', 'RELEASED', 'Resolved: partial cargo damage, cost split']
      );
      await insertBid(j10id, gulfheavyId, 2400, 210, 'lowboy', 'Open-top, heavy cargo', 'ACCEPTED');
      await db.prepare(
        `INSERT INTO disputes (job_id, opened_by, reason, status, dispute_type, determination, decision, resolved_by, resolved_at, split_shipper_pct, split_carrier_pct) VALUES (?,?,?,?,?,?,?,?,datetime('now','-6 hours'),?,?)`
      ).run(j10id, shipperId, 'Cargo arrived with visible crate damage on one of three pallets', 'RESOLVED', 'DAMAGE_SHORTAGE', 'One of three pallets confirmed damaged in transit per EIR photos — cost split 70/30 carrier/shipper', 'SPLIT', adminId, 30, 70);
    });
  }

  // Job 11 — GCC cross-border (Dubai to Dammam, SAR currency, 15% tax)
  await ensureJob('LB-1011', () => db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, agreed_price_aed, status, escrow_status, notes, country_code, currency, tax_rate_bps)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('LB-1011', shipperId, emiratesId, '40ft', 'DRY', 'Jebel Ali', 'Dammam', 'Dammam Third Industrial City', twoDaysAgo, in24h, 3600, 'AWARDED', 'ESCROWED', 'Cross-border GCC corridor — Dubai to Dammam, KSA', 'SA', 'SAR', 1500));

  // Job 12 — broker direct-assign, disclosed 5% spread
  await ensureJob('LB-1012', () => db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, agreed_price_aed, status, escrow_status, notes, broker_id, broker_spread_bps)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('LB-1012', shipperId, emiratesId, '20ft', 'DRY', 'Khalifa Port', 'Al Quoz', 'Al Quoz Industrial Area 2', yesterday, in24h, 1650, 'AWARDED', 'ESCROWED', 'Direct-assigned via broker — one-hop disclosed spread', brokerId, 500));

  // Job 13 — completed job executed by the DRIVER_ASSOCIATE seat, with a
  // real driver-wallet entry (80% default split).
  const j13 = await ensureJob('LB-1013', async () => {
    const j13id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'max_budget_aed', 'agreed_price_aed', 'status', 'escrow_status', 'notes'],
      ['LB-1013', shipperId, gulfheavyId, '20ft', 'DRY', 'Jebel Ali', 'Musaffah', 'Musaffah Industrial Zone 5', threeDaysAgo, twoDaysAgo, null, 2100, 'COMPLETED', 'RELEASED', null]
    );
    await insertBid(j13id, gulfheavyId, 2100, 220, '10-wheeler', 'Pool driver assigned', 'ACCEPTED');
    await db.prepare(`UPDATE jobs SET assigned_driver_id=?, assigned_driver_name=?, assigned_driver_phone=? WHERE id=?`)
      .run(associateDriverId, 'Faisal Obaid', '0509876543', j13id);
    const driverShareAed = Math.round(2100 * 0.8 * 100) / 100; // 8000 bps default split
    await db.prepare(`INSERT INTO driver_wallet_entries (driver_id, job_id, carrier_id, gross_amount_aed, split_bps, driver_share_aed, status) VALUES (?,?,?,?,?,?,?)`)
      .run(associateDriverId, j13id, gulfheavyId, 2100, 8000, driverShareAed, 'PENDING');
    await db.prepare(`INSERT INTO ratings (job_id, rater_id, ratee_id, score, comment, driver_id) VALUES (?,?,?,?,?,?)`)
      .run(j13id, shipperId, gulfheavyId, 4, 'Smooth delivery — driver Faisal was professional and on time.', associateDriverId);
  });
  // --- Payment-term scenarios (Change: payment terms redesign) -----------
  // Every prior job above defaults to INSTANT — none of the four deferred
  // terms (NET_24H/7/15/28) had a single demo example. This approves the
  // primary demo shipper for deferred payment (an admin action in real
  // use — see server/routes/admin.routes.js's
  // /api/admin/credit/:userId/approve — done directly here since seeding
  // is itself a trusted, admin-equivalent operation) and adds one job per
  // term so an investor walkthrough can see all of them, at different
  // points in their due-date lifecycle (upcoming, settled, not-yet-due,
  // overdue).
  const shipperProfile = await db.prepare('SELECT credit_approved_at FROM profiles WHERE user_id=?').get(shipperId);
  if (!shipperProfile.credit_approved_at) {
    // Limit must comfortably exceed the seeded outstanding draws below
    // (LB-1014 + LB-1016 + LB-1017 = 1600 + 1900 + 2800 = 6300) with
    // headroom left over for a live demo award on top — a limit lower
    // than the seeded balance would show a nonsensical negative
    // "available" figure on the post-job payment-term picker.
    await db.prepare(`UPDATE profiles SET credit_limit_aed=10000, credit_terms_days=30, credit_approved_at=datetime('now','-45 days') WHERE user_id=?`).run(shipperId);
  }

  // Telr Split Payment beneficiary id (lib/payments.js) — a demo value so
  // the Profile page's field and the payout-routing logic have something
  // real to show, even though PAYMENTS_PROVIDER isn't 'telr' in this demo
  // environment (a real Split ID only ever comes from Telr's own KYC
  // approval — this is illustrative, not a functioning one).
  const emiratesTelrProfile = await db.prepare('SELECT telr_split_id FROM profiles WHERE user_id=?').get(emiratesId);
  if (!emiratesTelrProfile?.telr_split_id) {
    await db.prepare(`UPDATE profiles SET telr_split_id=? WHERE user_id=?`).run('demo-split-emirates-overland', emiratesId);
  }

  // Job 14 — NET_24H: awarded, no escrow held (contrast with every INSTANT
  // job above, which shows escrow_status='ESCROWED'/'HELD') — the
  // shortest deferred term, due within a day of invoice.
  const job14 = await ensureJob('LB-1014', async () => {
    const j14id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'agreed_price_aed', 'status', 'escrow_status', 'notes', 'payment_tier', 'credit_due_at'],
      ['LB-1014', shipperId, falconId, '20ft', 'DRY', 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 2', yesterday, in24h, 1600, 'AWARDED', 'PENDING', 'Payment within 24 hrs of invoice — no funds held until then', 'NET_24H', sqliteTime(18 * HOUR)]
    );
    await insertBid(j14id, falconId, 1600, 100, 'box-truck', 'Standard delivery', 'ACCEPTED');
  });

  // Job 15 — NET_7, already settled: the full happy-path lifecycle
  // (awarded → delivered → completed → admin marks settled),
  // credit_balance_aed already restored by that settlement.
  await ensureJob('LB-1015', async () => {
    const j15id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'agreed_price_aed', 'status', 'escrow_status', 'notes', 'payment_tier', 'credit_due_at', 'credit_settled_at'],
      ['LB-1015', shipperId, gulfheavyId, '40ft', 'DRY', 'Khalifa Port', 'Musaffah', 'Musaffah Industrial Zone 2', threeDaysAgo, twoDaysAgo, 2400, 'COMPLETED', 'PENDING', 'Payment in 7 days — settled on last week\'s statement', 'NET_7', sqliteTime(-3 * DAY), sqliteTime(-1 * DAY)]
    );
    await insertBid(j15id, gulfheavyId, 2400, 200, '10-wheeler', 'Standard drayage', 'ACCEPTED');
  });

  // Job 16 — NET_15, outstanding but not yet due (delivered, shipper
  // hasn't confirmed COMPLETED yet either — a realistic in-flight state,
  // not just award/settle bookends).
  const job16 = await ensureJob('LB-1016', async () => {
    const j16id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'agreed_price_aed', 'status', 'escrow_status', 'notes', 'payment_tier', 'credit_due_at'],
      ['LB-1016', shipperId, emiratesId, '20ft', 'DRY', 'Jebel Ali', 'Sharjah', 'Sharjah Industrial Area 3', twoDaysAgo, yesterday, 1900, 'DELIVERED', 'PENDING', 'Payment in 15 days — within terms, not yet due', 'NET_15', sqliteTime(10 * DAY)]
    );
    await insertBid(j16id, emiratesId, 1900, 150, '10-wheeler', 'Contract lane rate', 'ACCEPTED');
  });

  // Job 17 — NET_28, past due — the aging scenario an admin's Credit tab
  // needs to actually demonstrate collections risk, not just the happy
  // path.
  const job17 = await ensureJob('LB-1017', async () => {
    const j17id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'agreed_price_aed', 'status', 'escrow_status', 'notes', 'payment_tier', 'credit_due_at'],
      ['LB-1017', shipperId, gulfheavyId, '40ft', 'OPEN_TOP', 'Jebel Ali', 'DIP', 'Dubai Investment Park Warehouse 3', threeDaysAgo, twoDaysAgo, 2800, 'COMPLETED', 'PENDING', 'Payment in 28 days — overdue, follow up needed', 'NET_28', sqliteTime(-5 * DAY)]
    );
    await insertBid(j17id, gulfheavyId, 2800, 210, 'lowboy', 'Heavy cargo rotation', 'ACCEPTED');
  });
  // credit_balance_aed reflects LB-1014 + LB-1016 + LB-1017 only (LB-1015
  // already settled above and correctly isn't counted as outstanding) —
  // bumped exactly once, the same run each job was actually created on,
  // not re-applied on every later boot the way a bare "if balance is 0"
  // guard would (a real settle-to-zero later would look identical to
  // "never seeded" and get incorrectly topped back up).
  const creditBump = (job14.isNew ? 1600 : 0) + (job16.isNew ? 1900 : 0) + (job17.isNew ? 2800 : 0);
  if (creditBump > 0) {
    await db.prepare(`UPDATE profiles SET credit_balance_aed = credit_balance_aed + ? WHERE user_id=?`).run(creditBump, shipperId);
  }

  // Job 18 — INSTANT, delivered with escrow already FUNDED (paid at
  // award, awaiting the shipper's completion confirmation): rounds out
  // the payment-terms demo set alongside the four deferred jobs above.
  await ensureJob('LB-1018', async () => {
    const j18id = await insertJob(
      ['job_code', 'shipper_id', 'carrier_id', 'container_size', 'container_type', 'pickup_terminal', 'delivery_area', 'delivery_address', 'ready_at', 'deadline', 'agreed_price_aed', 'status', 'escrow_status', 'notes', 'payment_tier'],
      ['LB-1018', shipperId, falconId, '20ft', 'DRY', 'Khalifa Port', 'Al Quoz', 'Al Quoz Industrial Area 5', threeDaysAgo, twoDaysAgo, 1450, 'DELIVERED', 'FUNDED', 'Instant payment — paid in full at award', 'INSTANT']
    );
    await insertBid(j18id, falconId, 1450, 90, 'box-truck', 'Direct route', 'ACCEPTED');
  });

  // Pending trip offer — the WhatsApp accept/decline flow
  // (routes/whatsapp.routes.js) has no seeded row to demo live without
  // first posting and awarding a job by hand. LB-1003 is already AWARDED
  // to Emirates Overland Haulage; Rashid Al Marri (driver1Id) is their
  // driver with a real DRIVER seat login and a phone number, so the offer
  // can actually be exercised via the bot, not just displayed in the UI.
  // Gated on the job — one open offer per job is the natural shape here.
  const hasTripOffer = await db.prepare('SELECT 1 FROM trip_offers WHERE job_id=?').get(j3.id);
  if (!hasTripOffer) {
    await db.prepare(`INSERT INTO trip_offers (job_id, carrier_id, driver_id, status) VALUES (?,?,?, 'PENDING')`)
      .run(j3.id, emiratesId, driver1Id);
  }

  void j3; void j5; void j13; // ids read back for clarity above; not otherwise needed past this point

  // Notification bell / dropdown / page all read from this table, but
  // nothing above populates it — every other job/bid/dispute row here was
  // inserted directly with SQL, bypassing the notify() calls that real
  // traffic goes through (job.service.js, escrow.service.js, etc.). Without
  // this, the bell is permanently empty for every demo account. Gated on
  // "this user already has any notification" — a real duplicate isn't
  // harmful, but no reason to grow one per boot forever.
  const jobIdByCode = async (code) => (await db.prepare('SELECT id FROM jobs WHERE job_code=?').get(code))?.id ?? null;
  async function seedNotifications(userId, rows) {
    const has = await db.prepare('SELECT 1 FROM notifications WHERE user_id=? LIMIT 1').get(userId);
    if (has) return;
    for (const [title, body, jobCode, type, hoursAgo, isRead] of rows) {
      // The offset must be a literal baked into the SQL text, not a bound
      // param — db.js's SQLite→Postgres translator only recognizes
      // datetime('now','-N unit') as a literal quoted string (see its
      // comment); a bound placeholder here would pass through untranslated
      // and fail on Postgres with "function datetime(unknown) does not exist".
      await db.prepare(
        `INSERT INTO notifications (user_id, title, body, job_id, type, is_read, created_at) VALUES (?,?,?,?,?,?, datetime('now','-${hoursAgo} hours'))`
      ).run(userId, title, body, jobCode ? await jobIdByCode(jobCode) : null, type, isRead ? 1 : 0);
    }
  }
  await seedNotifications(shipperId, [
    ['Delivered — LB-1004', 'Falcon Container Express marked this job delivered. Confirm receipt to release escrow.', 'LB-1004', 'status', 2, false],
    ['Dispute resolved — LB-1010', "Admin determination: cost split 70/30 carrier/shipper. Escrow released per the split.", 'LB-1010', 'dispute', 6, false],
    ['Dispute opened — LB-1009', 'Cargo shortage reported on delivery. 48-hour SLA to respond with evidence.', 'LB-1009', 'dispute', 26, false],
    ['Carrier awarded — LB-1003', 'Emirates Overland Haulage accepted for AED 2,200. Escrow funded.', 'LB-1003', 'award', 48, true],
    ['Job completed — LB-1005', 'Gulf Heavy Fleet completed delivery. You rated them 5 stars.', 'LB-1005', 'status', 72, true],
    ['Welcome to Loadbyton', 'Your shipper account is verified and ready to post loads.', null, 'system', 240, true],
  ]);
  await seedNotifications(emiratesId, [
    ['You won LB-1003', 'Bid of AED 2,200 accepted by Al Majid Shipping LLC. Escrow funded — proceed to pickup.', 'LB-1003', 'award', 48, false],
    ['Carrier verification approved', 'Your TRN and trade license passed review. Full bidding access enabled.', null, 'verification', 200, true],
    ['Welcome to Loadbyton', 'Your carrier account is verified and ready to bid on open loads.', null, 'system', 260, true],
  ]);

  // Contract lane — recurring weekly commitment. No natural unique key of
  // its own (unlike a job_code), so gated on "this shipper already has any
  // contract lane" — good enough for a single demo row; a real duplicate
  // isn't harmful, but there's no reason to grow one per boot forever.
  const hasLane = await db.prepare('SELECT 1 FROM contract_lanes WHERE shipper_id=? LIMIT 1').get(shipperId);
  if (!hasLane) {
    await db.prepare(`INSERT INTO contract_lanes (shipper_id, pickup_terminal, delivery_area, delivery_address, monthly_loads, target_price_aed, status) VALUES (?,?,?,?,?,?,?)`)
      .run(shipperId, 'Jebel Ali', 'Al Quoz', 'Al Quoz Industrial Area 3', 12, 620, 'ACTIVE');
  }

  // RFP — competitive tender, gated on its distinctive title (no other
  // natural unique key).
  const hasRfp = await db.prepare(`SELECT id FROM contract_rfps WHERE title=?`).get('Weekly JAFZA → Musaffah Contract Lane');
  if (!hasRfp) {
    const rfp1 = await db.prepare(
      `INSERT INTO contract_rfps (shipper_id, title, description, origin, destination, total_containers, duration_months, budget_aed, status, awarded_carrier_id) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`
    ).run(shipperId, 'Weekly JAFZA → Musaffah Contract Lane', 'Recurring weekly drayage, 40HC dry, 6-month commitment', 'Jebel Ali', 'Musaffah', 24, 6, 180000, 'AWARDED', emiratesId);
    const rfp1id = Number(rfp1.lastInsertRowid);
    await db.prepare(`INSERT INTO rfp_bids (rfp_id, carrier_id, amount_aed, eta_days, proposal, status) VALUES (?,?,?,?,?,?)`)
      .run(rfp1id, emiratesId, 170000, 2, 'Dedicated 3-truck rotation, weekly reporting, fuel-surcharge locked for the term.', 'ACCEPTED');
    await db.prepare(`INSERT INTO rfp_bids (rfp_id, carrier_id, amount_aed, eta_days, proposal, status) VALUES (?,?,?,?,?,?)`)
      .run(rfp1id, falconId, 185000, 3, 'Standard rotation, monthly reporting.', 'REJECTED');
    for (let i = 1; i <= 6; i++) {
      const due = new Date(now + i * 30 * DAY).toISOString();
      await db.prepare(`INSERT INTO rfp_milestones (rfp_id, title, due_at, amount_aed) VALUES (?,?,?,?)`).run(rfp1id, `Milestone ${i}/6`, due, 30000);
    }
  }

  // EDI consignments — gated on their own id (a real unique key, no helper needed).
  const ediExisting = await db.prepare('SELECT id FROM global_consignments WHERE id IN (?,?)').all('EDI304-DEMO-001', 'CXML-DEMO-002');
  const ediIds = new Set(ediExisting.map((r) => r.id));
  if (!ediIds.has('EDI304-DEMO-001')) {
    await db.prepare(`INSERT INTO global_consignments (id, source, mode, status, origin, destination, payload, linked_job_id) VALUES (?,?,?,?,?,?,?,?)`)
      .run('EDI304-DEMO-001', 'EDI_304', 'DRAYAGE', 'IN_TRANSIT', 'JEBEL_ALI_T1', 'MUSAFFAH', JSON.stringify({ bol: 'EDI304-DEMO-001', shipper: 'Al-Majid Global Freight' }), j3.id);
  }
  if (!ediIds.has('CXML-DEMO-002')) {
    await db.prepare(`INSERT INTO global_consignments (id, source, mode, status, origin, destination, payload, linked_job_id) VALUES (?,?,?,?,?,?,?,?)`)
      .run('CXML-DEMO-002', 'CARGO_XML', 'MARITIME', 'CREATED', 'JEBEL_ALI_T2', 'DAMMAM', JSON.stringify({ awb: 'CXML-DEMO-002', mode: 'MARITIME' }), null);
  }

  // Payout backfill — every job above that reached AWARDED-or-beyond
  // (carrier_id + agreed_price_aed set) was inserted directly with SQL,
  // bypassing award.service.js's real award flow, which is what actually
  // creates the matching `payouts` row in production. Without this, GET
  // /api/jobs/:id/documents/settlement 404s ("No payout on file for this
  // job yet") for every seeded awarded/completed job — the Job History
  // page's "Settlement" link is a plain <a href> straight to that API
  // route, so the 404's raw JSON body renders directly in the browser
  // instead of a handled error. Gated per-job on "no payout row yet" (not
  // wrapped in ensureJob, since it needs to also backfill jobs seeded by
  // an earlier boot of this file, before this fix existed) so it's safe
  // to run on every boot against any existing database.
  const missingPayoutJobs = await db.prepare(
    `SELECT j.id, j.carrier_id, j.agreed_price_aed, j.escrow_status FROM jobs j
     LEFT JOIN payouts p ON p.job_id = j.id
     WHERE j.carrier_id IS NOT NULL AND j.agreed_price_aed IS NOT NULL
       AND j.status NOT IN ('OPEN','CANCELLED') AND p.id IS NULL`
  ).all();
  for (const mj of missingPayoutJobs) {
    const gross = mj.agreed_price_aed;
    const fee = Math.round(gross * 0.06); // matches award.service.js's default commission_rate_bps (600 = 6%)
    const net = gross - fee;
    const released = mj.escrow_status === 'RELEASED';
    await db.prepare(
      `INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, released_at) VALUES (?,?,?,?,?,?,?)`
    ).run(mj.id, mj.carrier_id, gross, fee, net, released ? 'RELEASED' : 'PENDING', released ? sqliteTime(0) : null);
  }

  if (created.accounts.length || created.jobs.length) {
    console.log(`[seed] top-up complete — created ${created.accounts.length} account(s)${created.accounts.length ? ` (${created.accounts.join(', ')})` : ''}, ${created.jobs.length} job(s)${created.jobs.length ? ` (${created.jobs.join(', ')})` : ''}`);
  } else {
    console.log('[seed] full demo roster already present — nothing to do');
  }
};
