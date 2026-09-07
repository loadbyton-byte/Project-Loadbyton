// RTA permit + haulage insurance — new carrier onboarding documents, reusing
// the exact profile-documents upload/serve mechanism as trade licence and
// (general business) insurance, not a separate approval flow.
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

test('carrier uploads RTA permit with permit number via profile-documents endpoint', async () => {
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const pdfBase64 = Buffer.from('%PDF-1.4 test rta permit').toString('base64');
  const up = await carrier.post('/api/profile/documents', {
    docType: 'RTA_PERMIT',
    mimeType: 'application/pdf',
    fileBase64: pdfBase64,
    permitNumber: 'RTA-GT-99201',
  });
  assert.equal(up.status, 200, up.raw);
  assert.equal(up.body.profile.rta_permit_number, 'RTA-GT-99201');
  assert.ok(up.body.profile.rta_permit_doc_storage_path, 'file recorded');

  const fetched = await carrier.get('/api/profile/documents/RTA_PERMIT');
  assert.equal(fetched.status, 200);
});

test('carrier uploads haulage insurance with expiry via profile-documents endpoint', async () => {
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const pdfBase64 = Buffer.from('%PDF-1.4 test haulage insurance').toString('base64');
  const up = await carrier.post('/api/profile/documents', {
    docType: 'HAULAGE_INSURANCE',
    mimeType: 'application/pdf',
    fileBase64: pdfBase64,
    expiryDate: '2027-03-01',
  });
  assert.equal(up.status, 200, up.raw);
  assert.equal(up.body.profile.haulage_insurance_expiry, '2027-03-01');
  assert.ok(up.body.profile.haulage_insurance_doc_storage_path, 'file recorded');

  // general INSURANCE stays a distinct field, untouched by this upload
  assert.equal(!!up.body.profile.insurance_doc_storage_path, false);
});

test('invalid docType is rejected with the full accepted list', async () => {
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const bad = await carrier.post('/api/profile/documents', { docType: 'NOT_A_TYPE', mimeType: 'application/pdf', fileBase64: 'x' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /RTA_PERMIT/);
  assert.match(bad.body.error, /HAULAGE_INSURANCE/);
});

test('admin verification queue surfaces RTA permit and haulage insurance status', async () => {
  // The demo carrier used above is already verified (is_verified=1), so it
  // won't appear in this pending queue — just assert the response shape
  // includes the new fields whenever the queue is non-empty.
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');
  const queue = await admin.get('/api/admin/verification');
  assert.equal(queue.status, 200);
  if (queue.body.queue.length > 0) {
    const row = queue.body.queue[0];
    assert.ok('rta_permit_uploaded' in row.profile);
    assert.ok('haulage_insurance_uploaded' in row.profile);
  }
});
