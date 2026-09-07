// Unit-level, no spawned server needed (matches whatsapp.test.js's
// pattern) — but uses its own isolated temp DB_PATH since this test
// inserts synthetic driver/vehicle/carrier rows directly rather than going
// through the API. Covers the register's explicit ask: the private-plate
// and expired-visa cases, plus the two compound YELLOW rules and a clean
// pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

process.env.DB_PATH = path.join(os.tmpdir(), `loadbyton-compliance-test-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const db = require('../db');
const { evaluateCompliance } = require('../lib/compliance');

function insertUserAndProfile(overrides = {}) {
  const email = `carrier-${Math.random().toString(36).slice(2)}@test.ae`;
  const userResult = db.prepare(`INSERT INTO users (email, password_hash, role, tier, is_verified) VALUES (?, 'x', 'CARRIER', 'BRONZE', 1) RETURNING id`).run(email);
  const userId = Number(userResult.lastInsertRowid);
  db.prepare(`INSERT INTO profiles (user_id, company_name, phone, is_free_zone_registered, mainland_work_permitted) VALUES (?, 'Test Carrier', '0501234567', ?, ?)`)
    .run(userId, overrides.is_free_zone_registered ? 1 : 0, overrides.mainland_work_permitted ? 1 : 0);
  return userId;
}

function insertDriver(carrierId, overrides = {}) {
  const result = db.prepare(
    `INSERT INTO drivers (carrier_id, name, phone, visa_status, visa_expiry, license_expiry, vehicle_id) VALUES (?, 'Test Driver', '0559990000', ?, ?, ?, ?) RETURNING id`
  ).run(carrierId, overrides.visa_status || 'RESIDENCE', overrides.visa_expiry || null, overrides.license_expiry || null, overrides.vehicle_id || null);
  return db.prepare('SELECT * FROM drivers WHERE id=?').get(Number(result.lastInsertRowid));
}

function insertVehicle(carrierId, overrides = {}) {
  const result = db.prepare(
    `INSERT INTO vehicles (carrier_id, plate_number, plate_type, registration_expiry, insurance_expiry, permitted_emirates) VALUES (?, 'TEST-1', ?, ?, ?, ?) RETURNING id`
  ).run(carrierId, overrides.plate_type || 'COMMERCIAL', overrides.registration_expiry || null, overrides.insurance_expiry || null, overrides.permitted_emirates ? JSON.stringify(overrides.permitted_emirates) : null);
  return db.prepare('SELECT * FROM vehicles WHERE id=?').get(Number(result.lastInsertRowid));
}

test('a fully compliant driver+vehicle passes with no blockers', async () => {
  const carrierId = insertUserAndProfile();
  const vehicle = insertVehicle(carrierId, { registration_expiry: '2099-01-01', insurance_expiry: '2099-01-01' });
  const driver = insertDriver(carrierId, { visa_expiry: '2099-01-01', license_expiry: '2099-01-01' });
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(carrierId);

  const result = await evaluateCompliance(driver, vehicle, null, profile);
  assert.equal(result.pass, true);
  assert.equal(result.blockers.length, 0);
});

test('a private plate blocks dispatch with a RED blocker', async () => {
  const carrierId = insertUserAndProfile();
  const vehicle = insertVehicle(carrierId, { plate_type: 'PRIVATE', registration_expiry: '2099-01-01', insurance_expiry: '2099-01-01' });
  const driver = insertDriver(carrierId, { visa_expiry: '2099-01-01', license_expiry: '2099-01-01' });
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(carrierId);

  const result = await evaluateCompliance(driver, vehicle, null, profile);
  assert.equal(result.pass, false);
  assert.ok(result.blockers.some((b) => b.rule_code === 'PRIVATE_PLATE'));
});

test('an expired visa blocks dispatch with a RED blocker', async () => {
  const carrierId = insertUserAndProfile();
  const vehicle = insertVehicle(carrierId, { registration_expiry: '2099-01-01', insurance_expiry: '2099-01-01' });
  const driver = insertDriver(carrierId, { visa_expiry: '2020-01-01', license_expiry: '2099-01-01' });
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(carrierId);

  const result = await evaluateCompliance(driver, vehicle, null, profile);
  assert.equal(result.pass, false);
  assert.ok(result.blockers.some((b) => b.rule_code === 'VISA_EXPIRED'));
});

test('a visit visa (no valid residence visa) blocks dispatch', async () => {
  const carrierId = insertUserAndProfile();
  const vehicle = insertVehicle(carrierId, { registration_expiry: '2099-01-01', insurance_expiry: '2099-01-01' });
  const driver = insertDriver(carrierId, { visa_status: 'VISIT', visa_expiry: '2099-01-01', license_expiry: '2099-01-01' });
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(carrierId);

  const result = await evaluateCompliance(driver, vehicle, null, profile);
  assert.equal(result.pass, false);
  assert.ok(result.blockers.some((b) => b.rule_code === 'VISA_INVALID'));
});

test('an unset expiry date is not treated as expired (incomplete onboarding, not a violation)', async () => {
  const carrierId = insertUserAndProfile();
  const vehicle = insertVehicle(carrierId, { registration_expiry: '2099-01-01', insurance_expiry: '2099-01-01' });
  const driver = insertDriver(carrierId, { visa_expiry: null, license_expiry: '2099-01-01' });
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(carrierId);

  const result = await evaluateCompliance(driver, vehicle, null, profile);
  assert.equal(result.pass, true);
});

test('free-zone carrier without a mainland permit gets a YELLOW warning, not a blocker', async () => {
  const carrierId = insertUserAndProfile({ is_free_zone_registered: true, mainland_work_permitted: false });
  const vehicle = insertVehicle(carrierId, { registration_expiry: '2099-01-01', insurance_expiry: '2099-01-01' });
  const driver = insertDriver(carrierId, { visa_expiry: '2099-01-01', license_expiry: '2099-01-01' });
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(carrierId);

  const result = await evaluateCompliance(driver, vehicle, null, profile);
  assert.equal(result.pass, true);
  assert.ok(result.warnings.some((w) => w.rule_code === 'MAINLAND_WITHOUT_PERMIT'));
});

test('a job outside the vehicle\'s permitted emirates gets a YELLOW warning', async () => {
  const carrierId = insertUserAndProfile();
  const vehicle = insertVehicle(carrierId, { registration_expiry: '2099-01-01', insurance_expiry: '2099-01-01', permitted_emirates: ['Dubai'] });
  const driver = insertDriver(carrierId, { visa_expiry: '2099-01-01', license_expiry: '2099-01-01' });
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(carrierId);
  const job = { pickup_terminal: 'KHALIFA_PORT', delivery_area: null }; // Abu Dhabi

  const result = await evaluateCompliance(driver, vehicle, job, profile);
  assert.equal(result.pass, true);
  assert.ok(result.warnings.some((w) => w.rule_code === 'OUTSIDE_PERMITTED_EMIRATES'));
});
