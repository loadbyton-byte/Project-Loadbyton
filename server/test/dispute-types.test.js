// Coverage for the 7-bucket dispute type system and the real SPLIT fix
// (planning register Change 26). SPLIT was previously accepted as a valid
// decision value but fell through to the exact same full-release-to-
// carrier code path as RELEASE_TO_CARRIER — this proves it's fixed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeClient } = require('./harness');

let server;
let admin;

test.before(async () => {
  server = await startServer();
  admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
});

test.after(async () => {
  await server.stop();
});

async function fullyDeliveredJob(shipper, carrier) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — dispute type regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 1000,
  });
  const jobId = created.body.job.id;
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 1000, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  const admin0 = makeClient(server.baseUrl);
  await admin0.login('admin@loadbyton.ae', 'demo1234');
  await admin0.post('/api/admin/confirm-receipt', { jobId });
  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Test Driver', driverPhone: '0551230077' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  await carrier.post(`/api/jobs/${jobId}/pod`, {});
  return jobId;
}

test('filing a dispute requires a valid disputeType', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const jobId = await fullyDeliveredJob(shipper, carrier);

  const noType = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'price disagreement' });
  assert.equal(noType.status, 400, 'a dispute with no disputeType must be rejected');

  const badType = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'price disagreement', disputeType: 'NOT_A_REAL_TYPE' });
  assert.equal(badType.status, 400);

  const valid = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'price disagreement', disputeType: 'PRICE' });
  assert.equal(valid.status, 201, valid.raw);
  assert.equal(valid.body.dispute.dispute_type, 'PRICE');
  assert.ok(valid.body.dispute.sla_deadline, 'sla_deadline must be set at filing time');
});

test('DAMAGE_SHORTAGE requires an EIR photo to already exist; NO_SHOW requires a location log', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const jobId = await fullyDeliveredJob(shipper, carrier);

  const noEvidence = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'container arrived damaged', disputeType: 'DAMAGE_SHORTAGE' });
  assert.equal(noEvidence.status, 400, 'DAMAGE_SHORTAGE must be rejected with no EIR photo on file');

  const noShowNoEvidence = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'truck never showed up', disputeType: 'NO_SHOW' });
  assert.equal(noShowNoEvidence.status, 400, 'NO_SHOW must be rejected with no location log on file');
});

test('SPLIT resolves with a real proportional refund/payout, not a full release', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const jobId = await fullyDeliveredJob(shipper, carrier);

  // PRICE has no filing-time evidence gate (unlike DAMAGE_SHORTAGE/NO_SHOW,
  // already covered above) — used here so this test stays focused on the
  // SPLIT resolution math, not evidence-gate setup.
  const dispute = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'shared fault — some damage, some pre-existing wear', disputeType: 'PRICE' });
  assert.equal(dispute.status, 201, dispute.raw);
  const disputeId = dispute.body.dispute.id;

  const badSplit = await admin.post(`/api/admin/disputes/${disputeId}/resolve`, { decision: 'SPLIT', determination: 'shared fault' });
  assert.equal(badSplit.status, 400, 'SPLIT must require splitShipperPct/splitCarrierPct summing to 100');

  const resolve = await admin.post(`/api/admin/disputes/${disputeId}/resolve`, {
    decision: 'SPLIT', determination: 'shared fault — 60/40', splitShipperPct: 60, splitCarrierPct: 40,
  });
  assert.equal(resolve.status, 200, resolve.raw);

  const invoices = await carrier.get('/api/invoices');
  const invoice = invoices.body.invoices.find((i) => i.job_id === jobId);
  assert.ok(invoice, 'an invoice must still be issued for the carrier\'s (partial) payout');
  // Carrier's gross portion should be 40% of the 1000 AED agreed price =
  // 400 AED, not the full 1000 a broken SPLIT would silently release.
  assert.equal(invoice.gross_aed, 400, 'the carrier\'s payout must reflect only their 40% split, not the full price');
});

