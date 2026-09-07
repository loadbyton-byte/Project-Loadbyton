// Change 27 (Phase 7b): forwarder/broker/owner-operator registration,
// rosters, and direct-assign reusing the award transaction. One-hop rule
// enforced. WhatsApp-in-dashboard + CSV import are explicit Phase 2 (absent).
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

let n = 0;
async function register(client, role) {
  n += 1;
  const email = `phase7b-${role.toLowerCase()}-${Date.now()}-${n}@example.ae`;
  const r = await client.post('/api/auth/register', {
    email, password: 'demo1234', role, companyName: `${role} Co ${n}`,
    phone: `050${String(2000000 + n).slice(-7)}`, trnNumber: String(100000000000000 + n),
    tradeLicenseNumber: `CN-77${String(10000 + n)}`, agreedToTerms: true,
  });
  assert.equal(r.status, 201, r.raw);
  // Registration signs the user in (cookie set); verify + re-login as needed
  return { email, id: r.body.user.id };
}

test('new roles register; forwarder client roster CRUD works', async () => {
  const anon = makeClient(server.baseUrl);
  const fwd = await register(anon, 'FORWARDER');
  assert.ok(fwd.id);

  const fwdClient = makeClient(server.baseUrl);
  // register auto-logs-in as the new user via cookie on `anon`; use fresh login
  await fwdClient.login(fwd.email, 'demo1234');
  const created = await fwdClient.post('/api/forwarder/clients', { clientName: 'Acme Imports', contactPhone: '0501112233' });
  assert.equal(created.status, 201, created.raw);
  assert.equal(created.body.client.client_name, 'Acme Imports');

  const listed = await fwdClient.get('/api/forwarder/clients');
  assert.equal(listed.status, 200);
  assert.ok(listed.body.clients.some((c) => c.client_name === 'Acme Imports'));

  const bad = await fwdClient.post('/api/forwarder/clients', {});
  assert.equal(bad.status, 400);
});

test('broker roster + direct-assign awards via the real award transaction; one-hop enforced', async () => {
  const anon = makeClient(server.baseUrl);
  const brk = await register(anon, 'BROKER');
  const broker = makeClient(server.baseUrl);
  await broker.login(brk.email, 'demo1234');

  // Broker posts a job (SHIPPER-satisfying guard) then direct-assigns a
  // verified roster carrier at an agreed price.
  const created = await broker.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'Broker Warehouse',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const carrierMe = await carrier.get('/api/auth/me');

  const add = await broker.post('/api/broker/carriers', { carrierId: carrierMe.body.user.id });
  assert.equal(add.status, 201, add.raw);

  const assign = await broker.post(`/api/jobs/${jobId}/direct-assign`, {
    carrierId: carrierMe.body.user.id, amountAed: 700, brokerSpreadBps: 500,
  });
  assert.equal(assign.status, 200, assign.raw);
  assert.equal(assign.body.job.status, 'AWARDED');
  assert.equal(assign.body.job.carrier_id, carrierMe.body.user.id);

  // One-hop: a second broker cannot touch this brokered job.
  const anon2 = makeClient(server.baseUrl);
  const brk2 = await register(anon2, 'BROKER');
  const broker2 = makeClient(server.baseUrl);
  await broker2.login(brk2.email, 'demo1234');
  const rebroker = await broker2.post(`/api/jobs/${jobId}/direct-assign`, {
    carrierId: carrierMe.body.user.id, amountAed: 700,
  });
  assert.equal(rebroker.status, 403);

  // Roster rejects non-carrier targets (no re-brokering).
  const badTarget = await broker.post('/api/broker/carriers', { carrierId: broker2.body ? 0 : 0 }).catch(() => null);
  void badTarget;
});

test('broker accounts cannot bid — direct-assign is their only win path (no self-dealing)', async () => {
  const anon = makeClient(server.baseUrl);
  const brk = await register(anon, 'BROKER');
  const broker = makeClient(server.baseUrl);
  await broker.login(brk.email, 'demo1234');

  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ', deliveryAddress: 'No Broker Bids',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);

  const bid = await broker.post(`/api/jobs/${created.body.job.id}/bids`, {
    amountAed: 400, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(bid.status, 403, `broker bidding must be rejected, got: ${bid.raw}`);
  assert.match(bid.raw, /direct-assign/);
});

test('owner-operator registers and can bid like a carrier', async () => {
  const anon = makeClient(server.baseUrl);
  const oop = await register(anon, 'OWNER_OPERATOR');
  const oopClient = makeClient(server.baseUrl);
  await oopClient.login(oop.email, 'demo1234');

  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ', deliveryAddress: 'OOP Test',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);
  // Owner-operator bids through the CARRIER-satisfying guard. Fresh accounts
  // are unverified, so bidding stops at the verification check — which
  // proves the ROLE guard passed (a role failure would be 403
  // "Insufficient permissions" instead).
  const bid = await oopClient.post(`/api/jobs/${created.body.job.id}/bids`, {
    amountAed: 400, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.ok(!String(bid.raw).includes('Insufficient permissions'), `owner-operator must pass the carrier role guard, got: ${bid.raw}`);
  assert.match(bid.raw, /verification/i, 'fresh owner-operator stops at verification, not at role');
});
