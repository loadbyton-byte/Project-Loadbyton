// Coverage for the new shipment_events ledger (server/schema.js,
// server/migrations/postgres_init.sql, recordShipmentEvent in
// server/lib/helpers.js) — Phase 1 of the 67-scenario architecture review's
// P0 backlog. Two things must hold, mirroring audit_log's already-proven
// pattern exactly: append-only (DB trigger blocks UPDATE/DELETE) and a
// verifiable hash chain. A third test drives a full real job lifecycle over
// HTTP (harness.js) and confirms the ~7 wired call sites actually fire, in
// the right order, for a real client — not just that recordShipmentEvent()
// works in isolation.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const dbPath = path.join(os.tmpdir(), `loadbyton-shipment-events-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { recordShipmentEvent } = require('../lib/helpers');

test.after(() => { try { fs.unlinkSync(dbPath); } catch {} });

async function seedJob() {
  const shipperRes = await db.prepare(`INSERT INTO users (email, password_hash, role, is_verified) VALUES (?, 'x', 'SHIPPER', 1) RETURNING id`).run(`se-shipper-${Date.now()}-${Math.random()}@test.local`);
  const shipperId = Number(shipperRes.lastInsertRowid);
  const jobRes = await db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, status, escrow_status)
     VALUES (?, ?, '20FT', 'DRY', 'JEBEL_ALI_T1', 'AL_QUOZ', 'x', datetime('now'), datetime('now','+1 day'), 'OPEN', 'PENDING') RETURNING id`
  ).run(`SE-TEST-${Date.now()}-${Math.floor(Math.random() * 100000)}`, shipperId);
  return { jobId: Number(jobRes.lastInsertRowid), shipperId };
}

test('shipment_events is append-only: UPDATE and DELETE are both rejected', async () => {
  const { jobId } = await seedJob();
  await recordShipmentEvent(jobId, { eventType: 'STATUS_CHANGE', summary: 'test event', actorRole: 'SYSTEM' });
  const row = await db.prepare('SELECT id FROM shipment_events WHERE job_id=?').get(jobId);
  assert.ok(row, 'the event must have actually been inserted');

  // Wrapped in an async arrow (not passed as a bare function reference):
  // db.prepare()/.run() throws synchronously on this driver, and
  // assert.rejects only catches a genuine promise rejection — a bare
  // synchronous throw would escape as an uncaught exception instead of a
  // clean assertion failure.
  await assert.rejects(
    async () => { await db.prepare(`UPDATE shipment_events SET summary='tampered' WHERE id=?`).run(row.id); },
    /append-only/i,
    'UPDATE on shipment_events must be rejected by the DB trigger'
  );
  await assert.rejects(
    async () => { await db.prepare(`DELETE FROM shipment_events WHERE id=?`).run(row.id); },
    /append-only/i,
    'DELETE on shipment_events must be rejected by the DB trigger'
  );
});

test('shipment_events hash-chains sequentially: each row\'s prev_hash matches the previous row\'s hash', async () => {
  const { jobId } = await seedJob();
  await recordShipmentEvent(jobId, { eventType: 'STATUS_CHANGE', summary: 'first', actorRole: 'SYSTEM' });
  await recordShipmentEvent(jobId, { eventType: 'STATUS_CHANGE', summary: 'second', actorRole: 'SYSTEM' });
  await recordShipmentEvent(jobId, { eventType: 'STATUS_CHANGE', summary: 'third', actorRole: 'SYSTEM' });

  const rows = await db.prepare('SELECT id, prev_hash, hash FROM shipment_events ORDER BY id').all();
  assert.ok(rows.length >= 3, 'expected at least the 3 events just recorded');
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].hash, `row ${rows[i].id} must have a hash`);
    assert.equal(rows[i].prev_hash, rows[i - 1].hash, `row ${rows[i].id}'s prev_hash must equal the immediately preceding row's hash`);
  }
});

test('a full job lifecycle over real HTTP records the expected ordered event_type sequence', async (t) => {
  const { startServer, makeClient } = require('./harness');
  const server = await startServer();
  t.after(async () => { await server.stop(); });

  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — shipment_events lifecycle regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 1000,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 1000, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(bid.status, 201, bid.raw);
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);
  await admin.post('/api/admin/confirm-receipt', { jobId });
  const driverAssign = await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Test Driver', driverPhone: '0551230077' });
  assert.equal(driverAssign.status, 200, driverAssign.raw);
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  const pod = await carrier.post(`/api/jobs/${jobId}/pod`, {});
  assert.equal(pod.status, 200, pod.raw);

  const dispute = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'shipment_events regression', disputeType: 'PRICE' });
  assert.equal(dispute.status, 201, dispute.raw);
  const resolve = await admin.post(`/api/admin/disputes/${dispute.body.dispute.id}/resolve`, { decision: 'RELEASE_TO_CARRIER', determination: 'test resolution' });
  assert.equal(resolve.status, 200, resolve.raw);

  process.env.DB_PATH = server.dbPath;
  const { DatabaseSync } = require('node:sqlite');
  const readDb = new DatabaseSync(server.dbPath);
  const events = readDb.prepare('SELECT event_type FROM shipment_events WHERE job_id=? ORDER BY id').all(jobId).map((r) => r.event_type);
  readDb.close();

  // Exact order the wired call sites fire in, for this exact flow: award ->
  // driver assign -> 2 status changes (PICKED_UP, IN_TRANSIT, both via the
  // same STATUS_CHANGE event_type) -> POD -> dispute open -> dispute
  // resolve. NOT asserting PAYOUT_RELEASED here: resolveDisputeCore's
  // executePayoutAsync call is deliberately fire-and-forget (not awaited by
  // the HTTP handler — adminActions.js's own comments explain why), so it
  // may not have landed by the time this POST /resolve response returns.
  // That call site's own correctness is a payout.service.js concern, not
  // this lifecycle-ordering test's — asserting on a genuine race would make
  // this test flaky for no real coverage gain. Also note this flow never
  // reaches jobs.status='COMPLETED' via job.service.js's updateJobStatus()
  // (adminActions.js sets it directly, its own SQL, inside the dispute
  // transaction) — correctly no extra STATUS_CHANGE event from that.
  assert.deepEqual(events, [
    'BID_AWARDED',
    'DRIVER_ASSIGNED',
    'STATUS_CHANGE',
    'STATUS_CHANGE',
    'POD_SUBMITTED',
    'DISPUTE_OPENED',
    'DISPUTE_RESOLVED',
  ], `unexpected event_type sequence for the full lifecycle: ${JSON.stringify(events)}`);
});
