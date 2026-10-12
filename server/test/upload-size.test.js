// File uploads are base64-in-JSON. The web client allows files up to 5 MB
// (web/src/lib/upload.js MAX_UPLOAD_BYTES), which is ~6.7 MB encoded — but the
// global JSON limit is 2 MB, so a 2-5 MB packing list/POD/licence passed client
// validation and then failed with "request entity too large", typically after
// the job it was attached to had already been posted.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, makeClient } = require('./harness');

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server.stop(); });

const pdfBase64 = (mb) => Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(Math.floor(mb * 1024 * 1024))]).toString('base64');

test('a 4.5 MB PDF (allowed by the UI) uploads to a job instead of failing with 413', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const job = await shipper.post('/api/jobs', {
    shipmentType: 'IMPORT', containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'Jebel Ali', deliveryArea: 'DIP',
    readyAt: new Date(Date.now() + 5 * 3600000).toISOString(), deadline: new Date(Date.now() + 53 * 3600000).toISOString(),
  });
  assert.equal(job.status, 201, job.raw);
  const doc = await shipper.post(`/api/jobs/${job.body.job.id}/documents`, { title: 'Packing list', docType: 'PACKING_LIST', mimeType: 'application/pdf', fileBase64: pdfBase64(4.5) });
  assert.equal(doc.status, 201, doc.raw);
});

test('the larger body limit applies only to upload routes — an oversized body elsewhere is still refused', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const res = await shipper.post('/api/jobs', {
    shipmentType: 'IMPORT', containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'Jebel Ali', deliveryArea: 'DIP',
    readyAt: new Date(Date.now() + 5 * 3600000).toISOString(), deadline: new Date(Date.now() + 53 * 3600000).toISOString(),
    notes: 'x'.repeat(3 * 1024 * 1024),
  });
  assert.equal(res.status, 413);
});
