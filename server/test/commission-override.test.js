// Flexible per-account commission override (award.service.js's
// effectiveCommissionBps, routes/admin.routes.js's
// POST /api/admin/users/:userId/commission). Verifies: an admin-set
// carrier override actually changes the platform fee deducted at award
// (not just stored and ignored), carrier override wins over a shipper
// override when both are set, validation rejects bad input, and clearing
// an override falls back to the global default.
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

async function awardAndGetCommissionAed(shipper, carrier, adminClient, amountAed) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT',
    containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T2',
    deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'Commission override test warehouse',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: amountAed + 100,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const bidRes = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: '3-axle flatbed',
  });
  assert.equal(bidRes.status, 201, bidRes.raw);
  const bidId = bidRes.body.bid.id;

  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);

  const reassign = await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Test Driver', driverPhone: '0559998877' });
  assert.equal(reassign.status, 200, reassign.raw);

  const admin = await adminClient.post('/api/admin/confirm-receipt', { jobId });
  assert.equal(admin.status, 200, admin.raw);
  const pickedUp = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(pickedUp.status, 200, pickedUp.raw);
  const inTransit = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  assert.equal(inTransit.status, 200, inTransit.raw);
  const pod = await carrier.post(`/api/jobs/${jobId}/pod`, {});
  assert.equal(pod.status, 200, pod.raw);
  const completed = await shipper.patch(`/api/jobs/${jobId}/status`, { status: 'COMPLETED' });
  assert.equal(completed.status, 200, completed.raw);

  const invoices = await carrier.get('/api/invoices');
  const invoice = invoices.body.invoices.find((i) => i.job_id === jobId);
  assert.ok(invoice, 'expected an invoice for the completed job');
  return invoice.commission_aed;
}

test('an admin-set carrier commission override changes the platform fee actually deducted at award', async () => {
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');

  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  const carrierLogin = await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const carrierId = carrierLogin.body.user.id;

  // Baseline: no override, uses the global default (600 bps = 6%).
  const baselineFee = await awardAndGetCommissionAed(shipper, carrier, admin, 1000);
  assert.equal(baselineFee, Math.round((1000 * 600) / 10000), 'baseline award must use the global default commission rate');

  // Set a carrier override (250 bps = 2.5%) and confirm a new award actually uses it.
  const setOverride = await admin.post(`/api/admin/users/${carrierId}/commission`, { rateBps: 250 });
  assert.equal(setOverride.status, 200, setOverride.raw);
  const overriddenFee = await awardAndGetCommissionAed(shipper, carrier, admin, 1000);
  assert.equal(overriddenFee, Math.round((1000 * 250) / 10000), 'award must use the carrier-specific override rate, not the global default');

  // Clearing the override (null) must fall back to the global default again.
  const clearOverride = await admin.post(`/api/admin/users/${carrierId}/commission`, { rateBps: null });
  assert.equal(clearOverride.status, 200, clearOverride.raw);
  const clearedFee = await awardAndGetCommissionAed(shipper, carrier, admin, 1000);
  assert.equal(clearedFee, Math.round((1000 * 600) / 10000), 'clearing the override must fall back to the global default rate');
});

test('a carrier override takes precedence over a shipper override when both are set', async () => {
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');

  const shipper = makeClient(server.baseUrl);
  const shipperLogin = await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const shipperId = shipperLogin.body.user.id;
  const carrier = makeClient(server.baseUrl);
  const carrierLogin = await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const carrierId = carrierLogin.body.user.id;

  try {
    await admin.post(`/api/admin/users/${shipperId}/commission`, { rateBps: 900 });
    await admin.post(`/api/admin/users/${carrierId}/commission`, { rateBps: 100 });

    const fee = await awardAndGetCommissionAed(shipper, carrier, admin, 1000);
    assert.equal(fee, Math.round((1000 * 100) / 10000), 'the carrier override (100 bps) must win over the shipper override (900 bps)');
  } finally {
    await admin.post(`/api/admin/users/${shipperId}/commission`, { rateBps: null });
    await admin.post(`/api/admin/users/${carrierId}/commission`, { rateBps: null });
  }
});

test('commission override endpoint validates input and target role', async () => {
  const admin = makeClient(server.baseUrl);
  const adminLogin = await admin.login('admin@loadbyton.ae', 'demo1234');
  const adminId = adminLogin.body.user.id;
  const carrier = makeClient(server.baseUrl);
  const carrierLogin = await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const carrierId = carrierLogin.body.user.id;

  const tooHigh = await admin.post(`/api/admin/users/${carrierId}/commission`, { rateBps: 10001 });
  assert.equal(tooHigh.status, 400, tooHigh.raw);
  const negative = await admin.post(`/api/admin/users/${carrierId}/commission`, { rateBps: -1 });
  assert.equal(negative.status, 400, negative.raw);
  const onAdmin = await admin.post(`/api/admin/users/${adminId}/commission`, { rateBps: 500 });
  assert.equal(onAdmin.status, 400, 'commission overrides must not apply to ADMIN accounts');
  const missingUser = await admin.post(`/api/admin/users/999999/commission`, { rateBps: 500 });
  assert.equal(missingUser.status, 404);

  const nonAdmin = await carrier.post(`/api/admin/users/${carrierId}/commission`, { rateBps: 500 });
  assert.equal(nonAdmin.status, 403, 'only an admin may set a commission override');
});
