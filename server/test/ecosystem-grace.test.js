// Grace expiry and seat permissions, on a server with a zero-day grace window
// so the "after grace" state is reachable without waiting.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeClient } = require('./harness');

const INTERNAL = { 'x-internal-key': 'test-internal-key' };
let server; let owner; let admin; let seat;

test.before(async () => {
  server = await startServer({ ECOSYSTEM_GRACE_DAYS: '0' });
  owner = makeClient(server.baseUrl); await owner.login('carrier@dubaidrayage.com', 'demo1234');
  admin = makeClient(server.baseUrl); await admin.login('admin@loadbyton.ae', 'demo1234');
});
test.after(async () => { await server.stop(); });

test('a seat sees the benefits but only the administrator can activate Business OS', async () => {
  const created = await owner.post('/api/org/members', { email: 'ops-seat@dubaidrayage.test', password: 'seat-pass-1234', seatRole: 'OPS', displayName: 'Ops' });
  assert.equal(created.status, 201, created.raw);
  seat = makeClient(server.baseUrl);
  await seat.login('ops-seat@dubaidrayage.test', 'seat-pass-1234');
  const b = await seat.get('/api/ecosystem/benefits');
  assert.equal(b.status, 200, b.raw);
  assert.equal(b.body.viewerRole, 'ops');
  const mine = await owner.get('/api/ecosystem/me');
  assert.equal(b.body.organisation.subjectId, mine.body.organisation.subjectId, 'a seat belongs to its owner\'s organisation');
  const act = await seat.post('/api/ecosystem/store/activate', { sector: 'road-transport', acceptTerms: true });
  assert.equal(act.status, 403);
  assert.equal(act.body.code, 'OWNER_ONLY');
});

test('after the grace window the company reverts to Starter on the next sweep — nothing is deleted', async () => {
  assert.equal((await owner.post('/api/ecosystem/store/activate', { sector: 'road-transport', acceptTerms: true })).status, 201);
  const subject = (await owner.get('/api/ecosystem/me')).body.organisation.subjectId;
  const plan = await admin.post('/api/admin/ecosystem/premium-plans', {
    planCode: 'premium', name: 'P', billingPeriod: 'monthly', priceMinor: 1, currency: 'AED', taxNote: 't', cancellationTerms: 'c', benefitTerms: 'b', publish: true,
  });
  const sub = await admin.post('/api/admin/ecosystem/subscriptions', {
    organisationSubjectId: subject, planVersionId: plan.body.id, periodEnd: new Date(Date.now() + 86400000).toISOString(), sourceRef: 'g-1',
  });
  assert.equal(sub.body.entitlement, 'enterprise_included');
  const failed = await admin.post(`/api/admin/ecosystem/subscriptions/${sub.body.id}/payment-failed`, {});
  // Zero-day grace: the window has already closed, so this lands on Starter at once.
  assert.equal(failed.body.entitlement.planCode, 'starter_included');
  const swept = await owner.post('/api/system/ecosystem-sweep', {}, INTERNAL);
  assert.equal(swept.status, 200);
  const b = await owner.get('/api/ecosystem/benefits');
  assert.equal(b.body.entitlement.planCode, 'starter_included');
  assert.equal(b.body.entitlement.reason, 'premium_ended_reverted_to_starter');
  assert.equal(b.body.store.activated, true, 'activation and company data stay');
});
