// A QA audit found lib/adminActions.js's dispute-SPLIT platform-fee
// computation missing the `* 100) / 100` cents-rounding its two sibling
// lines in the same function both use — it rounded the platform
// commission to the nearest whole AED instead of nearest fils, silently
// moving up to ~50 fils per resolution between the platform and the
// carrier's payout. Invisible to the existing SPLIT coverage
// (dispute-types.test.js), which only asserts the pre-commission gross
// split, never the post-commission net/fee. This uses a price/split
// combination specifically chosen so the bug is numerically observable:
// AED 999 at a 33/67 split, 6% commission (the seeded default) — gross =
// AED 329.67, fee = AED 19.7802, which a buggy whole-AED round would have
// reported as AED 20.00 instead of the correct AED 19.78.
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

test('dispute SPLIT rounds the platform fee to the nearest fils, not the nearest whole AED', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Split fee rounding test', readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(), maxBudgetAed: 999,
  });
  const jobId = created.body.job.id;
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, { acknowledgePaymentTerms: true, amountAed: 999, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  await admin.post('/api/admin/confirm-receipt', { jobId });
  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Split Test Driver', driverPhone: '0551119999' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  await carrier.post(`/api/jobs/${jobId}/pod`, {});

  const dispute = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'shared fault split-fee rounding test', disputeType: 'PRICE' });
  assert.equal(dispute.status, 201, dispute.raw);

  const resolve = await admin.post(`/api/admin/disputes/${dispute.body.dispute.id}/resolve`, {
    decision: 'SPLIT', determination: 'shared fault — 33/67', splitShipperPct: 33, splitCarrierPct: 67,
  });
  assert.equal(resolve.status, 200, resolve.raw);

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  const payout = db.prepare('SELECT gross_aed, platform_fee_aed, net_aed FROM payouts WHERE job_id=?').get(jobId);
  db.close();
  assert.ok(payout, 'a payout row must exist for this job');
  assert.equal(Number(payout.gross_aed), 669.33, 'carrier gross must be 67% of 999');
  assert.equal(Number(payout.platform_fee_aed), 40.16, 'platform fee must round to the nearest fils (669.33 * 6% = 40.1598 -> 40.16), not the nearest whole AED (40)');
  assert.ok(Math.abs(Number(payout.net_aed) - 629.17) < 0.001, `net must equal gross minus the correctly-rounded fee (got ${payout.net_aed})`);
});
