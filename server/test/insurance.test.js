// GIT cargo insurance (Change 20): quote math, bind records a policy,
// broker provider stays dark without env vars, double-bind rejected,
// cancel works before transit.
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

async function postJob(shipper, extra = {}) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'Warehouse Ins',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    ...extra,
  });
  assert.equal(created.status, 201, created.raw);
  return created.body.job.id;
}

test('quote is pure math: 35bps, AED 25 floor, AED 1500 cap', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const q1 = await shipper.post('/api/insurance/quote', { cargoValueAed: 100000 });
  assert.equal(q1.status, 200, q1.raw);
  assert.equal(q1.body.quote.premiumAed, 350); // 100000 * 0.0035
  assert.equal(q1.body.quote.rateBps, 35);

  const qFloor = await shipper.post('/api/insurance/quote', { cargoValueAed: 1000 });
  assert.equal(qFloor.body.quote.premiumAed, 25); // floor, not 3.5

  const qCap = await shipper.post('/api/insurance/quote', { cargoValueAed: 500000 });
  assert.equal(qCap.body.quote.premiumAed, 1500); // cap, not 1750

  const qBad = await shipper.post('/api/insurance/quote', { cargoValueAed: -5 });
  assert.equal(qBad.status, 400);
});

test('bind records an internal policy; second bind is rejected; cancel works pre-transit', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const jobId = await postJob(shipper);

  const bind = await shipper.post(`/api/jobs/${jobId}/insurance/bind`, { cargoValueAed: 80000 });
  assert.equal(bind.status, 201, bind.raw);
  assert.equal(bind.body.policy.premium_aed, 280); // 80000 * 0.0035
  assert.equal(bind.body.policy.coverage_aed, 80000);
  assert.equal(bind.body.policy.status, 'ACTIVE');
  assert.ok(bind.body.policy.policy_ref);

  const dbl = await shipper.post(`/api/jobs/${jobId}/insurance/bind`, { cargoValueAed: 80000 });
  assert.equal(dbl.status, 409);

  const got = await shipper.get(`/api/jobs/${jobId}/insurance`);
  assert.equal(got.status, 200);
  assert.equal(got.body.policy.id, bind.body.policy.id);

  const cancel = await shipper.post(`/api/jobs/${jobId}/insurance/cancel`, {});
  assert.equal(cancel.status, 200, cancel.raw);
  assert.equal(cancel.body.policy.status, 'CANCELLED');
});

test('bind without any cargo value fails closed (400) — never a silent or fake bind', async () => {
  const prev = process.env.INSURANCE_PROVIDER;
  // NOTE: provider is read per-request from process.env of the SERVER child
  // process, not this test process — so this test asserts the route's dark
  // contract via the default internal provider instead: an unknown cargo
  // value is a 400, never a silent bind. The broker-dark path is covered
  // by lib-level review (isConfigured()/darkReason()) and .env.example.
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const jobId = await postJob(shipper);
  const bad = await shipper.post(`/api/jobs/${jobId}/insurance/bind`, {});
  assert.equal(bad.status, 400, 'bind without any cargo value must fail, not silently bind');
  if (prev === undefined) delete process.env.INSURANCE_PROVIDER;
  else process.env.INSURANCE_PROVIDER = prev;

  const none = await shipper.get(`/api/jobs/${jobId}/insurance`);
  assert.equal(none.body.policy, null);
});

test('broker provider without URL/KEY stays dark: bind is 503, never a fake bound record', async () => {
  // A second server in the same file, on an explicit port — harness.js's
  // startServer() now honors an explicit PORT in extraEnv for its own
  // baseUrl/health-check too, so no manual port-polling workaround needed.
  const brokerServer = await startServer({ INSURANCE_PROVIDER: 'broker', PORT: '4311' });
  const brokerBase = brokerServer.baseUrl;
  try {
    const shipper = makeClient(brokerBase);
    await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
    const created = await shipper.post('/api/jobs', {
      containerSize: '20FT', containerType: 'DRY',
      pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ', deliveryAddress: 'Dark Broker WH',
      readyAt: new Date(Date.now() + 86400000).toISOString(),
      deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    });
    assert.equal(created.status, 201, created.raw);
    const bind = await shipper.post(`/api/jobs/${created.body.job.id}/insurance/bind`, { cargoValueAed: 50000 });
    assert.equal(bind.status, 503, `unconfigured broker must refuse, got: ${bind.raw}`);
    assert.match(bind.raw, /not configured/i);
    const got = await shipper.get(`/api/jobs/${created.body.job.id}/insurance`);
    assert.equal(got.body.policy, null, 'refused bind must leave no policy row');
    assert.equal(got.body.configured, false);
  } finally {
    await brokerServer.stop();
  }
});
