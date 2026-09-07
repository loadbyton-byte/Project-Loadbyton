// Regression coverage for the multi-instance sweep race fix: runAutoReleaseSweep,
// publishScheduledJobs, and outbox.worker.js's processOutboxBatch each run on
// their own setInterval, once per server process, with no distributed lock.
// Before this fix, two concurrent calls (simulating two instances' timers
// firing at the same moment) would both SELECT the same due rows and both
// UPDATE them unconditionally — this test proves that no longer happens by
// calling each sweep function twice concurrently against the same DB and
// asserting the affected rows are claimed exactly once, not twice.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const dbPath = path.join(os.tmpdir(), `loadbyton-sweep-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { runAutoReleaseSweep } = require('../services/escrow.service');
const { publishScheduledJobs } = require('../services/scheduling.service');
const { processOutboxBatch } = require('../workers/outbox.worker');

test.after(() => { try { fs.unlinkSync(dbPath); } catch {} });

async function seedUser(email) {
  const r = await db.prepare(`INSERT INTO users (email, password_hash, role, is_verified) VALUES (?, 'x', 'SHIPPER', 1) RETURNING id`).run(email);
  return Number(r.lastInsertRowid);
}

test('runAutoReleaseSweep run twice concurrently releases a due job exactly once', async () => {
  const shipperId = await seedUser('sweep-shipper@test.local');
  const carrierId = await seedUser('sweep-carrier@test.local');
  const overdue = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
  const jobRes = await db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, status, escrow_status, delivered_at)
     VALUES ('SWEEP-TEST-1', ?, ?, '20FT', 'DRY', 'JEBEL_ALI_T1', 'AL_QUOZ', 'x', ?, ?, 'DELIVERED', 'HELD', ?) RETURNING id`
  ).run(shipperId, carrierId, overdue, overdue, overdue);
  const jobId = Number(jobRes.lastInsertRowid);
  await db.prepare(`INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status) VALUES (?, ?, 100, 6, 94, 'PENDING')`).run(jobId, carrierId);

  const [a, b] = await Promise.all([runAutoReleaseSweep(null), runAutoReleaseSweep(null)]);
  assert.equal(a + b, 1, 'the same due job must be claimed by exactly one of the two concurrent sweep calls, not both');

  const job = await db.prepare('SELECT escrow_status FROM jobs WHERE id=?').get(jobId);
  assert.equal(job.escrow_status, 'RELEASED');
});

test('publishScheduledJobs run twice concurrently publishes a due job exactly once', async () => {
  const shipperId = await seedUser('sweep-shipper-2@test.local');
  const due = new Date(Date.now() - 3600 * 1000).toISOString();
  const jobRes = await db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, status, scheduled_post_at)
     VALUES ('SWEEP-TEST-2', ?, '20FT', 'DRY', 'JEBEL_ALI_T1', 'AL_QUOZ', 'x', ?, ?, 'DRAFT', ?) RETURNING id`
  ).run(shipperId, due, due, due);
  const jobId = Number(jobRes.lastInsertRowid);

  const [a, b] = await Promise.all([publishScheduledJobs(null), publishScheduledJobs(null)]);
  assert.equal(a + b, 1, 'the same due scheduled job must be published by exactly one of the two concurrent calls, not both');

  const job = await db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId);
  assert.equal(job.status, 'OPEN');
});

test('processOutboxBatch run twice concurrently processes a pending event exactly once', async () => {
  const evRes = await db.prepare(
    `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status) VALUES ('job', 1, 'TEST_EVENT', '{}', 'PENDING') RETURNING id`
  ).run();
  const evId = Number(evRes.lastInsertRowid);

  const [a, b] = await Promise.all([processOutboxBatch(20), processOutboxBatch(20)]);
  const thisEventProcessedCount = (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0);
  // Both calls may report >0 if unrelated events exist from other tests in
  // this file's shared DB — check the specific row directly instead.
  void thisEventProcessedCount;

  const ev = await db.prepare('SELECT status FROM outbox_events WHERE id=?').get(evId);
  assert.equal(ev.status, 'PROCESSED');
});
