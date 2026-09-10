// REVIEW-2026-09-08.md §6 follow-up #2: dispute-resolve and payout
// mark-transferred used to always execute on a single admin's say-so — real
// money moving off one person's decision, unlike MANUAL_ESCROW_RELEASE/
// MANUAL_REFUND (admin-approvals.routes.js), which already require a
// second admin. Gated behind the two_person_approval_required setting
// (default off, verified unchanged by every other test file in this suite
// still passing) — this file covers the ON behavior specifically.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeClient } = require('./harness');

let server;
let admin;

test.before(async () => {
  server = await startServer();
  admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
});

test.after(async () => {
  // Leave the setting as this suite found it (off) — other test files in
  // the same run share this server instance's settings table.
  await admin.patch('/api/admin/settings', { two_person_approval_required: false });
  await server.stop();
});

async function makeSecondAdmin(requesterAdmin) {
  const email = `second-admin-2p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.ae`;
  await requesterAdmin.post('/api/auth/register', {
    email, password: 'demo1234', role: 'SHIPPER',
    companyName: 'Second Admin Co', phone: '0509998877', trnNumber: '100000000000042',
    tradeLicenseNumber: 'CN-4200042', agreedToTerms: true,
  });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  db.prepare(`UPDATE users SET role='ADMIN', is_verified=1 WHERE email=?`).run(email);
  db.close();
  const client = makeClient(server.baseUrl);
  await client.login(email, 'demo1234');
  return client;
}

async function fullyDeliveredJob(shipper, carrier) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — two-person approval regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 1000,
  });
  const jobId = created.body.job.id;
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 1000, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  await admin.post('/api/admin/confirm-receipt', { jobId });
  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Test Driver', driverPhone: '0551230088' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  await carrier.post(`/api/jobs/${jobId}/pod`, {});
  return jobId;
}

test('with the setting on, dispute-resolve creates a pending approval instead of executing, and only a second admin\'s confirm actually resolves it', async () => {
  const settingOn = await admin.patch('/api/admin/settings', { two_person_approval_required: true });
  assert.equal(settingOn.status, 200, settingOn.raw);
  assert.equal(settingOn.body.settings.two_person_approval_required, true);

  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const jobId = await fullyDeliveredJob(shipper, carrier);

  const dispute = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'price disagreement', disputeType: 'PRICE' });
  assert.equal(dispute.status, 201, dispute.raw);
  const disputeId = dispute.body.dispute.id;

  const resolveAttempt = await admin.post(`/api/admin/disputes/${disputeId}/resolve`, { decision: 'RELEASE_TO_CARRIER', determination: 'no merit found' });
  assert.equal(resolveAttempt.status, 202, resolveAttempt.raw);
  assert.equal(resolveAttempt.body.pendingApproval.status, 'PENDING');
  assert.equal(resolveAttempt.body.pendingApproval.action_type, 'DISPUTE_RESOLVE');
  const approvalId = resolveAttempt.body.pendingApproval.id;

  // Nothing must have moved yet — dispute stays OPEN, job stays DISPUTED.
  const disputeAfterRequest = await admin.get('/api/admin/disputes');
  const disputeRow = disputeAfterRequest.body.disputes.find((d) => d.id === disputeId);
  assert.equal(disputeRow.status, 'OPEN', 'the dispute must not be resolved yet — only a pending approval was created');
  const jobAfterRequest = await shipper.get(`/api/jobs/${jobId}`);
  assert.equal(jobAfterRequest.body.job.status, 'DISPUTED', 'the job must stay DISPUTED until a second admin confirms');

  // A duplicate request while one is already pending must be refused.
  const dupRequest = await admin.post(`/api/admin/disputes/${disputeId}/resolve`, { decision: 'RELEASE_TO_CARRIER' });
  assert.equal(dupRequest.status, 409, 'a second pending resolution request for the same dispute must be refused');

  // The requesting admin cannot confirm their own request.
  const selfConfirm = await admin.post(`/api/admin/action-approvals/${approvalId}/confirm`, {});
  assert.equal(selfConfirm.status, 403, 'the requesting admin must not be able to confirm their own dispute-resolve request');

  // A second admin confirms — now it actually executes.
  const admin2 = await makeSecondAdmin(admin);
  const confirm = await admin2.post(`/api/admin/action-approvals/${approvalId}/confirm`, {});
  assert.equal(confirm.status, 200, confirm.raw);
  assert.equal(confirm.body.approval.status, 'EXECUTED');

  const disputeAfterConfirm = await admin.get('/api/admin/disputes');
  const disputeRowAfter = disputeAfterConfirm.body.disputes.find((d) => d.id === disputeId);
  assert.equal(disputeRowAfter.status, 'RESOLVED', 'confirming must actually resolve the dispute');
  assert.equal(disputeRowAfter.decision, 'RELEASE_TO_CARRIER');

  const jobAfterConfirm = await shipper.get(`/api/jobs/${jobId}`);
  assert.equal(jobAfterConfirm.body.job.status, 'COMPLETED', 'confirming must actually release escrow and complete the job');
});

