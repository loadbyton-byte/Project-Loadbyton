// Payment processor integration smoke suite (TODO-3). Runs the REAL server
// in PAYMENTS_PROVIDER=mock mode — the same code paths a live processor
// (telr) uses, with an in-process ledger and signature-verified webhooks.
// Confirms:
//   - award marks the job REQUIRES_PAYMENT (escrow stays HELD)
//   - the shipper checkout endpoint is idempotent per job
//   - the webhook rejects bad signatures without touching state
//   - an AUTHORISED webhook funds escrow exactly once (replays are no-ops)
//   - release auto-executes the carrier payout (no manual admin step)
//   - a dispute REFUND_SHIPPER refunds the charge via the processor
// See docs/PAYMENTS.md for the mode matrix and how to point this at the
// real Telr sandbox.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, makeClient } = require('./harness');

const WEBHOOK_SECRET = 'test-webhook-secret';

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

async function sendWebhook(baseUrl, payload) {
  const raw = JSON.stringify(payload);
  return fetch(`${baseUrl}/api/webhooks/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-payments-signature': hmac(WEBHOOK_SECRET, raw),
    },
    body: raw,
  });
}

async function createAwardedJob(shipper, carrier, overrides = {}) {
  const created = await shipper.post('/api/jobs', {
    containerSize: '40FT',
    containerType: 'DRY',
    pickupTerminal: 'JEBEL_ALI_T2',
    deliveryArea: 'JAFZA_SOUTH',
    deliveryAddress: 'Test Warehouse 1',
    readyAt: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    maxBudgetAed: 700, // legacy field name — accepted, mapped to max_budget_aed
    ...overrides,
  });
  assert.equal(created.status, 201, created.raw);
  const jobId = created.body.job.id;

  const bidRes = await carrier.post(`/api/jobs/${jobId}/bids`, {
    amountAed: 650, etaMinutes: 40, truckType: '3-axle flatbed',
  });
  assert.equal(bidRes.status, 201, bidRes.raw);

  const award = await shipper.post(`/api/jobs/${jobId}/award`, { bidId: bidRes.body.bid.id });
  assert.equal(award.status, 200, award.raw);
  // The driver is not bound at bid/award time anymore — the carrier submits
  // them post-award (PATCH /api/jobs/:id/driver), required before PICKED_UP.
  assert.equal(award.body.job.assigned_driver_name, null);
  return { jobId, award };
}

let server;

test.before(async () => {
  server = await startServer({
    PAYMENTS_PROVIDER: 'mock',
    PAYMENTS_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
});

test.after(async () => {
  await server.stop();
});

test('health reports mock payment provider', async () => {
  const res = await fetch(`${server.baseUrl}/api/health`);
  const body = await res.json();
  assert.equal(body.payments.provider, 'mock');
  assert.equal(body.payments.configured, true);
  assert.equal(body.payments.testMode, true);
});

test('award marks the job REQUIRES_PAYMENT and checkout is idempotent', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const { jobId, award } = await createAwardedJob(shipper, carrier);
  assert.equal(award.body.job.escrow_status, 'HELD');
  assert.equal(award.body.job.processor_payment_status, 'REQUIRES_PAYMENT');

  // Checkout returns the mock ref; a second call reuses the same ref.
  const checkout = await shipper.post(`/api/jobs/${jobId}/payment-checkout`, {});
  assert.equal(checkout.status, 200, checkout.raw);
  assert.ok(checkout.body.ref.startsWith('lb_'), 'payment ref must be ours (lb_ prefix)');
  const ref = checkout.body.ref;

  const checkout2 = await shipper.post(`/api/jobs/${jobId}/payment-checkout`, {});
  assert.equal(checkout2.status, 200, checkout2.raw);
  assert.equal(checkout2.body.ref, ref, 'checkout must be idempotent per job');

  // Unauthenticated / non-owner shipper must not be able to create checkouts.
  const stranger = makeClient(server.baseUrl);
  await stranger.login('carrier@dubaidrayage.com', 'demo1234');
  const forbidden = await stranger.post(`/api/jobs/${jobId}/payment-checkout`, {});
  assert.equal(forbidden.status, 403, 'non-owner must not create a checkout');

  const job = (await shipper.get(`/api/jobs/${jobId}`)).body.job;
  assert.equal(job.processor_payment_ref, ref);
  assert.equal(job.escrow_status, 'HELD', 'escrow must stay HELD until payment is confirmed');
});

test('webhook rejects a bad signature and ignores unknown refs without state change', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const { jobId } = await createAwardedJob(shipper, carrier);
  await shipper.post(`/api/jobs/${jobId}/payment-checkout`, {});

  const badSig = await fetch(`${server.baseUrl}/api/webhooks/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-payments-signature': 'deadbeef' },
    body: JSON.stringify({ event: 'AUTHORISED', ref: 'anything' }),
  });
  assert.equal(badSig.status, 401, 'a bad signature must be rejected');

  const unknownRef = await sendWebhook(server.baseUrl, { event: 'AUTHORISED', ref: 'lb_does_not_exist', tranref: 'x' });
  assert.equal(unknownRef.status, 200);
  assert.equal((await unknownRef.json()).ok, false);

  const job = (await shipper.get(`/api/jobs/${jobId}`)).body.job;
  assert.equal(job.escrow_status, 'HELD');
  assert.equal(job.processor_payment_status, 'REQUIRES_PAYMENT');
});

