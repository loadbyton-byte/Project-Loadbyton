// Commercial-logic audit / backend P0 backlog Phase 3 — bank-change payout
// hold. requireReauthIfIbanChanging (auth.routes.js) already stops a
// stolen-session-only attacker from redirecting a payout by changing the
// IBAN, but does nothing against a genuinely compromised account that
// passes re-auth as the real user. This closes that gap: PATCH /api/profile
// stamps profiles.iban_changed_at whenever the IBAN actually changes, and
// payout.service.js's executePayoutAsync defers any transfer to that
// carrier while inside the configured iban_change_hold_hours window.
//
// Runs against payout.service.js directly (not the HTTP harness), same
// isolated-private-SQLite-file pattern as payout-unknown-reconciliation.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const dbPath = path.join(os.tmpdir(), `loadbyton-test-iban-hold-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.USE_POSTGRES = 'false';
// isConfigured() gates executePayoutAsync's actual transfer on
// PAYMENTS_PROVIDER=stripe + STRIPE_SECRET_KEY — never used for a real
// network call here, every test below monkeypatches payments.executePayout
// itself first (same pattern as payout-unknown-reconciliation.test.js).
process.env.PAYMENTS_PROVIDER = 'stripe';
process.env.STRIPE_SECRET_KEY = 'sk_test_unused_in_this_test';

const db = require('../db');
const payments = require('../lib/payments');
const { executePayoutAsync } = require('../services/payout.service');

test.after(() => {
  try { fs.rmSync(dbPath, { force: true }); fs.rmSync(`${dbPath}-wal`, { force: true }); fs.rmSync(`${dbPath}-shm`, { force: true }); } catch {}
});

let seq = 0;
async function seedReleasedPayout({ ibanChangedAt } = {}) {
  seq += 1;
  const shipper = await db.prepare(`INSERT INTO users (email, password_hash, role) VALUES (?,?,?) RETURNING id`).run(`shipper-ibh-${seq}@test.local`, 'x', 'SHIPPER');
  const carrier = await db.prepare(`INSERT INTO users (email, password_hash, role) VALUES (?,?,?) RETURNING id`).run(`carrier-ibh-${seq}@test.local`, 'x', 'CARRIER');
  const carrierId = carrier.lastInsertRowid;
  await db.prepare(`INSERT INTO profiles (user_id, company_name, iban_changed_at) VALUES (?,?,?)`).run(carrierId, `Carrier ${seq}`, ibanChangedAt || null);
  const job = await db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, status)
     VALUES (?,?,?, '20FT','DRY','JEBEL_ALI_T1','AL_QUOZ','Test address', datetime('now'), datetime('now','+2 days'), 'DELIVERED') RETURNING id`
  ).run(`LB-IBH-${seq}`, shipper.lastInsertRowid, carrierId);
  const jobId = job.lastInsertRowid;
  const payout = await db.prepare(
    `INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, released_at) VALUES (?,?,?,?,?, 'RELEASED', datetime('now')) RETURNING id`
  ).run(jobId, carrierId, 1000, 100, 900);
  const jobRow = await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  const payoutRow = await db.prepare('SELECT * FROM payouts WHERE id=?').get(payout.lastInsertRowid);
  return { job: jobRow, payout: payoutRow, carrierId };
}

test('a payout to a carrier whose IBAN changed within the hold window is deferred, not transferred', async () => {
  const { job, payout } = await seedReleasedPayout({ ibanChangedAt: new Date().toISOString() });
  const originalExecutePayout = payments.executePayout;
  let providerCalled = false;
  payments.executePayout = async () => { providerCalled = true; return { ok: true, payoutRef: 'tr_should_not_happen', provider: 'stripe' }; };
  try {
    await executePayoutAsync(job, payout, null);
  } finally {
    payments.executePayout = originalExecutePayout;
  }
  assert.equal(providerCalled, false, 'the payment provider must never be called while inside the hold window');
  const attempt = await db.prepare('SELECT * FROM payout_attempts WHERE payout_id=?').get(payout.id);
  assert.equal(attempt, undefined, 'no attempt should even be recorded while held');
  const heldEntry = await db.prepare(`SELECT * FROM audit_log WHERE entity_type='payout' AND entity_id=? AND action='PAYOUT_HELD_IBAN_CHANGE'`).get(payout.id);
  assert.ok(heldEntry, 'the hold must be recorded in the audit log so an admin can see why nothing happened');
});

test('a payout to a carrier whose IBAN changed before the hold window proceeds normally', async () => {
  const longAgo = new Date(Date.now() - 100 * 3600 * 1000).toISOString(); // 100h ago, past the 72h default
  const { job, payout } = await seedReleasedPayout({ ibanChangedAt: longAgo });
  const originalExecutePayout = payments.executePayout;
  payments.executePayout = async () => ({ ok: true, payoutRef: 'tr_ok_789', provider: 'stripe' });
  try {
    await executePayoutAsync(job, payout, null);
  } finally {
    payments.executePayout = originalExecutePayout;
  }
  const finalPayout = await db.prepare('SELECT * FROM payouts WHERE id=?').get(payout.id);
  assert.ok(finalPayout.transfer_executed_at, 'a payout past the hold window must actually transfer');
});

test('a payout to a carrier who never changed their IBAN is unaffected', async () => {
  const { job, payout } = await seedReleasedPayout({ ibanChangedAt: null });
  const originalExecutePayout = payments.executePayout;
  payments.executePayout = async () => ({ ok: true, payoutRef: 'tr_ok_no_change', provider: 'stripe' });
  try {
    await executePayoutAsync(job, payout, null);
  } finally {
    payments.executePayout = originalExecutePayout;
  }
  const finalPayout = await db.prepare('SELECT * FROM payouts WHERE id=?').get(payout.id);
  assert.ok(finalPayout.transfer_executed_at, 'a carrier who never changed their IBAN must not be held');
});
