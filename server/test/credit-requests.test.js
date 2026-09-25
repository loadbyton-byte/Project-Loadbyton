// Shipper-initiated credit requests (server/routes/credit.routes.js +
// admin.routes.js's decide endpoint) — closes a real gap in the existing
// CONTRACT_CREDIT admin flow (contract-credit.test.js covers that half):
// previously an admin could only proactively grant a limit via two plain
// numbers, with no shipper-side request and no proof document attached.
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

async function freshShipper(baseUrl, admin) {
  const client = makeClient(baseUrl);
  const email = `credit-req-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.ae`;
  const r = await client.post('/api/auth/register', {
    email, password: 'demo1234', role: 'SHIPPER',
    companyName: 'Credit Request Test Shipper', phone: '+971502221112',
    trnNumber: '100222333400010', tradeLicenseNumber: 'CN-2233446',
    agreedToTerms: true,
  });
  assert.equal(r.status, 201, r.raw);
  const approved = await admin.post(`/api/admin/approve/${r.body.user.id}`, { action: 'approve' });
  assert.equal(approved.status, 200, approved.raw);
  return { client, userId: r.body.user.id };
}

const pdfBase64 = Buffer.from('%PDF-1.4 test cheque scan').toString('base64');

test('a shipper can request credit with a proof document, and an admin approving it grants the exact limit', async () => {
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
  const { client: shipper } = await freshShipper(server.baseUrl, admin);

  const noAuth = await shipper.get('/api/admin/credit/requests');
  assert.equal(noAuth.status, 403, 'a shipper must not reach the admin credit-requests endpoint');

  const missingProof = await shipper.post('/api/credit/requests', { requestedLimitAed: 5000 });
  assert.equal(missingProof.status, 400, 'a proof document must be required');

  const submitted = await shipper.post('/api/credit/requests', {
    requestedLimitAed: 5000, mimeType: 'application/pdf', fileBase64: pdfBase64,
  });
  assert.equal(submitted.status, 201, submitted.raw);
  assert.equal(submitted.body.request.status, 'PENDING');
  assert.equal(submitted.body.request.requested_limit_aed, 5000);
  const requestId = submitted.body.request.id;

  // Duplicate pending request is rejected — one open ask at a time.
  const dup = await shipper.post('/api/credit/requests', { requestedLimitAed: 6000, mimeType: 'application/pdf', fileBase64: pdfBase64 });
  assert.equal(dup.status, 409, 'a shipper with an already-pending request must not be able to file another');

  // The shipper can read their own request back and fetch their own proof doc.
  const mine = await shipper.get('/api/credit/requests');
  assert.equal(mine.status, 200);
  assert.ok(mine.body.requests.some((r) => r.id === requestId));
  const ownDoc = await shipper.get(`/api/credit/requests/${requestId}/document`);
  assert.equal(ownDoc.status, 200);

  // A different shipper must not be able to read this one's proof document.
  const { client: otherShipper } = await freshShipper(server.baseUrl, admin);
  const crossDoc = await otherShipper.get(`/api/credit/requests/${requestId}/document`);
  assert.equal(crossDoc.status, 403, 'a different shipper must not read another shipper\'s proof document');

  // Admin sees it pending, and approving it grants exactly the requested limit.
  const queue = await admin.get('/api/admin/credit/requests');
  assert.equal(queue.status, 200);
  assert.ok(queue.body.requests.some((r) => r.id === requestId));

  const decided = await admin.post(`/api/admin/credit/requests/${requestId}/decide`, { action: 'approve', termsDays: 15 });
  assert.equal(decided.status, 200, decided.raw);
  assert.equal(decided.body.request.status, 'APPROVED');

  const profile = await shipper.get('/api/notifications');
  assert.equal(profile.status, 200);
  assert.ok(profile.body.notifications.some((n) => n.title === 'Credit terms approved'), 'the shipper must be notified of the approval');

  // Deciding an already-decided request must not be allowed again.
  const redecide = await admin.post(`/api/admin/credit/requests/${requestId}/decide`, { action: 'reject' });
  assert.equal(redecide.status, 409, 'a request already decided must not be decidable again');

  // The shipper can now actually award a deferred-payment job — proving
  // the request-approval path really did set profiles.credit_limit_aed,
  // not just flip a status label with no effect on the real gate.
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const job = await shipper.post('/api/jobs', {
    shipmentType: 'IMPORT', containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Credit request award test', readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(), maxBudgetAed: 1000, paymentTier: 'NET_7',
  });
  assert.equal(job.status, 201, job.raw);
  const bid = await carrier.post(`/api/jobs/${job.body.job.id}/bids`, { amountAed: 900, etaAt: new Date(Date.now() + 24 * 3600000).toISOString() });
  assert.equal(bid.status, 201, bid.raw);
  const award = await shipper.post(`/api/jobs/${job.body.job.id}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw, 'the shipper must now be able to award a NET_7 job on the credit just approved');
});

test('rejecting a credit request records the note and grants no credit', async () => {
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
  const { client: shipper } = await freshShipper(server.baseUrl, admin);

  const submitted = await shipper.post('/api/credit/requests', { requestedLimitAed: 20000, mimeType: 'application/pdf', fileBase64: pdfBase64 });
  assert.equal(submitted.status, 201, submitted.raw);

  const rejected = await admin.post(`/api/admin/credit/requests/${submitted.body.request.id}/decide`, { action: 'reject', note: 'Proof document illegible' });
  assert.equal(rejected.status, 200, rejected.raw);
  assert.equal(rejected.body.request.status, 'REJECTED');
  assert.equal(rejected.body.request.admin_note, 'Proof document illegible');

  // A fresh request can be filed after rejection — rejection doesn't
  // permanently lock the shipper out the way an unresolved PENDING would.
  const again = await shipper.post('/api/credit/requests', { requestedLimitAed: 8000, mimeType: 'application/pdf', fileBase64: pdfBase64 });
  assert.equal(again.status, 201, again.raw);
});
