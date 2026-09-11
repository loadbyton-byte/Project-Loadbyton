// Change 21 (ledger hash-chain + two-person approval) + Change 30 core
// (platform_fees via chargeFee: cancellation + priority placement).
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

async function postAwardFund(shipper, carrier, admin, extra = {}) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ', deliveryAddress: 'Ledger Test WH',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    ...extra,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 1000, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  await admin.post('/api/admin/confirm-receipt', { jobId });
  return jobId;
}

test('two-person rule: requester cannot self-confirm; second admin executes release', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const admin1 = makeClient(server.baseUrl);
  await admin1.login('admin@loadbyton.ae', 'demo1234');

  const jobId = await postAwardFund(shipper, carrier, admin1);

  const req1 = await admin1.post('/api/admin/action-approvals/request', {
    actionType: 'MANUAL_ESCROW_RELEASE', jobId, reason: 'carrier completed off-system',
  });
  assert.equal(req1.status, 201, req1.raw);
  assert.equal(req1.body.approval.status, 'PENDING');
  const approvalId = req1.body.approval.id;

  const selfConfirm = await admin1.post(`/api/admin/action-approvals/${approvalId}/confirm`, {});
  assert.equal(selfConfirm.status, 403, 'requester must never confirm their own request');
  assert.match(selfConfirm.raw, /Two-person/);

  // Promote a fresh account to second admin via direct DB (role is re-read
  // per request, so the existing session picks it up immediately).
  const reg = await admin1.post('/api/auth/register', {
    email: `second-admin-${Date.now()}@example.ae`, password: 'demo1234', role: 'SHIPPER',
    companyName: 'Second Admin Co', phone: '0509998877', trnNumber: '100000000000042',
    tradeLicenseNumber: 'CN-4200042', agreedToTerms: true,
  });
  void reg;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  const target = db.prepare(`SELECT id FROM users WHERE email LIKE 'second-admin-%@example.ae' ORDER BY id DESC LIMIT 1`).get();
  db.prepare(`UPDATE users SET role='ADMIN', is_verified=1 WHERE id=?`).run(target.id);
  db.close();

  const admin2 = makeClient(server.baseUrl);
  // login as the promoted user (password demo1234)
  const pending = await admin1.get('/api/admin/action-approvals?status=PENDING');
  assert.equal(pending.status, 200);
  assert.ok(pending.body.approvals.some((a) => a.id === approvalId), 'the pending request must appear in the action-approvals queue');
  void admin2;

  // Reuse admin1's session cookie jar trick: log in with the second admin's
  // credentials directly.
  const a2 = makeClient(server.baseUrl);
  const row = target;
  void row;
  // fetch email for login
  const { DatabaseSync: DB2 } = require('node:sqlite');
  const db2 = new DB2(server.dbPath);
  const u2 = db2.prepare(`SELECT email FROM users WHERE id=?`).get(target.id);
  db2.close();
  await a2.login(u2.email, 'demo1234');

  const confirm = await a2.post(`/api/admin/action-approvals/${approvalId}/confirm`, {});
  assert.equal(confirm.status, 200, confirm.raw);
  assert.equal(confirm.body.approval.status, 'EXECUTED');

  const job = (await shipper.get(`/api/jobs/${jobId}`)).body.job;
  assert.equal(job.escrow_status, 'RELEASED', 'confirmed release override must actually release escrow');
});

// Promotes a fresh SHIPPER account to ADMIN via direct DB write (mirrors
// the pattern in the confirm-flow test above) and returns a logged-in
// client for it — factored out here since the reject-flow test below
// needs the same "a different admin decides" setup twice.
async function makeSecondAdmin(server, requesterAdmin) {
  const email = `second-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.ae`;
  const reg = await requesterAdmin.post('/api/auth/register', {
    email, password: 'demo1234', role: 'SHIPPER',
    companyName: 'Second Admin Co', phone: '0509998877', trnNumber: '100000000000042',
    tradeLicenseNumber: 'CN-4200042', agreedToTerms: true,
  });
  void reg;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  db.prepare(`UPDATE users SET role='ADMIN', is_verified=1 WHERE email=?`).run(email);
  db.close();
  const client = require('./harness').makeClient(server.baseUrl);
  await client.login(email, 'demo1234');
  return client;
}

