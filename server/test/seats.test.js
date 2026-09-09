// Multi-seat company accounts: a seat authenticates with its own
// credentials but operates as the org root for every job/bid/payout (see
// the comment on auth() in server/index.js). These tests exist to catch
// exactly the failure mode that design risks: a seat's job silently not
// belonging to the org, or a role gate not actually blocking anything.

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

test('seats: OPS can operate the org, VIEWER cannot, deactivation is immediate', async () => {
  const root = makeClient(server.baseUrl);
  const rootEmail = `seat-root-${Date.now()}@example.ae`;
  const registered = await root.post('/api/auth/register', {
    email: rootEmail, password: 'demo1234', role: 'SHIPPER', companyName: 'Seat Test Shipping',
    phone: '+971501112233', trnNumber: '100234567800003', tradeLicenseNumber: 'CN-1122334', agreedToTerms: true,
  });
  assert.equal(registered.status, 201, registered.raw);
  const rootId = registered.body.user.id;
  // New accounts are approval-gated (read-only until an admin approves) —
  // the seats flow operates after approval, so approve before continuing.
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
  const approved = await admin.post(`/api/admin/approve/${rootId}`, { action: 'approve' });
  assert.equal(approved.status, 200, approved.raw);

  const opsAdd = await root.post('/api/org/members', {
    email: `seat-ops-${Date.now()}@example.ae`, password: 'demo1234', seatRole: 'OPS', displayName: 'Ops Person',
  });
  assert.equal(opsAdd.status, 201, opsAdd.raw);

  const viewerEmail = `seat-viewer-${Date.now()}@example.ae`;
  const viewerAdd = await root.post('/api/org/members', {
    email: viewerEmail, password: 'demo1234', seatRole: 'VIEWER', displayName: 'Viewer Person',
  });
  assert.equal(viewerAdd.status, 201, viewerAdd.raw);

  // OPS seat logs in with their OWN credentials and posts a job — the job
  // must be attributed to the ORG (root id), not the seat's own id.
  const opsClient = makeClient(server.baseUrl);
  const opsLogin = await opsClient.login(opsAdd.body.seat.email, 'demo1234');
  assert.equal(opsLogin.body.actingAs.seatRole, 'OPS');
  assert.equal(opsLogin.body.user.id, rootId, "a seat's session must resolve to the org root, not the seat's own id");

  const jobRes = await opsClient.post('/api/jobs', {
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'Seat Test Warehouse',
    containerSize: '40FT', containerType: 'DRY',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(jobRes.status, 201, jobRes.raw);
  assert.equal(jobRes.body.job.shipper_id, rootId, "a seat's job must belong to the org, not the seat");

  // VIEWER seat must be blocked from the same mutating action, server-side.
  const viewerClient = makeClient(server.baseUrl);
  await viewerClient.login(viewerEmail, 'demo1234');
  const blocked = await viewerClient.post('/api/jobs', {
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'Should not be created',
    containerSize: '40FT', containerType: 'DRY',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(blocked.status, 403, 'a VIEWER seat must not be able to post a job');

  // A seat (not the root) must not be able to manage other seats.
  const viewerTriesToAddSeat = await viewerClient.post('/api/org/members', {
    email: `should-not-exist-${Date.now()}@example.ae`, password: 'demo1234', seatRole: 'OPS',
  });
  assert.equal(viewerTriesToAddSeat.status, 403, 'only the org root can add seats');

  // Root deactivates the OPS seat — this must kill their live session
  // immediately, not just block their next login.
  const deactivate = await root.patch(`/api/org/members/${opsAdd.body.seat.id}`, { isActive: false });
  assert.equal(deactivate.status, 200, deactivate.raw);

  const staleSessionCheck = await opsClient.get('/api/auth/me');
  assert.equal(staleSessionCheck.status, 401, 'deactivating a seat must invalidate its existing session, not just future logins');

  const relogin = await makeClient(server.baseUrl).login(opsAdd.body.seat.email, 'demo1234').catch((e) => e);
  assert.match(relogin.message, /deactivated/);
});

// Regression for a real bug: several money-moving/state-changing job
// actions were missing the requireSeatRole(['OPS']) gate every other
// mutating job/bid route already has — a read-only VIEWER seat could
// reach them directly via the API even though the UI never exposes them
// for that role. Covers two representative, real-money examples: a
// carrier-side cash advance and the shipper-side bid-terms confirmation
// award.service.js requires before an award can happen.
test('a VIEWER seat cannot pull a fuel advance or confirm bid terms — money-moving actions stay OPS-only', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');

  const carrierRoot = makeClient(server.baseUrl);
  const carrierEmail = `seat-viewer-carrier-${Date.now()}@example.ae`;
  const registered = await carrierRoot.post('/api/auth/register', {
    email: carrierEmail, password: 'demo1234', role: 'CARRIER', companyName: 'Viewer Seat Carrier Co',
    phone: '+971503334455', trnNumber: '100334455600007', tradeLicenseNumber: 'CN-3344556', agreedToTerms: true,
  });
  assert.equal(registered.status, 201, registered.raw);
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
  await admin.post(`/api/admin/approve/${registered.body.user.id}`, { action: 'approve' });
  await admin.post(`/api/admin/verify/${registered.body.user.id}`, { action: 'approve', iban: 'AE070331234567890123456' });

  const viewerEmail = `seat-viewer-money-${Date.now()}@example.ae`;
  const viewerAdd = await carrierRoot.post('/api/org/members', { email: viewerEmail, password: 'demo1234', seatRole: 'VIEWER', displayName: 'Viewer Person' });
  assert.equal(viewerAdd.status, 201, viewerAdd.raw);
  const viewer = makeClient(server.baseUrl);
  await viewer.login(viewerEmail, 'demo1234');

  // A real awarded job the org root (full-access) actually owns as carrier.
  const job = await shipper.post('/api/jobs', {
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'Viewer seat regression',
    containerSize: '40FT', containerType: 'DRY', maxBudgetAed: 500,
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(job.status, 201, job.raw);
  const bid = await carrierRoot.post(`/api/jobs/${job.body.job.id}/bids`, { amountAed: 450, etaAt: new Date(Date.now() + 24 * 3600000).toISOString() });
  assert.equal(bid.status, 201, bid.raw);
  const confirmByOwner = await shipper.post(`/api/bids/${bid.body.bid.id}/confirm-terms`);
  assert.equal(confirmByOwner.status, 200, confirmByOwner.raw);
  // A fresh carrier account declares 0 available units by default —
  // acknowledge the low-capacity warning so the award itself succeeds;
  // that gate is unrelated to what this test is actually checking.
  const awarded = await shipper.post(`/api/jobs/${job.body.job.id}/award`, { bidId: bid.body.bid.id, acknowledgeLowCapacity: true });
  assert.equal(awarded.status, 200, awarded.raw);

  const fuelAdvanceBlocked = await viewer.post(`/api/jobs/${job.body.job.id}/fuel-advance`, { type: 'FUEL' });
  assert.equal(fuelAdvanceBlocked.status, 403, 'a VIEWER seat must not be able to pull a fuel advance');

  // A second job to test confirm-terms specifically (the first is already
  // past that stage) — the shipper side's VIEWER-blocked case.
  const shipperRoot = makeClient(server.baseUrl);
  const shipperEmail = `seat-viewer-shipper-${Date.now()}@example.ae`;
  const shipperRegistered = await shipperRoot.post('/api/auth/register', {
    email: shipperEmail, password: 'demo1234', role: 'SHIPPER', companyName: 'Viewer Seat Shipper Co',
    phone: '+971504445566', trnNumber: '100445566700004', tradeLicenseNumber: 'CN-4455667', agreedToTerms: true,
  });
  assert.equal(shipperRegistered.status, 201, shipperRegistered.raw);
  await admin.post(`/api/admin/approve/${shipperRegistered.body.user.id}`, { action: 'approve' });
  const shipperViewerEmail = `seat-viewer-shipper-seat-${Date.now()}@example.ae`;
  const shipperViewerAdd = await shipperRoot.post('/api/org/members', { email: shipperViewerEmail, password: 'demo1234', seatRole: 'VIEWER', displayName: 'Viewer Person' });
  assert.equal(shipperViewerAdd.status, 201, shipperViewerAdd.raw);
  const shipperViewer = makeClient(server.baseUrl);
  await shipperViewer.login(shipperViewerEmail, 'demo1234');

  const job2 = await shipperRoot.post('/api/jobs', {
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'Viewer seat regression 2',
    containerSize: '40FT', containerType: 'DRY', maxBudgetAed: 500,
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(job2.status, 201, job2.raw);
  const bid2 = await carrierRoot.post(`/api/jobs/${job2.body.job.id}/bids`, { amountAed: 400, etaAt: new Date(Date.now() + 24 * 3600000).toISOString() });
  assert.equal(bid2.status, 201, bid2.raw);

  const confirmBlocked = await shipperViewer.post(`/api/bids/${bid2.body.bid.id}/confirm-terms`);
  assert.equal(confirmBlocked.status, 403, 'a VIEWER seat must not be able to confirm bid terms (the gate award.service.js checks before allowing an award)');
});
