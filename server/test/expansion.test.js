// Phase 8: GCC countries/corridors, multi-stop itinerary, lane-rate quote.
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

test('GCC countries list 6 configs; corridors filter by destination', async () => {
  const res = await fetch(`${server.baseUrl}/api/gcc/countries`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.countries.length, 6);
  assert.ok(body.countries.some((c) => c.code === 'SA' && c.currency === 'SAR'));
  assert.ok(body.countries.some((c) => c.code === 'OM' && c.currency === 'OMR'));

  const corr = await fetch(`${server.baseUrl}/api/gcc/corridors?to=SA`);
  const corrBody = await corr.json();
  assert.ok(corrBody.corridors.length >= 2);
  assert.ok(corrBody.corridors.every((c) => c.destinationCountry === 'SA'));
});

test('multi-stop itinerary: add, list via job detail, complete, delete-block on completed', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'Final Drop',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const s1 = await shipper.post(`/api/jobs/${jobId}/stops`, { stopType: 'WAYPOINT', location: 'JAFZA_WAREHOUSE_7' });
  assert.equal(s1.status, 201, s1.raw);
  assert.equal(s1.body.stop.seq, 1);
  const s2 = await shipper.post(`/api/jobs/${jobId}/stops`, { stopType: 'DROP', location: 'AL_QUOZ_DROP_2' });
  assert.equal(s2.status, 201, s2.raw);
  assert.equal(s2.body.stop.seq, 2);

  const bad = await shipper.post(`/api/jobs/${jobId}/stops`, { stopType: 'FLY', location: 'NOWHERE' });
  assert.equal(bad.status, 400);

  const detail = await shipper.get(`/api/jobs/${jobId}`);
  assert.equal(detail.body.job.stops.length, 2);
  assert.equal(detail.body.job.stops[0].location, 'JAFZA_WAREHOUSE_7');

  // Award to a carrier so carrier-side completion is exercisable.
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 600, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });

  const done = await carrier.post(`/api/jobs/${jobId}/stops/${s1.body.stop.id}/complete`, {});
  assert.equal(done.status, 200, done.raw);
  assert.ok(done.body.stop.completed_at);

  const delCompleted = await shipper.delete(`/api/jobs/${jobId}/stops/${s1.body.stop.id}`);
  assert.equal(delCompleted.status, 403, 'completed stops are immutable');

  const delOpen = await shipper.delete(`/api/jobs/${jobId}/stops/${s2.body.stop.id}`);
  assert.equal(delOpen.status, 200, delOpen.raw);
});

test('lane quote returns reference guidance; unknown lane falls back honestly', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const q = await shipper.get('/api/lanes/quote?terminal=JEBEL_ALI_T2&area=JAFZA_SOUTH');
  assert.equal(q.status, 200, q.raw);
  assert.equal(q.body.lane.basePriceAed, 450);
  assert.equal(q.body.guidance.suggestedTargetAed, 450);

  const missing = await shipper.get('/api/lanes/quote?terminal=NOPE&area=NOPE');
  assert.equal(missing.status, 200);
  assert.equal(missing.body.lane, null);
  assert.ok(missing.body.fallback.indicativeAed > 0);
});