// REVIEW-2026-09-08.md §6 follow-up #1: reject was the only action-approvals
// endpoint with no test coverage. This checks the two-person rule holds for
// rejection too, and — the actual financial invariant that matters — that a
// rejected request never executes the underlying escrow/payout change.
test('action-approvals reject: requester cannot self-reject; a rejected request never executes; decided requests cannot be re-decided', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const admin1 = makeClient(server.baseUrl);
  await admin1.login('admin@loadbyton.ae', 'demo1234');

  const jobId = await postAwardFund(shipper, carrier, admin1);
  const beforeJob = (await shipper.get(`/api/jobs/${jobId}`)).body.job;

  const req1 = await admin1.post('/api/admin/action-approvals/request', {
    actionType: 'MANUAL_ESCROW_RELEASE', jobId, reason: 'carrier disputes off-system settlement',
  });
  assert.equal(req1.status, 201, req1.raw);
  const approvalId = req1.body.approval.id;

  const selfReject = await admin1.post(`/api/admin/action-approvals/${approvalId}/reject`, {});
  assert.equal(selfReject.status, 403, 'requester must never reject their own request');
  assert.match(selfReject.raw, /Two-person/);

  const admin2 = await makeSecondAdmin(server, admin1);
  const reject = await admin2.post(`/api/admin/action-approvals/${approvalId}/reject`, { reason: 'insufficient evidence' });
  assert.equal(reject.status, 200, reject.raw);
  assert.equal(reject.body.approval.status, 'REJECTED');
  assert.ok(reject.body.approval.confirmed_by, 'deciding admin is recorded on the approval row');

  // The core invariant: rejecting must never touch escrow/payout state.
  const afterJob = (await shipper.get(`/api/jobs/${jobId}`)).body.job;
  assert.equal(afterJob.escrow_status, beforeJob.escrow_status, 'a rejected approval must not release or otherwise change escrow');

  const audit = await admin1.get('/api/admin/audit');
  assert.ok(audit.body.entries.some((e) => e.action === 'APPROVAL_REJECTED' && e.entity_id === jobId), 'rejection must be on the audit trail');

  // Already-decided: neither confirm nor a second reject may act on it again.
  const confirmAfterReject = await admin2.post(`/api/admin/action-approvals/${approvalId}/confirm`, {});
  assert.equal(confirmAfterReject.status, 409, 'a rejected request cannot later be confirmed');
  const rejectAgain = await admin2.post(`/api/admin/action-approvals/${approvalId}/reject`, {});
  assert.equal(rejectAgain.status, 409, 'an already-decided request cannot be rejected again');
});

test('ledger hash-chain verifies; cancellation + priority fees accrue via chargeFee', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');

  // Priority placement fee at posting.
  const jobId = await postAwardFund(shipper, carrier, admin, { priorityPlacement: true });
  const myFees = await shipper.get('/api/billing/fees');
  assert.equal(myFees.status, 200);
  assert.ok(myFees.body.fees.some((f) => f.fee_code === 'PRIORITY_PLACEMENT' && f.job_id === jobId),
    'priority fee must accrue on opt-in post');

  // Cancellation after award accrues the cancellation fee exactly once.
  const cancel = await shipper.patch(`/api/jobs/${jobId}/status`, { status: 'CANCELLED' });
  assert.equal(cancel.status, 200, cancel.raw);
  const cancelAgain = await shipper.patch(`/api/jobs/${jobId}/status`, { status: 'CANCELLED' });
  void cancelAgain;
  const fees = await admin.get('/api/admin/platform-fees?feeCode=CANCELLATION_FEE');
  assert.equal(fees.status, 200);
  const rows = fees.body.fees.filter((f) => f.job_id === jobId);
  assert.equal(rows.length, 1, 'cancellation fee must be idempotent per job');
  assert.ok(rows[0].ledger_transaction_id, 'fee must link a real ledger transaction');

  const chain = await admin.get('/api/admin/ledger/verify-chain');
  assert.equal(chain.status, 200, chain.raw);
  assert.equal(chain.body.ok, true, `hash chain must verify, breaks: ${JSON.stringify(chain.body.breaks)}`);
  assert.ok(chain.body.checked >= 3, 'chain should cover several transactions by now');
});
