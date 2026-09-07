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
