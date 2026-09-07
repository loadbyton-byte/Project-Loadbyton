// Coverage for the new jobs.payment_tier foundation (server/schema.js) and
// the money-before-move fix built alongside it (server/services/job.service.js's
// updateJobStatus). SPOT_ESCROW's existing behavior is covered by
// core-loop.test.js and payments.test.js — this file focuses on what's new:
// the PAY_ON_DELIVERY tier deferring escrow to the DELIVERED transition
// instead of AWARDED.

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
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id });
  assert.equal(award.status, 200, award.raw);
  return { jobId, award };
}

test('PAY_ON_DELIVERY: award does not escrow, pickup is never blocked, escrow becomes due at delivery instead', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const { jobId, award } = await postAndAwardJob(shipper, carrier, { paymentTier: 'PAY_ON_DELIVERY' });
  assert.equal(award.body.job.payment_tier, 'PAY_ON_DELIVERY');
  // Unlike SPOT_ESCROW, award must NOT put this job into HELD — nothing is
  // owed yet under this tier until delivery.
  assert.equal(award.body.job.escrow_status, 'PENDING', 'PAY_ON_DELIVERY must not escrow at award time');

  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Test Driver', driverPhone: '0551230000' });

  // The money-before-move gate must NOT apply to this tier — pickup
  // proceeds with zero payment confirmation, by design.
  const pickedUp = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(pickedUp.status, 200, pickedUp.raw);
  const inTransit = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  assert.equal(inTransit.status, 200, inTransit.raw);

  // Delivery is where payment actually becomes due for this tier.
  const pod = await carrier.post(`/api/jobs/${jobId}/pod`, {});
  assert.equal(pod.status, 200, pod.raw);
  assert.equal(pod.body.job.status, 'DELIVERED');
  assert.equal(pod.body.job.escrow_status, 'HELD', 'escrow becomes due (HELD) at delivery for PAY_ON_DELIVERY');
  assert.equal(pod.body.job.processor_payment_status, 'REQUIRES_PAYMENT');

  // The existing payment-checkout endpoint's status/escrow gate must now
  // accept this job despite its status being DELIVERED (not AWARDED,
  // which is the gate every other tier stays behind) — this default test
  // server runs in 'internal' mode (no processor configured), so the
  // request still fails, but specifically on PAYMENT_NOT_CONFIGURED, not
  // on the JOB_NOT_OPEN/ESCROW_NOT_HELD checks this fix relaxed. The
  // actual checkout-succeeds path (PAYMENTS_PROVIDER=mock) is already
  // covered end-to-end for SPOT_ESCROW in payments.test.js.
  const checkout = await shipper.post(`/api/jobs/${jobId}/payment-checkout`, {});
  assert.equal(checkout.status, 400);
  const checkoutBody = JSON.parse(checkout.raw);
  assert.equal(checkoutBody.error.code, 'PAYMENT_NOT_CONFIGURED', 'must pass the status/escrow gates and fail only on the (expected, in this test harness) missing processor config');
});

test('SPOT_ESCROW (default, unspecified tier) keeps escrowing at award — payment_tier foundation must not change existing behavior', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const { jobId, award } = await postAndAwardJob(shipper, carrier);
  assert.equal(award.body.job.payment_tier, 'SPOT_ESCROW');
  assert.equal(award.body.job.escrow_status, 'HELD');

  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Test Driver', driverPhone: '0551230001' });
  const blocked = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(blocked.status, 400, 'SPOT_ESCROW must still block pickup until FUNDED');
});