test('AUTHORISED webhook funds escrow exactly once; replays are idempotent', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');

  const { jobId } = await createAwardedJob(shipper, carrier);
  const checkout = await shipper.post(`/api/jobs/${jobId}/payment-checkout`, {});
  const ref = checkout.body.ref;

  const first = await sendWebhook(server.baseUrl, { event: 'AUTHORISED', ref, tranref: 'mcktran-1', amount_aed: 650 });
  assert.equal(first.status, 200, first.raw);

  const funded = (await shipper.get(`/api/jobs/${jobId}`)).body.job;
  assert.equal(funded.escrow_status, 'FUNDED', 'AUTHORISED must flip escrow HELD -> FUNDED');
  assert.equal(funded.processor_payment_status, 'PAID');
  assert.equal(funded.processor_tranref, 'mcktran-1');

  // Replay of the same event must be acknowledged, not double-applied.
  const replay = await sendWebhook(server.baseUrl, { event: 'AUTHORISED', ref, tranref: 'mcktran-1', amount_aed: 650 });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).idempotent, true);

  const stillFunded = (await shipper.get(`/api/jobs/${jobId}`)).body.job;
  assert.equal(stillFunded.escrow_status, 'FUNDED');
  assert.equal(stillFunded.processor_tranref, 'mcktran-1');

  // A DECLINED event after payment must NOT un-fund the job.
  const lateDecline = await sendWebhook(server.baseUrl, { event: 'DECLINED', ref, amount_aed: 650 });
  assert.equal(lateDecline.status, 200);
  const afterDecline = (await shipper.get(`/api/jobs/${jobId}`)).body.job;
  assert.equal(afterDecline.escrow_status, 'FUNDED');
  assert.equal(afterDecline.processor_payment_status, 'PAID');
});

test('full loop: paid -> delivered -> completed auto-executes the carrier payout', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');

  const { jobId } = await createAwardedJob(shipper, carrier);
  const ref = (await shipper.post(`/api/jobs/${jobId}/payment-checkout`, {})).body.ref;
  await sendWebhook(server.baseUrl, { event: 'AUTHORISED', ref, tranref: 'mcktran-2', amount_aed: 650 });

  await carrier.patch(`/api/jobs/${jobId}/driver`, { driverName: 'Hamdan Youssef', driverPhone: '+971501112233' });
  const pickedUp = await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'PICKED_UP' });
  assert.equal(pickedUp.status, 200, 'PICKED_UP requires the post-award driver to be on file');
  await carrier.patch(`/api/jobs/${jobId}/status`, { status: 'IN_TRANSIT' });
  await carrier.post(`/api/jobs/${jobId}/pod`, {});
  const completed = await shipper.patch(`/api/jobs/${jobId}/status`, { status: 'COMPLETED' });
  assert.equal(completed.status, 200, completed.raw);
  assert.equal(completed.body.job.escrow_status, 'RELEASED');

  // Processor payout executes automatically — no manual admin step.
  await new Promise((r) => setTimeout(r, 300)); // payout is fire-and-forget
  const sla = await admin.get('/api/admin/payouts-sla');
  const pending = sla.body.pending.find((p) => p.job_id === jobId);
  assert.ok(!pending, 'a processor-executed payout must not appear as outstanding in the SLA view');

  const payouts = await carrier.get('/api/earnings');
  const payout = payouts.body.payouts.find((p) => p.job_id === jobId);
  assert.ok(payout, 'payout row must exist');
  assert.equal(payout.processor_payout_status, 'SENT');
  assert.ok(payout.transfer_executed_at, 'transfer_executed_at must be set by the processor execution');
  assert.match(payout.transfer_reference, /^processor:/, 'transfer_reference must record the processor movement');
});

test('dispute REFUND_SHIPPER refunds the paid charge via the processor', async () => {
  const shipper = makeClient(server.baseUrl);
  await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  const carrier = makeClient(server.baseUrl);
  await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  const admin = makeClient(server.baseUrl);
  await admin.login('admin@loadbyton.ae', 'demo1234');

  const { jobId } = await createAwardedJob(shipper, carrier);
  const ref = (await shipper.post(`/api/jobs/${jobId}/payment-checkout`, {})).body.ref;
  await sendWebhook(server.baseUrl, { event: 'AUTHORISED', ref, tranref: 'mcktran-3', amount_aed: 650 });

  const dispute = await admin.post('/api/admin/disputes', { jobId, reason: 'goods damaged in transit' });
  assert.equal(dispute.status, 201, dispute.raw);

  const resolve = await admin.post(`/api/admin/disputes/${dispute.body.dispute.id}/resolve`, { determination: 'shipper fault', decision: 'REFUND_SHIPPER' });
  assert.equal(resolve.status, 200, resolve.raw);

  await new Promise((r) => setTimeout(r, 300)); // refund is fire-and-forget
  const job = (await shipper.get(`/api/jobs/${jobId}`)).body.job;
  assert.equal(job.escrow_status, 'RELEASED');
  assert.equal(job.processor_payment_status, 'REFUNDED', 'the paid charge must be refunded via the processor');

  // The refund must be on the audit trail (tamper-evident log).
  const audit = await admin.get('/api/admin/audit');
  assert.ok(audit.body.entries.some((e) => e.action === 'REFUND_SHIPPER_EXECUTED' && e.entity_id === jobId), 'refund execution must be audited');
});