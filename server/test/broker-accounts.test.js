// Change 27 (Phase 7b): forwarder/broker/owner-operator registration,
// rosters, and direct-assign reusing the award transaction. One-hop rule
// enforced. WhatsApp-in-dashboard + CSV import are explicit Phase 2 (absent).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeClient } = require('./harness');

let server;

let admin;
let seededShipper;
let seededCarrier;
let seededCarrierId;
let seededBroker;
test.before(async () => {
  server = await startServer();
  admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
  // Shared across every test below that just needs "a real shipper" —
  // several used to each log this same seeded account in fresh, and this
  // file's auth-rate-limit budget (20 req/min/IP, shared across every
  // test since they all run against one server in well under a minute)
  // is tight enough that a handful of redundant logins is the difference
  // between the suite passing and 429ing partway through.
  seededShipper = makeClient(server.baseUrl);
  await seededShipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  seededCarrier = makeClient(server.baseUrl);
  await seededCarrier.login('carrier@dubaidrayage.com', 'demo1234');
  // GET /api/auth/me has its own, much higher-ceiling limiter
  // (authMeLimiter) than login/register do, so it's not the budget concern
  // the comment above is about — cached once here anyway, just to avoid
  // every test re-fetching "who am I" for this same already-known account.
  seededCarrierId = (await seededCarrier.get('/api/auth/me')).body.user.id;
  // Used wherever a test just needs "some OTHER, unrelated broker" (e.g.
  // proving one-hop / broker_id scoping) — saves a full register+login
  // pair (2 more auth calls) versus minting a fresh one each time.
  seededBroker = makeClient(server.baseUrl);
  await seededBroker.login('broker@levantlogix.ae', 'demo1234');
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

// A real bug found in review: account_approval_status was never checked
// server-side anywhere, so this exact registration flow could post a job
// and direct-assign/award it through real escrow with zero admin review —
// the very thing the PENDING/read-only model exists to prevent. Approving
// here is the fix's regression proof: these actions must now require it.
async function approve(userId) {
  const r = await admin.post(`/api/admin/approve/${userId}`, { action: 'approve' });
  assert.equal(r.status, 200, r.raw);
}

test('a PENDING account is blocked from posting jobs, and every write action named in the review, until an admin approves it', async () => {
  const anon = makeClient(server.baseUrl);
  const shp = await register(anon, 'SHIPPER');
  const shipper = makeClient(server.baseUrl);
  await shipper.login(shp.email, 'demo1234');

  const blocked = await shipper.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'X',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(blocked.status, 403, 'a PENDING shipper must not be able to post a job, even via a role it does satisfy');

  await approve(shp.id);
  const allowed = await shipper.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'X',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(allowed.status, 201, allowed.raw);
});

test('new roles register; forwarder client roster CRUD works', async () => {
  const anon = makeClient(server.baseUrl);
  const fwd = await register(anon, 'FORWARDER');
  assert.ok(fwd.id);
  await approve(fwd.id);

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
  await approve(brk.id);
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

  const add = await broker.post('/api/broker/carriers', { carrierId: seededCarrierId });
  assert.equal(add.status, 201, add.raw);

  const assign = await broker.post(`/api/jobs/${jobId}/direct-assign`, {
    carrierId: seededCarrierId, amountAed: 700, brokerSpreadBps: 500,
  });
  assert.equal(assign.status, 200, assign.raw);
  assert.equal(assign.body.job.status, 'AWARDED');
  assert.equal(assign.body.job.carrier_id, seededCarrierId);

  // One-hop: a second, unrelated broker cannot touch this brokered job.
  // Reuses the shared seeded broker rather than minting a fresh one — the
  // 403 below is the one-hop rule firing, not the approval gate masking
  // it, since the seeded account is already approved.
  const rebroker = await seededBroker.post(`/api/jobs/${jobId}/direct-assign`, {
    carrierId: seededCarrierId, amountAed: 700,
  });
  assert.equal(rebroker.status, 403);
});

test('broker accounts cannot bid — direct-assign is their only win path (no self-dealing)', async () => {
  const anon = makeClient(server.baseUrl);
  const brk = await register(anon, 'BROKER');
  await approve(brk.id);
  const broker = makeClient(server.baseUrl);
  await broker.login(brk.email, 'demo1234');

  const created = await seededShipper.post('/api/jobs', {
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

test('CRITICAL: a FORWARDER or BROKER with no jobs of their own gets an empty list from mine=true, not every job in the database', async () => {
  // job.service.js's listJobs used to default unhandled roles to `1=1` —
  // every job, for every shipper, leaked to any role this if/else chain
  // didn't explicitly name. FORWARDER has no job-ownership column at all
  // (forwarder_clients is a contact roster, no job FK), so an empty list
  // is the correct, honest answer — not the fail-open default.
  const anon1 = makeClient(server.baseUrl);
  const fwd = await register(anon1, 'FORWARDER');
  await approve(fwd.id);
  const forwarder = makeClient(server.baseUrl);
  await forwarder.login(fwd.email, 'demo1234');

  // A real job exists in the seeded roster (shipper@jebelalilogistics.ae
  // has several) — proves the fail-closed default isn't just "no jobs
  // exist yet in this test run," it's actively excluding real ones.
  const seeded = await seededShipper.get('/api/jobs?mine=true');
  assert.ok(seeded.body.jobs.length > 0, 'sanity check: the seeded shipper must actually have jobs for this leak to be meaningful');

  const fwdList = await forwarder.get('/api/jobs?mine=true');
  assert.equal(fwdList.status, 200, fwdList.raw);
  assert.equal(fwdList.body.jobs.length, 0, `forwarder must see zero jobs, not the ${fwdList.body.jobs.length} leaked from other accounts`);

  const anon2 = makeClient(server.baseUrl);
  const brk = await register(anon2, 'BROKER');
  await approve(brk.id);
  const broker = makeClient(server.baseUrl);
  await broker.login(brk.email, 'demo1234');
  const brkList = await broker.get('/api/jobs?mine=true');
  assert.equal(brkList.status, 200, brkList.raw);
  assert.equal(brkList.body.jobs.length, 0, `a broker with no brokered jobs yet must see zero, not the ${brkList.body.jobs.length} leaked from other accounts`);
});

test('a broker can view (and mine=true lists) the job they personally brokered, but not a job brokered by someone else', async () => {
  const anon = makeClient(server.baseUrl);
  const brk = await register(anon, 'BROKER');
  await approve(brk.id);
  const broker = makeClient(server.baseUrl);
  await broker.login(brk.email, 'demo1234');

  const created = await broker.post('/api/jobs', {
    containerSize: '40FT', containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'Broker Visibility Test',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  const jobId = created.body.job.id;

  const add = await broker.post('/api/broker/carriers', { carrierId: seededCarrierId });
  assert.equal(add.status, 201, add.raw);
  const assign = await broker.post(`/api/jobs/${jobId}/direct-assign`, { carrierId: seededCarrierId, amountAed: 650, brokerSpreadBps: 500 });
  assert.equal(assign.status, 200, assign.raw);

  // Before this fix: isParticipantOrBidder only checked shipper_id/
  // carrier_id, never broker_id — a broker got 403 on the exact job they
  // arranged.
  const detail = await broker.get(`/api/jobs/${jobId}`);
  assert.equal(detail.status, 200, `broker must be able to view a job they personally brokered, got: ${detail.raw}`);

  const mine = await broker.get('/api/jobs?mine=true');
  assert.ok(mine.body.jobs.some((j) => j.id === jobId), 'the brokered job must appear in this broker\'s own job list');

  // A second, unrelated broker must still be blocked (broker_id scoping
  // is per-broker, not "any broker") — reuses the shared seeded broker.
  const blocked = await seededBroker.get(`/api/jobs/${jobId}`);
  assert.equal(blocked.status, 403, 'a different broker must not be able to view a job they had no part in');
});

test('owner-operator registers and can bid like a carrier', async () => {
  const anon = makeClient(server.baseUrl);
  const oop = await register(anon, 'OWNER_OPERATOR');
  await approve(oop.id);
  // register() already signs `anon` in via cookie — reused directly
  // instead of a redundant fresh login, to stay under this file's shared
  // auth-rate-limit budget (20 req/min/IP across every test here).
  const oopClient = anon;

  const created = await seededShipper.post('/api/jobs', {
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
