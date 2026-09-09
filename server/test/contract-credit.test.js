// Regression coverage for deferred payment terms (NET_24H/7/15/28 — see
// server/services/award.service.js's credit gate + server/routes/admin.routes.js's
// approve/settle endpoints, the same mechanism the old single
// CONTRACT_CREDIT tier used, generalized across four due-date options):
// a shipper can't self-grant credit, an award is blocked until an admin
// approves a limit, blocked again if it would exceed that limit, drawn down
// on a successful award with a real due date, restored on cancellation, and
// reducible via the admin "mark settled" action.

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

// A fresh registration starts PENDING and is read-only server-side
// (middleware/auth.js's requireApproved) until an admin approves it —
// posting a job would otherwise 403 regardless of anything to do with
// credit. Approve immediately so this file's own tests can focus on the
// credit gate specifically, not re-prove the approval gate other tests
// already cover.
async function freshShipper(baseUrl, admin) {
  const client = makeClient(baseUrl);
  const email = `credit-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.ae`;
  const r = await client.post('/api/auth/register', {
    email, password: 'demo1234', role: 'SHIPPER',
    companyName: 'Credit Test Shipper', phone: '+971502221111',
    trnNumber: '100222333400009', tradeLicenseNumber: 'CN-2233445',
    agreedToTerms: true,
  });
  assert.equal(r.status, 201, r.raw);
  const approved = await admin.post(`/api/admin/approve/${r.body.user.id}`, { action: 'approve' });
  assert.equal(approved.status, 200, approved.raw);
  return client;
}

