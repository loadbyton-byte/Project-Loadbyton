// Financial-audit finding: fuel_advances (server/routes/enterprise.routes.js
// POST /api/jobs/:id/fuel-advance — 20% of agreed price, instant) was never
// referenced anywhere in payout logic. A carrier could take an advance
// mid-job and still collect the FULL net payout at completion — a real
// double payment. Fixed in job.service.js's COMPLETED transition: the
// payout's net_aed is netted against any APPROVED advance for that job at
// the moment escrow is released.
//
// Also closes two adjacent gaps this surfaced: a fuel-advance request after
// the job is already settled (escrow RELEASED) would never be netted
// against anything, and the "already taken" check was a plain SELECT
// (a TOCTOU race), not a real DB constraint.

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

async function createAwardedJob(shipper, carrier, amountAed) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Fuel advance regression test',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(bid.status, 201, bid.raw);
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);
  return jobId;
}

async function completeJob(shipper, carrier, jobId) {
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
  const confirmed = await admin.post('/api/admin/confirm-receipt', { jobId });
  assert.equal(confirmed.status, 200, confirmed.raw);

  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Regression Driver', driverPhone: '+971501112233' });
  const pickedUp = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(pickedUp.status, 200, pickedUp.raw);
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  await carrier.post(`/api/jobs/${jobId}/pod`, {});
  const completed = await shipper.patch(`/api/jobs/${jobId}/status`, { status: 'COMPLETED' });
  assert.equal(completed.status, 200, completed.raw);
  return completed;
}

test('a fuel advance taken mid-job is deducted from the final payout, not paid twice', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  // amountAed=1000, default commission 6% -> gross payout net_aed would be 940 with no advance.
  const jobId = await createAwardedJob(shipper, carrier, 1000);

  const advance = await carrier.post(`/api/jobs/${jobId}/fuel-advance`, { type: 'FUEL' });
  assert.equal(advance.status, 200, advance.raw);
  assert.equal(advance.body.amount, 200, '20% of AED 1000 is AED 200');

  await completeJob(shipper, carrier, jobId);

  const payouts = await carrier.get('/api/earnings');
  const payout = payouts.body.payouts.find((p) => p.job_id === jobId);
  assert.ok(payout, 'payout row must exist');
  assert.equal(payout.gross_aed, 1000);
  assert.equal(payout.platform_fee_aed, 60, 'commission is unaffected by the advance');
  assert.equal(payout.net_aed, 740, 'net payout must be reduced by the AED 200 advance already taken (940 - 200)');
});

test('a job with no fuel advance pays out the full net amount, unaffected', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const jobId = await createAwardedJob(shipper, carrier, 1000);
  await completeJob(shipper, carrier, jobId);

  const payouts = await carrier.get('/api/earnings');
  const payout = payouts.body.payouts.find((p) => p.job_id === jobId);
  assert.equal(payout.net_aed, 940, 'no advance taken — net payout must be the full 1000 - 60 commission');
});

test('a second fuel-advance request for the same job is refused, even concurrently', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const jobId = await createAwardedJob(shipper, carrier, 1000);

  const first = await carrier.post(`/api/jobs/${jobId}/fuel-advance`, { type: 'FUEL' });
  assert.equal(first.status, 200, first.raw);

  const second = await carrier.post(`/api/jobs/${jobId}/fuel-advance`, { type: 'SALIK' });
  assert.equal(second.status, 400);
  assert.match(second.raw, /already taken/i);
});

test('a fuel advance cannot be requested once the job is already settled (escrow RELEASED)', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const jobId = await createAwardedJob(shipper, carrier, 1000);
  await completeJob(shipper, carrier, jobId);

  const lateAdvance = await carrier.post(`/api/jobs/${jobId}/fuel-advance`, { type: 'FUEL' });
  assert.equal(lateAdvance.status, 400);
  assert.match(lateAdvance.raw, /already settled/i);
});
