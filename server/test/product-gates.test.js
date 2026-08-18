// Product-gate regression suite for the 9-item change batch:
//   - UAE-format signup validation (phone/TRN/trade licence)
//   - account approval gate (read-only until an admin approves)
//   - equipment semantics (TRAILER_WITH_GENSET container-capable, REEFER_TRUCK
//     gone, CUSTOM requires a written requirement)
//   - document privacy (shipper <-> carrier only after bid confirmed)
//   - driver details shared only after award
// Runs against a real, freshly-seeded throwaway server (see harness.js).

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
  await server.stop();
});

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.ae`;
}

const VALID = {
  phone: '+971501112233',
  trn: '100234567800003',
  licence: 'CN-1122334',
};

test('signup rejects non-UAE phone, TRN, and trade licence formats', async () => {
  const base = { email: uniqueEmail('bad'), password: 'demo1234', role: 'SHIPPER', companyName: 'Bad Data Co' };

  const noPhone = await makeClient(server.baseUrl).post('/api/auth/register', { ...base, phone: '+971 4 221 5566' });
  assert.equal(noPhone.status, 400, 'a landline must not pass UAE mobile validation');

  const noTrn = await makeClient(server.baseUrl).post('/api/auth/register', { ...base, phone: VALID.phone, trnNumber: '123' });
  assert.equal(noTrn.status, 400, 'a 3-digit TRN must not pass the 15-digit rule');

  const noLicence = await makeClient(server.baseUrl).post('/api/auth/register', { ...base, phone: VALID.phone, trnNumber: VALID.trn, tradeLicenseNumber: 'abc' });
  assert.equal(noLicence.status, 400, 'a letter-only licence must not pass (requires at least one digit)');
});

test('new account starts PENDING and is read-only until an admin approves it', async () => {
  const email = uniqueEmail('pending');
  const client = makeClient(server.baseUrl);
  const registered = await client.post('/api/auth/register', {
    email, password: 'demo1234', role: 'CARRIER', companyName: 'Pending Haulage Co',
    phone: VALID.phone, trnNumber: VALID.trn, tradeLicenseNumber: VALID.licence,
  });
  assert.equal(registered.status, 201, registered.raw);
  assert.equal(registered.body.user.account_approval_status, 'PENDING', 'a fresh registration must be PENDING, not auto-approved');

  // Browse is fine (read-only mode)…
  const jobs = await client.get('/api/jobs?status=OPEN');
  assert.equal(jobs.status, 200, 'a pending account must still be able to browse');
  const job = jobs.body.jobs[0];
  assert.ok(job, 'a carrier must see OPEN jobs');

  // …but every workflow action is blocked server-side by the approval gate.
  const bid = await client.post(`/api/jobs/${job.id}/bids`, { amountAed: 100, etaMinutes: 30 });
  assert.equal(bid.status, 403, 'a pending account must not be able to bid');

  const createJob = await client.post('/api/jobs', {
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'X',
    containerSize: '40FT', containerType: 'DRY', targetPriceAed: 500,
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(createJob.status, 403, 'a pending account must not be able to post jobs');

  // The admin queue surfaces the pending account with its UAE details…
  const queue = await admin.get('/api/admin/approvals');
  const row = queue.body.queue.find((u) => u.email === email);
  assert.ok(row, 'pending account must appear in the admin approval queue');
  assert.equal(row.profile.trn_number, VALID.trn, 'the queue must show the decrypted TRN for review');
  assert.equal(row.role, 'CARRIER');

  // …and approval flips the gate open (carrier document verification is a
  // separate, deeper gate — cleared here so the bid can actually land).
  const approved = await admin.post(`/api/admin/approve/${registered.body.user.id}`, { action: 'approve' });
  assert.equal(approved.status, 200, approved.raw);
  assert.equal(approved.body.user.account_approval_status, 'APPROVED');

  const audit = await admin.get('/api/admin/audit');
  assert.ok(audit.body.entries.some((e) => e.action === 'ACCOUNT_APPROVE' && e.entity_id === registered.body.user.id), 'approval must be on the audit trail');

  const verified = await admin.post(`/api/admin/verify/${registered.body.user.id}`, { action: 'approve', iban: 'AE070331234567890123456' });
  assert.equal(verified.status, 200, verified.raw);

  const bidAfter = await client.post(`/api/jobs/${job.id}/bids`, { amountAed: 100, etaMinutes: 30 });
  assert.equal(bidAfter.status, 201, bidAfter.raw);
});

test('equipment: TRAILER_WITH_GENSET is container-carrying; REEFER_TRUCK is gone; CUSTOM needs a requirement', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const base = {
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'X',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  };

  const genset = await shipper.post('/api/jobs', { ...base, equipmentType: 'TRAILER_WITH_GENSET', containerSize: 'REEFER', containerType: 'REEFER', requiresReefer: true, cargoWeightTons: 26.5 });
  assert.equal(genset.status, 201, genset.raw);
  assert.equal(genset.body.job.equipment_type, 'TRAILER_WITH_GENSET');
  assert.equal(genset.body.job.cargo_weight_tons, 26.5, 'cargoWeightTons must be stored');

  const badWeight = await shipper.post('/api/jobs', { ...base, equipmentType: 'CUSTOM', customRequirement: 'x', cargoWeightTons: -3 });
  assert.equal(badWeight.status, 400, 'a non-positive cargo weight must be rejected');

  const oldType = await shipper.post('/api/jobs', {
    ...base, equipmentType: 'REEFER_TRUCK', containerSize: '40FT', containerType: 'DRY', notes: 'x',
  });
  assert.equal(oldType.status, 201, 'unknown equipment types must fall back to the default, not 500');
  assert.equal(oldType.body.job.equipment_type, 'CONTAINER_CHASSIS', 'REEFER_TRUCK no longer exists — must not be stored');

  const customNoRequirement = await shipper.post('/api/jobs', { ...base, equipmentType: 'CUSTOM' });
  assert.equal(customNoRequirement.status, 400, 'CUSTOM without a written requirement must be rejected');

  const custom = await shipper.post('/api/jobs', { ...base, equipmentType: 'CUSTOM', customRequirement: 'Double-deck trailer, 20 ft deck' });
  assert.equal(custom.status, 201, custom.raw);
  assert.equal(custom.body.job.equipment_type, 'CUSTOM');
  assert.match(custom.body.job.notes, /Double-deck trailer/, 'customRequirement must flow into notes');
});

test('documents are private until the bid is confirmed; uploads are for parties only', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const loser = makeClient(server.baseUrl);
  await loser.login('falcon@containerxpress.ae', 'demo1234'); // bidding, then losing

  const created = await shipper.post('/api/jobs', {
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'Doc Privacy Test',
    containerSize: '40FT', containerType: 'DRY', targetPriceAed: 700,
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  const jobId = created.body.job.id;

  const doc = await shipper.post(`/api/jobs/${jobId}/documents`, { docType: 'CUSTOMS', title: 'Customs release', fileUrl: 'https://files.loadbyton.demo/customs-test.pdf' });
  assert.equal(doc.status, 201, doc.raw);

  // A competing carrier can't even upload, and sees no documents while the
  // job is OPEN — not even that a document exists.
  const loserUpload = await loser.post(`/api/jobs/${jobId}/documents`, { docType: 'OTHER', title: 'Sneaky', fileUrl: 'https://files.loadbyton.demo/x.pdf' });
  assert.equal(loserUpload.status, 403, 'a bidding (non-awarded) carrier must not upload documents to the job');

  const loserBid = await loser.post(`/api/jobs/${jobId}/bids`, { amountAed: 640, etaMinutes: 35, truckType: 'CONTAINER_CHASSIS' });
  assert.equal(loserBid.status, 201, loserBid.raw);

  const loserView = await loser.get(`/api/jobs/${jobId}`);
  assert.deepEqual(loserView.body.documents, [], 'an OPEN job must show zero documents to a bidding carrier');

  const carrierView = await carrier.get(`/api/jobs/${jobId}`);
  assert.deepEqual(carrierView.body.documents, [], 'the bidding carrier must not see the shipper\u2019s documents pre-award');

  // After the shipper confirms the winning bid, the carrier sees the documents.
  const bidRes = await carrier.post(`/api/jobs/${jobId}/bids`, { amountAed: 650, etaMinutes: 40, truckType: 'CONTAINER_CHASSIS' });
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bidRes.body.bid.id });
  assert.equal(award.status, 200, award.raw);

  const carrierViewAfter = await carrier.get(`/api/jobs/${jobId}`);
  assert.equal(carrierViewAfter.body.documents.length, 1, 'the awarded carrier must see the shipper\u2019s documents');
  assert.equal(carrierViewAfter.body.documents[0].title, 'Customs release');

  // The awarded carrier can now upload their own side — and the shipper
  // sees it back.
  const carrierDoc = await carrier.post(`/api/jobs/${jobId}/documents`, { docType: 'LICENCE', title: 'Trade licence', fileUrl: 'https://files.loadbyton.demo/licence.pdf' });
  assert.equal(carrierDoc.status, 201, carrierDoc.raw);
  const shipperView = await shipper.get(`/api/jobs/${jobId}`);
  assert.equal(shipperView.body.documents.length, 2, 'after award, both sides see both sets of documents');

  // The losing bidder still sees nothing.
  const stillHidden = await loser.get(`/api/jobs/${jobId}`);
  assert.equal(stillHidden.status, 200, 'a losing bidder may still view the (awarded) job');
  assert.deepEqual(stillHidden.body.documents, [], 'a non-awarded bidder must never see documents');
});

test('driver details are not collected at bid time and are required before PICKED_UP', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    pickupTerminal: 'JEBEL_ALI_T2', deliveryArea: 'JAFZA_SOUTH', deliveryAddress: 'Driver Privacy Test',
    containerSize: '40FT', containerType: 'DRY', targetPriceAed: 700,
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  const jobId = created.body.job.id;

  // A bid with driver fields must be silently stripped — the API contract
  // is "no driver at bid time".
  const bidRes = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 650, etaMinutes: 40, truckType: 'CONTAINER_CHASSIS', driverName: 'Should Not Stick', driverPhone: '+971509998877',
  });
  assert.equal(bidRes.status, 201, bidRes.raw);
  assert.equal(bidRes.body.bid.driver_name, null);
  assert.equal(bidRes.body.bid.driver_phone, null);

  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bidRes.body.bid.id });
  assert.equal(award.status, 200, award.raw);
  assert.equal(award.body.job.assigned_driver_name, null, 'award must not bind a driver');

  // PICKED_UP is impossible without the post-award driver on file.
  const noDriver = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(noDriver.status, 400, 'PICKED_UP without an assigned driver must be rejected');

  const addDriver = await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Hamdan Youssef', driverPhone: '+971501112233' });
  assert.equal(addDriver.status, 200, addDriver.raw);
  assert.equal(addDriver.body.job.assigned_driver_name, 'Hamdan Youssef');

  const pickedUp = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(pickedUp.status, 200, pickedUp.raw);
});