async function postJobAndBid(shipper, carrier, paymentTier, amountAed = 400) {
  const created = await shipper.post('/api/jobs', {
    shipmentType: 'IMPORT', containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — contract credit regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 500, paymentTier,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(bid.status, 201, bid.raw);
  return { jobId, bidId: bid.body.bid.id };
}

test('NET_15 award is blocked without admin-approved credit, then succeeds once approved, drawing down the limit with a real due date', async () => {
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
  const shipper = await freshShipper(server.baseUrl, admin);
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const { jobId, bidId } = await postJobAndBid(shipper, carrier, 'NET_15', 400);

  const blocked = await shipper.post(`/api/jobs/${jobId}/award`, { bidId, skipNegotiation: true });
  assert.equal(blocked.status, 402, blocked.raw);

  const usersRes = await admin.get('/api/admin/credit');
  assert.equal(usersRes.status, 200, usersRes.raw);
  // Approve via the users list isn't exposed directly — resolve the new
  // shipper's id off the job we just created instead.
  const jobRow = await admin.get(`/api/jobs/${jobId}`);
  const shipperId = jobRow.body.job.shipper_id;

  const approve = await admin.post(`/api/admin/credit/${shipperId}/approve`, { limitAed: 500, termsDays: 15 });
  assert.equal(approve.status, 200, approve.raw);
  assert.equal(approve.body.credit.credit_limit_aed, 500);

  const awarded = await shipper.post(`/api/jobs/${jobId}/award`, { bidId, skipNegotiation: true });
  assert.equal(awarded.status, 200, awarded.raw);
  assert.equal(awarded.body.job.agreed_price_aed, 400);
  assert.ok(awarded.body.job.credit_due_at, 'credit_due_at must be set on a successful NET_15 award');
  const dueMs = new Date(awarded.body.job.credit_due_at).getTime() - Date.now();
  assert.ok(dueMs > 14 * 86400000 && dueMs < 16 * 86400000, `due date should be ~15 days out, got ${dueMs / 86400000} days`);

  const creditAfterAward = await admin.get('/api/admin/credit');
  const shipperRow = creditAfterAward.body.shippers.find((s) => s.id === shipperId);
  assert.equal(shipperRow.credit_balance_aed, 400, 'balance must reflect the drawn-down award');
  assert.ok(creditAfterAward.body.outstandingJobs.some((j) => j.id === jobId), 'the awarded job must appear as an outstanding draw');

  // A second job that would push the balance (400) + this bid (400) past
  // the 500 limit must be rejected — the limit, not just "has any credit".
  const { jobId: job2Id, bidId: bid2Id } = await postJobAndBid(shipper, carrier, 'NET_15', 400);
  const overLimit = await shipper.post(`/api/jobs/${job2Id}/award`, { bidId: bid2Id, skipNegotiation: true });
  assert.equal(overLimit.status, 402, overLimit.raw);

  // Cancelling the first job restores the balance.
  const cancelled = await shipper.patch(`/api/jobs/${jobId}/status`, { status: 'CANCELLED' });
  assert.equal(cancelled.status, 200, cancelled.raw);
  const creditAfterCancel = await admin.get('/api/admin/credit');
  const shipperRowAfterCancel = creditAfterCancel.body.shippers.find((s) => s.id === shipperId);
  assert.equal(shipperRowAfterCancel.credit_balance_aed, 0, 'cancelling an awarded NET_15 job must restore the balance');

  // The over-limit job now fits — award it, then settle it via the admin action.
  const nowFits = await shipper.post(`/api/jobs/${job2Id}/award`, { bidId: bid2Id, skipNegotiation: true });
  assert.equal(nowFits.status, 200, nowFits.raw);
  const settle = await admin.post(`/api/admin/credit/jobs/${job2Id}/settle`);
  assert.equal(settle.status, 200, settle.raw);
  const creditAfterSettle = await admin.get('/api/admin/credit');
  const shipperRowAfterSettle = creditAfterSettle.body.shippers.find((s) => s.id === shipperId);
  assert.equal(shipperRowAfterSettle.credit_balance_aed, 0, 'settling must restore the balance');
  assert.ok(!creditAfterSettle.body.outstandingJobs.some((j) => j.id === job2Id), 'a settled job must drop off the outstanding list');

  // Settling twice must be refused, not silently double-restore an
  // already-zeroed balance.
  const settleAgain = await admin.post(`/api/admin/credit/jobs/${job2Id}/settle`);
  assert.equal(settleAgain.status, 400, settleAgain.raw);
});

// Regression for a real bug: cancellation-restore (job.service.js) and
// admin-settle (admin.routes.js) used to be two entirely uncoordinated
// claims — cancellation only checked/cleared credit_due_at, settle only
// checked/set credit_settled_at. Either order (cancel-then-settle, or
// settle-then-cancel) let the SECOND path's claim still succeed and
// decrement profiles.credit_balance_aed a second time for a draw that
// was already resolved — capable of wiping out an unrelated job's real
// outstanding balance. Fixed by having each path check AND set BOTH
// fields, so whichever runs first "uses up" the claim for both.
test('a deferred-term job\'s credit draw cannot be restored twice, in either order (cancel-then-settle, settle-then-cancel)', async () => {
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
  const shipper = await freshShipper(server.baseUrl, admin);
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const balanceOf = async (shipperId) => (await admin.get('/api/admin/credit')).body.shippers.find((s) => s.id === shipperId).credit_balance_aed;

  const { jobId: jobA, bidId: bidIdA } = await postJobAndBid(shipper, carrier, 'NET_7', 300);
  const jobRow = await admin.get(`/api/jobs/${jobA}`);
  const shipperId = jobRow.body.job.shipper_id;
  const approve = await admin.post(`/api/admin/credit/${shipperId}/approve`, { limitAed: 2000, termsDays: 7 });
  assert.equal(approve.status, 200, approve.raw);

  // --- Direction A: cancel, then attempt settle ---
  const awardedA = await shipper.post(`/api/jobs/${jobA}/award`, { bidId: bidIdA, skipNegotiation: true });
  assert.equal(awardedA.status, 200, awardedA.raw);

  const balanceAfterAwardA = await balanceOf(shipperId);
  const cancelA = await shipper.patch(`/api/jobs/${jobA}/status`, { status: 'CANCELLED' });
  assert.equal(cancelA.status, 200, cancelA.raw);
  const balanceAfterCancelA = await balanceOf(shipperId);
  assert.equal(balanceAfterCancelA, balanceAfterAwardA - 300, 'cancellation must restore exactly the drawn amount');

  const settleAfterCancelA = await admin.post(`/api/admin/credit/jobs/${jobA}/settle`);
  assert.equal(settleAfterCancelA.status, 400, 'settling an already-cancelled (already-restored) job must be refused, not double-decrement');
  const balanceAfterSettleAttemptA = await balanceOf(shipperId);
  assert.equal(balanceAfterSettleAttemptA, balanceAfterCancelA, 'balance must be unchanged by the refused settle attempt');

  // --- Direction B: settle early (before cancel), then attempt cancel ---
  const { jobId: jobB, bidId: bidIdB } = await postJobAndBid(shipper, carrier, 'NET_7', 250);
  const awardedB = await shipper.post(`/api/jobs/${jobB}/award`, { bidId: bidIdB, skipNegotiation: true });
  assert.equal(awardedB.status, 200, awardedB.raw);

  const balanceAfterAwardB = await balanceOf(shipperId);
  const settleB = await admin.post(`/api/admin/credit/jobs/${jobB}/settle`);
  assert.equal(settleB.status, 200, settleB.raw);
  const balanceAfterSettleB = await balanceOf(shipperId);
  assert.equal(balanceAfterSettleB, balanceAfterAwardB - 250, 'settling must restore exactly the drawn amount');

  // The status transition itself may still succeed (settle doesn't touch
  // job status) — what matters is the balance must NOT move again.
  await shipper.patch(`/api/jobs/${jobB}/status`, { status: 'CANCELLED' });
  const balanceAfterCancelAttemptB = await balanceOf(shipperId);
  assert.equal(balanceAfterCancelAttemptB, balanceAfterSettleB, 'balance must be unchanged by cancelling an already-settled job — no double-restore');
});
