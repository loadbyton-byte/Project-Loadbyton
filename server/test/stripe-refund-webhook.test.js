// Financial-audit finding: POST /api/webhooks/stripe had zero handler for
// charge.refunded — a refund Stripe reports that our own app state hasn't
// already recorded (e.g. issued directly from the Stripe dashboard, or a
// partial/support-initiated refund) left escrow_status/processor_payment_status
// silently stale, showing money as still HELD/FUNDED/RELEASED when it had
// already left the platform's Stripe balance. Fixed by freezing the job
// (mirroring the existing charge.dispute.created "freeze + notify admin"
// pattern) whenever the webhook reports a refund our own records don't
// already reflect.
//
// constructWebhookEvent's signature check is pure local HMAC verification
// against STRIPE_WEBHOOK_SECRET — it never calls Stripe's network API, so a
// fake STRIPE_SECRET_KEY is enough to exercise this route in tests via the
// real `stripe` SDK's own test-header generator.

const test = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const { startServer, makeClient } = require('./harness');

const STRIPE_WEBHOOK_SECRET = 'whsec_test_regress_1234';
const stripeForSigning = Stripe('sk_test_fake_for_signing_only');

function signedWebhookBody(payload) {
  const body = JSON.stringify(payload);
  const header = stripeForSigning.webhooks.generateTestHeaderString({ payload: body, secret: STRIPE_WEBHOOK_SECRET });
  return { body, header };
}

async function sendStripeWebhook(baseUrl, payload) {
  const { body, header } = signedWebhookBody(payload);
  return fetch(`${baseUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': header },
    body,
  });
}

let server;

test.before(async () => {
  server = await startServer({
    STRIPE_SECRET_KEY: 'sk_test_fake_server_key',
    STRIPE_WEBHOOK_SECRET,
  });
});

test.after(async () => {
  await server.stop();
});

async function createAwardedJob(shipper, carrier) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Stripe refund webhook regression test',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;
  const bid = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 500, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed',
  });
  assert.equal(bid.status, 201, bid.raw);
  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bid.body.bid.id, skipNegotiation: true });
  assert.equal(award.status, 200, award.raw);
  return jobId;
}

test('an unrecognized Stripe charge.refunded event freezes escrow for manual review', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');

  const jobId = await createAwardedJob(shipper, carrier);

  const { DatabaseSync } = require('node:sqlite');
  const rawDb = new DatabaseSync(server.dbPath);
  rawDb.prepare(`UPDATE jobs SET processor_payment_ref=?, processor_payment_status='PAID' WHERE id=?`).run('pi_test_unrecognized_refund', jobId);
  rawDb.close();

  const res = await sendStripeWebhook(server.baseUrl, {
    id: 'evt_test_refund_1',
    type: 'charge.refunded',
    data: { object: { id: 'ch_test_1', payment_intent: 'pi_test_unrecognized_refund', amount_refunded: 50000 } },
  });
  assert.equal(res.status, 200, await res.text());

  const job = (await shipper.get(`/api/jobs/${jobId}`)).body.job;
  assert.equal(job.status, 'DISPUTED', 'a refund our own records did not already apply must freeze the job');
  assert.equal(job.escrow_status, 'DISPUTED');

  const audit = await admin.get('/api/admin/audit');
  assert.ok(
    audit.body.entries.some((e) => e.action === 'UNRECOGNIZED_REFUND' && e.entity_id === jobId),
    'the unrecognized refund must be on the audit trail'
  );
});

test('a charge.refunded event that only confirms our OWN already-recorded refund is a no-op', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const jobId = await createAwardedJob(shipper, carrier);

  const { DatabaseSync } = require('node:sqlite');
  const rawDb = new DatabaseSync(server.dbPath);
  // Simulate our own refund flow (payout.service.js's refundJobAsync) having
  // already recorded this refund before Stripe's webhook confirmation lands.
  rawDb.prepare(`UPDATE jobs SET processor_payment_ref=?, processor_payment_status='REFUNDED', escrow_status='RELEASED', status='COMPLETED' WHERE id=?`).run('pi_test_own_refund', jobId);
  rawDb.close();

  const res = await sendStripeWebhook(server.baseUrl, {
    id: 'evt_test_refund_2',
    type: 'charge.refunded',
    data: { object: { id: 'ch_test_2', payment_intent: 'pi_test_own_refund', amount_refunded: 50000 } },
  });
  assert.equal(res.status, 200, await res.text());

  const job = (await shipper.get(`/api/jobs/${jobId}`)).body.job;
  assert.equal(job.status, 'COMPLETED', 'a refund we already recorded ourselves must not be re-frozen');
  assert.equal(job.escrow_status, 'RELEASED');
});
