// Coverage for equipment capacity tracking (planning register Change 3):
// available_units decrements on award, restores on delivery/cancellation,
// and a carrier can self-declare off-platform commitments.

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

async function postAndAwardJob(shipper, carrier, containerCount = 1) {
  const created = await shipper.post('/api/jobs', {
    shipmentType: 'IMPORT', containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — capacity regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 500, containerCount,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 450, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(bid.status, 201, bid.raw);
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id });
  assert.equal(award.status, 200, award.raw);
  return jobId;
}

test('award decrements available_units by the job\'s unit count; cancellation restores it', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const before = await carrier.get('/api/fleet/capacity');
  const startUnits = before.body.available_units;

  const jobId = await postAndAwardJob(shipper, carrier, 2);
  const afterAward = await carrier.get('/api/fleet/capacity');
  assert.equal(afterAward.body.available_units, startUnits - 2, 'available_units must decrement by the job\'s container_count');

  const cancelled = await shipper.patch(`/api/jobs/${jobId}/status`, { status: 'CANCELLED' });
  assert.equal(cancelled.status, 200, cancelled.raw);
  const afterCancel = await carrier.get('/api/fleet/capacity');
  assert.equal(afterCancel.body.available_units, startUnits, 'cancelling an awarded job must restore the units');
});

test('delivery restores available_units', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const before = await carrier.get('/api/fleet/capacity');
  const startUnits = before.body.available_units;
  const jobId = await postAndAwardJob(shipper, carrier, 1);

  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Test Driver', driverPhone: '0551230099' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  const pod = await carrier.post(`/api/jobs/${jobId}/pod`, {});
  assert.equal(pod.status, 200, pod.raw);

  const afterDelivery = await carrier.get('/api/fleet/capacity');
  assert.equal(afterDelivery.body.available_units, startUnits, 'delivery must restore the units held during transit');
});

test('a carrier can mark units externally engaged and release them; bidding at zero available units returns a warning, not a block', async () => {
  const carrier = makeClient(server.baseUrl);
  await carrier.login('falcon@containerxpress.ae', 'demo1234');
  const before = await carrier.get('/api/fleet/capacity');
  const startUnits = before.body.available_units;

  const engage = await carrier.post('/api/fleet/capacity/external-engage', { units: startUnits, note: 'Private client job' });
  assert.equal(engage.status, 200, engage.raw);
  assert.equal(engage.body.available_units, 0);
  assert.equal(engage.body.externally_engaged_units, startUnits);

  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — zero capacity regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 500,
  });
  const bid = await carrier.post(`/api/jobs/${created.body.job.id}/bids`, {
    amountAed: 450, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(bid.status, 201, 'bidding at zero available units must still succeed (warned, not blocked)');
  assert.equal(bid.body.warning, true);

  const release = await carrier.post('/api/fleet/capacity/release', { units: startUnits });
  assert.equal(release.status, 200, release.raw);
  assert.equal(release.body.available_units, startUnits);
  assert.equal(release.body.externally_engaged_units, 0);
});
