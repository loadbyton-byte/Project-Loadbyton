// A QA audit found updateJobStatus() (services/job.service.js) gated
// ownership on `req.user.role === 'SHIPPER'`/`'CARRIER'` directly, instead
// of comparing job.shipper_id/carrier_id against the account's own id (the
// actual ownership boundary every other job route in this codebase uses
// correctly). FORWARDER and BROKER accounts are explicitly allowed to post
// and own a job as its shipper_id (middleware/auth.js's roleSatisfies
// lets them through auth(['SHIPPER'])), and OWNER_OPERATOR accounts own a
// job as its carrier_id the same way for auth(['CARRIER']) — but their
// req.user.role is literally 'FORWARDER'/'BROKER'/'OWNER_OPERATOR', not
// 'SHIPPER'/'CARRIER', so every single status transition on a job they
// legitimately own (cancel, confirm pickup, etc.) 403'd with "Not a
// participant on this job", even though they could post/award/bid on it
// just fine.
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

test('a FORWARDER account can cancel a job it owns as shipper — not blocked by the literal role check', async () => {
  const fwd = makeClient(server.baseUrl);
  await fwd.login('forwarder@gulfconnect.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const created = await fwd.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Forwarder role-alias status test', readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(), maxBudgetAed: 700,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, { acknowledgePaymentTerms: true, amountAed: 650, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  assert.equal(bid.status, 201, bid.raw);
  const award = await fwd.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);

  const cancel = await fwd.patch(`/api/jobs/${jobId}/status`, { status: 'CANCELLED' });
  assert.equal(cancel.status, 200, cancel.raw);
  assert.equal(cancel.body.job.status, 'CANCELLED');
  // Recorded as the SHIPPER-equivalent role, matching the web UI's
  // "Cancelled by shipper/carrier" wording and the existing SHIPPER-account
  // test coverage — not the literal 'FORWARDER' account role.
  assert.equal(cancel.body.job.cancelled_by_role, 'SHIPPER');
});

test('an OWNER_OPERATOR account can transition a job it owns as carrier — not blocked by the literal role check', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const owner = makeClient(server.baseUrl);
  await owner.login('owner@singletruck.ae', 'demo1234');
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Owner-operator role-alias status test', readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(), maxBudgetAed: 700,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const bid = await owner.post(`/api/jobs/${jobId}/bids`, { acknowledgePaymentTerms: true, amountAed: 650, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' });
  assert.equal(bid.status, 201, bid.raw);
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);
  await admin.post('/api/admin/confirm-receipt', { jobId });
  const driverPatch = await owner.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Owner Driver', driverPhone: '0551234567' });
  assert.equal(driverPatch.status, 200, driverPatch.raw);

  const pickedUp = await owner.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(pickedUp.status, 200, pickedUp.raw);
  assert.equal(pickedUp.body.job.status, 'PICKED_UP');
});
