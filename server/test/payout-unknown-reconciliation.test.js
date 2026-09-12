// Financial-audit finding (P0): payments.executePayout()'s Stripe path had
// no idempotency key at all, and any network/transport failure calling the
// provider (timeout, connection reset) was labeled the exact same 'FAILED'
// as a clean rejection. FAILED is a signal to future callers that a fresh
// attempt (a NEW idempotency key) is safe — it is not, when the failure was
// ambiguous: the original request may have already reached the provider
// and created a real transfer. A retry with a new key would then create a
// SECOND, real, distinct transfer — a genuine double payout.
//
// Fixed: payments.js now returns {ambiguous:true} for a provider-call
// throw (vs. a clean {ok:false} rejection), payout.service.js records that
// as attempt status 'UNKNOWN' (not 'FAILED') and refuses to start any new
// attempt for that payout until reconcilePayoutAttempt() resolves it — by
// re-sending the SAME idempotency key, which Stripe's own idempotency
// layer makes safe to repeat any number of times.
//
// This test runs against payout.service.js and lib/payments.js directly
// (not through the HTTP harness, which spawns a real child process and
// can't be monkeypatched from here) — DB_PATH is pointed at a private temp
// SQLite file before requiring ../db, so this file's schema/data never
// touches server/data/loadbyton.db or any other test file's DB.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const dbPath = path.join(os.tmpdir(), `loadbyton-test-payout-unknown-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.USE_POSTGRES = 'false';
// isConfigured() gates executePayoutAsync on PAYMENTS_PROVIDER=stripe +
// STRIPE_SECRET_KEY being set — the key is never actually used for a real
// network call here, since every test below monkeypatches
// payments.executePayout itself before it would reach the Stripe SDK.
process.env.PAYMENTS_PROVIDER = 'stripe';
process.env.STRIPE_SECRET_KEY = 'sk_test_unused_in_this_test';

const db = require('../db');
const payments = require('../lib/payments');
const { executePayoutAsync, reconcilePayoutAttempt } = require('../services/payout.service');

test.after(() => {
  try { fs.rmSync(dbPath, { force: true }); fs.rmSync(`${dbPath}-wal`, { force: true }); fs.rmSync(`${dbPath}-shm`, { force: true }); } catch {}
});