test('with the setting on, rejecting a pending dispute-resolve request leaves the dispute open and moves no money', async () => {
  const settingOn = await admin.patch('/api/admin/settings', { two_person_approval_required: true });
  assert.equal(settingOn.status, 200, settingOn.raw);

  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const jobId = await fullyDeliveredJob(shipper, carrier);

  const dispute = await shipper.post(`/api/jobs/${jobId}/dispute`, { reason: 'price disagreement', disputeType: 'PRICE' });
  const disputeId = dispute.body.dispute.id;
  const resolveAttempt = await admin.post(`/api/admin/disputes/${disputeId}/resolve`, { decision: 'REFUND_SHIPPER', determination: 'carrier at fault' });
  assert.equal(resolveAttempt.status, 202, resolveAttempt.raw);
  const approvalId = resolveAttempt.body.pendingApproval.id;

  const admin2 = await makeSecondAdmin(admin);
  const reject = await admin2.post(`/api/admin/action-approvals/${approvalId}/reject`, { reason: 'need more evidence' });
  assert.equal(reject.status, 200, reject.raw);
  assert.equal(reject.body.approval.status, 'REJECTED');

  const disputeAfterReject = await admin.get('/api/admin/disputes');
  const disputeRow = disputeAfterReject.body.disputes.find((d) => d.id === disputeId);
  assert.equal(disputeRow.status, 'OPEN', 'a rejected dispute-resolve request must leave the dispute open, not resolved');
  const jobAfterReject = await shipper.get(`/api/jobs/${jobId}`);
  assert.equal(jobAfterReject.body.job.status, 'DISPUTED', 'a rejected request must not have released or refunded anything');
});

test('with the setting on, mark-transferred creates a pending approval, and only a second admin\'s confirm actually stamps the transfer', async () => {
  const settingOn = await admin.patch('/api/admin/settings', { two_person_approval_required: true });
  assert.equal(settingOn.status, 200, settingOn.raw);

  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const jobId = await fullyDeliveredJob(shipper, carrier);
  const complete = await shipper.patch(`/api/jobs/${jobId}/status`, { status: 'COMPLETED' });
  assert.equal(complete.status, 200, complete.raw);

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(server.dbPath);
  const payoutRow = db.prepare(`SELECT id, status FROM payouts WHERE job_id=?`).get(jobId);
  db.close();
  assert.equal(payoutRow.status, 'RELEASED', 'a completed job\'s payout must already be RELEASED (escrow auto-releases at completion)');

  const markAttempt = await admin.post(`/api/admin/payouts/${payoutRow.id}/mark-transferred`, { reference: 'WIRE-TEST-001' });
  assert.equal(markAttempt.status, 202, markAttempt.raw);
  assert.equal(markAttempt.body.pendingApproval.action_type, 'MARK_TRANSFERRED');
  const approvalId = markAttempt.body.pendingApproval.id;

  const selfConfirm = await admin.post(`/api/admin/action-approvals/${approvalId}/confirm`, {});
  assert.equal(selfConfirm.status, 403);

  const admin2 = await makeSecondAdmin(admin);
  const confirm = await admin2.post(`/api/admin/action-approvals/${approvalId}/confirm`, {});
  assert.equal(confirm.status, 200, confirm.raw);
  assert.equal(confirm.body.approval.status, 'EXECUTED');

  const db2 = new DatabaseSync(server.dbPath);
  const finalPayout = db2.prepare(`SELECT transfer_executed_at, transfer_reference FROM payouts WHERE id=?`).get(payoutRow.id);
  db2.close();
  assert.ok(finalPayout.transfer_executed_at, 'confirming the approval must actually stamp transfer_executed_at');
  assert.equal(finalPayout.transfer_reference, 'WIRE-TEST-001');
});