// Financial-audit finding: two admins resolving the same dispute
// concurrently with CONFLICTING decisions (one REFUND_SHIPPER, one
// RELEASE_TO_CARRIER) both used to pass their own stale pre-transaction
// read of dispute.status='OPEN' and both execute — a real double
// money-movement (both a refund to the shipper AND a payout to the
// carrier for the same job). Fixed with a SELECT ... FOR UPDATE + fresh
// status re-check inside resolveDisputeCore's own transaction
// (server/lib/adminActions.js) — not relying on the caller's own
// pre-transaction read, which can't see a concurrent commit that
// happens in between.
//
// Testing genuine wall-clock concurrency across two HTTP requests isn't
// reliable here: the harness spawns the server as a separate child
// process (a black box over HTTP), and in practice one request's entire
// check-to-commit chain often finishes before the other's outer check
// even runs, since none of the intervening calls hit real async I/O —
// which would make a naive two-HTTP-requests-in-parallel test pass even
// WITHOUT this fix (verified: it did, when first tried). Instead this
// calls resolveDisputeCore directly, deterministically simulating the
// exact race window: a second call arrives carrying a `dispute` snapshot
// that still says OPEN (read before the first call started) — real
// concurrent callers would each have exactly this stale snapshot. This
// isolates the one thing that changed (the fresh in-transaction
// re-check) rather than depending on timing luck.
//
// IMPORTANT: sets DB_PATH before requiring server modules so this
// process's own `require('../db')` connects to the SAME throwaway
// database the spawned server child process is using, not the real dev
// DB at server/data/loadbyton.db (confirmed this matters: an earlier,
// wrong version of this test connected to the real dev DB, since Node
// caches `require('../db')` against whatever DB_PATH was set --- or
// unset --- the first time it's required in this process).
test('resolveDisputeCore: a second call carrying a stale "still OPEN" snapshot is refused, not a double money-movement', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const jobId = await fullyDeliveredJob(shipper, carrier);

  const dispute = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'concurrent resolution race test', disputeType: 'PRICE' });
  assert.equal(dispute.status, 201, dispute.raw);

  process.env.DB_PATH = server.dbPath;
  const { DatabaseSync } = require('node:sqlite');
  const readDb = new DatabaseSync(server.dbPath);
  // This snapshot is taken once, while the dispute is still OPEN, and
  // reused for BOTH calls below — exactly what two concurrent callers
  // would each be holding, having both read the row before either one
  // started resolving.
  const staleDisputeSnapshot = readDb.prepare('SELECT * FROM disputes WHERE id=?').get(dispute.body.dispute.id);
  const jobRow = readDb.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  readDb.close();
  assert.equal(staleDisputeSnapshot.status, 'OPEN');

  const { resolveDisputeCore } = require('../lib/adminActions');
  const fakeReq = { requestId: 'test' };

  await resolveDisputeCore(fakeReq, { dispute: staleDisputeSnapshot, job: jobRow, determination: 'first resolver wins', decision: 'REFUND_SHIPPER', resolvedByUserId: 1 });

  // Second call reuses the SAME stale snapshot (still status='OPEN' as
  // far as this caller knows) with a CONFLICTING decision — if the fix
  // weren't there, this would execute a second, real RELEASE_TO_CARRIER
  // payout on top of the refund that already happened above.
  await assert.rejects(
    () => resolveDisputeCore(fakeReq, { dispute: staleDisputeSnapshot, job: jobRow, determination: 'second resolver, stale view', decision: 'RELEASE_TO_CARRIER', resolvedByUserId: 6 }),
    /no longer open/i,
    'a second resolveDisputeCore call on an already-resolved dispute must be refused even if its own snapshot still says OPEN'
  );

  // The payout must reflect ONLY the first (winning) decision — never a
  // state where both a refund and a release happened (which would mean
  // the platform paid the carrier AND refunded the shipper for the same
  // job).
  const db = new DatabaseSync(server.dbPath);
  const payout = db.prepare('SELECT status FROM payouts WHERE job_id=?').get(jobId);
  const finalDispute = db.prepare('SELECT status, decision FROM disputes WHERE id=?').get(dispute.body.dispute.id);
  db.close();
  assert.equal(finalDispute.status, 'RESOLVED');
  assert.equal(finalDispute.decision, 'REFUND_SHIPPER', 'the first call\'s decision must be the one that stuck');
  assert.equal(payout.status, 'CANCELLED', 'the payout must reflect only the REFUND_SHIPPER outcome, not also get RELEASED');
});
