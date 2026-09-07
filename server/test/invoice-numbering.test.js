// Regression coverage for the invoice-numbering fix: nextInvoiceNumber()
// computes the "next" number from a plain COUNT, not an atomic sequence,
// so two concurrent completions could compute the same candidate number.
// invoices.invoice_number's UNIQUE constraint means a real duplicate can
// never persist, but before this fix a collision meant issueInvoice()'s
// caller silently console.error'd and the job ended up with no invoice at
// all. This test forces a real collision (by pre-inserting a row with the
// exact number nextInvoiceNumber() would compute next) and confirms
// issueInvoice() now retries and still succeeds, with a different number.

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { startServer, makeClient } = require('./harness');

let server;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.stop();
});

test('issueInvoice retries and still succeeds when its computed number collides with an existing invoice', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT',
    containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T1',
    deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Test Warehouse — invoice numbering regression',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 500,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 450, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(bid.status, 201, bid.raw);
  await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id });
  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Test Driver', driverPhone: '0559990000' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  await carrier.post(`/api/jobs/${jobId}/pod`, {});

  // Same SQLite file the running server subprocess uses (WAL mode allows a
  // second connection) — read what nextInvoiceNumber() would compute right
  // now, and pre-insert a fake invoice with exactly that number so the
  // real completion-triggered issueInvoice() call below is guaranteed to
  // collide on its first attempt. Foreign keys are enforced, so the fake
  // invoice needs real, valid job/payout/carrier rows to point at — a
  // second minimal job+payout, distinct from the one under test, seeded
  // directly since this is only here to occupy an invoice_number.
  const direct = new DatabaseSync(server.dbPath);
  const shipperRow = direct.prepare(`SELECT id FROM users WHERE email='shipper@jebelalilogistics.ae'`).get();
  const carrierRow = direct.prepare(`SELECT id FROM users WHERE email='carrier@dubaidrayage.com'`).get();
  const fakeJob = direct.prepare(
    `INSERT INTO jobs (job_code, shipper_id, carrier_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address, ready_at, deadline, status)
     VALUES ('INV-COLLISION-FIXTURE', ?, ?, '20FT', 'DRY', 'JEBEL_ALI_T1', 'AL_QUOZ', 'x', datetime('now'), datetime('now'), 'COMPLETED')`
  ).run(shipperRow.id, carrierRow.id);
  const fakeJobId = Number(fakeJob.lastInsertRowid);
  const fakePayout = direct.prepare(
    `INSERT INTO payouts (job_id, carrier_id, gross_aed, platform_fee_aed, net_aed, status) VALUES (?, ?, 100, 6, 94, 'RELEASED')`
  ).run(fakeJobId, carrierRow.id);
  const fakePayoutId = Number(fakePayout.lastInsertRowid);

  const year = new Date().getUTCFullYear();
  const { c } = direct.prepare(`SELECT COUNT(*) c FROM invoices WHERE invoice_number LIKE ?`).get(`LBT-INV-${year}-%`);
  const collidingNumber = `LBT-INV-${year}-${String(c + 1).padStart(6, '0')}`;
  direct.prepare(
    `INSERT INTO invoices (invoice_number, payout_id, job_id, carrier_id, gross_aed, commission_aed, vat_rate_bps, taxable_aed, vat_aed, total_aed)
     VALUES (?, ?, ?, ?, 100, 6, 500, 5.71, 0.29, 6)`
  ).run(collidingNumber, fakePayoutId, fakeJobId, carrierRow.id);
  direct.close();

  // Completing the job triggers issueInvoice() for real (job.service.js's
  // updateJobStatus, on COMPLETED) — this must now succeed despite the
  // forced collision above, by retrying with a fresh number.
  const completed = await shipper.patch(`/api/jobs/${jobId}/status`, { status: 'COMPLETED' });
  assert.equal(completed.status, 200, completed.raw);

  const invoices = await carrier.get('/api/invoices');
  const invoice = invoices.body.invoices.find((i) => i.job_id === jobId);
  assert.ok(invoice, 'a real invoice must still be issued despite the forced number collision');
  assert.notEqual(invoice.invoice_number, collidingNumber, 'the retried number must differ from the colliding one');
  assert.match(invoice.invoice_number, /^LBT-INV-\d{4}-\d{6}$/);
});
