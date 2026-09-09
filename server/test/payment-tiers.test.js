// Coverage for the jobs.payment_tier foundation (server/schema.js) and the
// money-before-move gate built alongside it (server/services/job.service.js's
// updateJobStatus). INSTANT's happy-path behavior is covered by
// core-loop.test.js and payments.test.js — this file focuses on: an
// unrecognized/retired tier value (e.g. the old PAY_ON_DELIVERY, no longer
// a selectable option) normalizing to INSTANT rather than being stored
// verbatim or rejected, and INSTANT's own escrow/pickup-gate behavior.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeClient } = require('./harness');

let server;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.stop();
});

async function postAndAwardJob(shipper, carrier, overrides = {}) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT',
    containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T1',
    deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — payment tier regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 500,
    ...overrides,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 450, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(bid.status, 201, bid.raw);
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);
  return { jobId, award };
}

test('an unrecognized/retired payment tier (e.g. the old PAY_ON_DELIVERY) normalizes to INSTANT, not stored verbatim', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const { jobId, award } = await postAndAwardJob(shipper, carrier, { paymentTier: 'PAY_ON_DELIVERY' });
  assert.equal(award.body.job.payment_tier, 'INSTANT', 'a retired/unrecognized tier value must normalize to INSTANT, not be stored as-is');
  // INSTANT's real mechanics apply — escrow HELD at award, pickup gated
  // on FUNDED.
  assert.equal(award.body.job.escrow_status, 'HELD');
  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Test Driver', driverPhone: '0551230000' });
  const blocked = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(blocked.status, 400, 'normalized-to-INSTANT job must still block pickup until FUNDED');
});

test('INSTANT (default, unspecified tier) keeps escrowing at award — payment_tier foundation must not change existing behavior', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const { jobId, award } = await postAndAwardJob(shipper, carrier);
  assert.equal(award.body.job.payment_tier, 'INSTANT');
  assert.equal(award.body.job.escrow_status, 'HELD');

  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Test Driver', driverPhone: '0551230001' });
  const blocked = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(blocked.status, 400, 'INSTANT must still block pickup until FUNDED');
});