let seq = 0;
async function seedReleasedPayout() {
  seq += 1;
  const shipper = await db.prepare(`INSERT INTO users (email, password_hash, role) VALUES (?,?,?) RETURNING id`).run(`shipper-unk-${seq}@test.local`, 'x', 'SHIPPER');
  const carrier = await db.prepare(`INSERT INTO users (email, password_hash, role) VALUES (?,?,?) RETURNING id`).run(`carrier-unk-${seq}@test.local`, 'x', 'CARRIER');
  const carrierId = carrier.lastInsertRowid;
  const job = await db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, status)
     VALUES (?,?,?, '20FT','DRY','JEBEL_ALI_T1','AL_QUOZ','Test address', datetime('now'), datetime('now','+2 days'), 'DELIVERED') RETURNING id`
  ).run(`LB-UNK-${seq}`, shipper.lastInsertRowid, carrierId);
  const jobId = job.lastInsertRowid;
  const payout = await db.prepare(
    `INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status, released_at) VALUES (?,?,?,?,?, 'RELEASED', datetime('now')) RETURNING id`
  ).run(jobId, carrierId, 1000, 100, 900);
  const jobRow = await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  const payoutRow = await db.prepare('SELECT * FROM payouts WHERE id=?').get(payout.lastInsertRowid);
  return { job: jobRow, payout: payoutRow };
}

test('a provider network error is recorded as UNKNOWN, never FAILED', async () => {
  const { job, payout } = await seedReleasedPayout();
  const originalExecutePayout = payments.executePayout;
  payments.executePayout = async () => ({ ok: false, error: 'network_error', detail: 'simulated timeout', provider: 'stripe', ambiguous: true });
  try {
    await executePayoutAsync(job, payout, null);
  } finally {
    payments.executePayout = originalExecutePayout;
  }
  const attempt = await db.prepare('SELECT * FROM payout_attempts WHERE payout_id=?').get(payout.id);
  assert.equal(attempt.status, 'UNKNOWN', 'ambiguous provider failure must be UNKNOWN, not FAILED');
  const updatedPayout = await db.prepare('SELECT * FROM payouts WHERE id=?').get(payout.id);
  assert.equal(updatedPayout.transfer_executed_at, null);
});

test('a payout stuck UNKNOWN refuses a new attempt (no fresh idempotency key issued)', async () => {
  const { job, payout } = await seedReleasedPayout();
  const originalExecutePayout = payments.executePayout;
  let callCount = 0;
  payments.executePayout = async () => {
    callCount += 1;
    return { ok: false, error: 'network_error', detail: 'simulated timeout', provider: 'stripe', ambiguous: true };
  };
  try {
    await executePayoutAsync(job, payout, null); // first attempt -> UNKNOWN
    await executePayoutAsync(job, payout, null); // second call must NOT create attempt #2
  } finally {
    payments.executePayout = originalExecutePayout;
  }
  assert.equal(callCount, 1, 'a second call while UNKNOWN must never reach the provider again');
  const attempts = await db.prepare('SELECT * FROM payout_attempts WHERE payout_id=?').all(payout.id);
  assert.equal(attempts.length, 1, 'exactly one attempt must exist while unresolved');
});

test('reconcilePayoutAttempt re-sends the SAME idempotency key, not a new one', async () => {
  const { job, payout } = await seedReleasedPayout();
  const originalExecutePayout = payments.executePayout;
  payments.executePayout = async () => ({ ok: false, error: 'network_error', detail: 'simulated timeout', provider: 'stripe', ambiguous: true });
  await executePayoutAsync(job, payout, null);
  payments.executePayout = originalExecutePayout;

  const unknownAttempt = await db.prepare(`SELECT * FROM payout_attempts WHERE payout_id=? AND status='UNKNOWN'`).get(payout.id);
  assert.ok(unknownAttempt, 'setup must leave one UNKNOWN attempt');

  let seenKey = null;
  payments.executePayout = async ({ idempotencyKey }) => {
    seenKey = idempotencyKey;
    return { ok: true, payoutRef: 'tr_reconciled_123', provider: 'stripe' };
  };
  try {
    const result = await reconcilePayoutAttempt(unknownAttempt.id, null);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'SUBMITTED');
    assert.equal(seenKey, unknownAttempt.idempotency_key, 'reconciliation must reuse the original attempt\'s key, never mint a new one');
  } finally {
    payments.executePayout = originalExecutePayout;
  }

  const settledAttempt = await db.prepare('SELECT * FROM payout_attempts WHERE id=?').get(unknownAttempt.id);
  assert.equal(settledAttempt.status, 'SUBMITTED');
  const settledPayout = await db.prepare('SELECT * FROM payouts WHERE id=?').get(payout.id);
  assert.ok(settledPayout.transfer_executed_at, 'a reconciled success must settle the payout exactly like an immediate one');

  // A payout that's already settled must not be picked up for another attempt.
  const attemptsAfter = await db.prepare('SELECT * FROM payout_attempts WHERE payout_id=?').all(payout.id);
  assert.equal(attemptsAfter.length, 1);
});

test('reconcilePayoutAttempt that is itself still ambiguous stays UNKNOWN, never guesses', async () => {
  const { job, payout } = await seedReleasedPayout();
  const originalExecutePayout = payments.executePayout;
  payments.executePayout = async () => ({ ok: false, error: 'network_error', detail: 'still down', provider: 'stripe', ambiguous: true });
  await executePayoutAsync(job, payout, null);
  const unknownAttempt = await db.prepare(`SELECT * FROM payout_attempts WHERE payout_id=? AND status='UNKNOWN'`).get(payout.id);

  const result = await reconcilePayoutAttempt(unknownAttempt.id, null);
  payments.executePayout = originalExecutePayout;

  assert.equal(result.resolved, false);
  assert.equal(result.status, 'UNKNOWN');
  const stillUnknown = await db.prepare('SELECT * FROM payout_attempts WHERE id=?').get(unknownAttempt.id);
  assert.equal(stillUnknown.status, 'UNKNOWN');
});

test('reconcilePayoutAttempt that gets a clean rejection marks FAILED and unblocks retry', async () => {
  const { job, payout } = await seedReleasedPayout();
  const originalExecutePayout = payments.executePayout;
  payments.executePayout = async () => ({ ok: false, error: 'network_error', detail: 'timeout', provider: 'stripe', ambiguous: true });
  await executePayoutAsync(job, payout, null);
  const unknownAttempt = await db.prepare(`SELECT * FROM payout_attempts WHERE payout_id=? AND status='UNKNOWN'`).get(payout.id);

  payments.executePayout = async () => ({ ok: false, error: 'stripe_transfer_failed', detail: 'destination account no longer valid', provider: 'stripe' });
  const result = await reconcilePayoutAttempt(unknownAttempt.id, null);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'FAILED');

  // Now a fresh attempt must be allowed again.
  let secondCallKey = null;
  payments.executePayout = async ({ idempotencyKey }) => {
    secondCallKey = idempotencyKey;
    return { ok: true, payoutRef: 'tr_retry_456', provider: 'stripe' };
  };
  try {
    await executePayoutAsync(job, payout, null);
  } finally {
    payments.executePayout = originalExecutePayout;
  }
  assert.notEqual(secondCallKey, unknownAttempt.idempotency_key, 'a genuinely-failed attempt must get a fresh idempotency key on retry');
  const finalPayout = await db.prepare('SELECT * FROM payouts WHERE id=?').get(payout.id);
  assert.ok(finalPayout.transfer_executed_at);
});
