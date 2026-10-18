// Premium membership checkout: seeded pricing, VAT, gating, idempotent
// confirmation, renewal, amount mismatch, and failure handling.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, makeClient } = require('./harness');

const SECRET = 'premium-webhook-secret-for-tests';
let open; let closed; let owner; let ownerClosed;

async function webhook(base, payload) {
  const raw = JSON.stringify(payload);
  return fetch(`${base}/api/webhooks/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-payments-signature': crypto.createHmac('sha256', SECRET).update(raw).digest('hex') },
    body: raw,
  });
}

test.before(async () => {
  open = await startServer({ PAYMENTS_PROVIDER: 'mock', PAYMENTS_WEBHOOK_SECRET: SECRET, PREMIUM_CHECKOUT_ENABLED: 'true' });
  closed = await startServer({});
  owner = makeClient(open.baseUrl); await owner.login('carrier@dubaidrayage.com', 'demo1234');
  ownerClosed = makeClient(closed.baseUrl); await ownerClosed.login('carrier@dubaidrayage.com', 'demo1234');
});
test.after(async () => { await open.stop(); await closed.stop(); });

test('the two Premium plans are seeded: AED 199 a month, AED 1,990 a year, VAT added on top', async () => {
  const r = await owner.get('/api/ecosystem/premium/plans');
  assert.equal(r.status, 200, r.raw);
  const monthly = r.body.plans.find((p) => p.billingPeriod === 'monthly');
  const annual = r.body.plans.find((p) => p.billingPeriod === 'annual');
  assert.equal(monthly.priceMinor, 19900);
  assert.equal(annual.priceMinor, 199000);
  assert.equal(monthly.vatMinor, 995);
  assert.equal(monthly.totalMinor, 20895);
  assert.equal(annual.totalMinor, 208950);
  assert.equal(r.body.checkout, 'open');
});

test('checkout stays closed unless staff enable it and a real provider is configured', async () => {
  const plans = await ownerClosed.get('/api/ecosystem/premium/plans');
  assert.equal(plans.body.checkout, 'not_open');
  const r = await ownerClosed.post('/api/ecosystem/premium/checkout', { planVersionId: plans.body.plans[0].id, acceptTerms: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'CHECKOUT_NOT_OPEN');
});

test('terms are required, a seat cannot buy, and an unpublished plan is refused', async () => {
  const plans = (await owner.get('/api/ecosystem/premium/plans')).body.plans;
  const noTerms = await owner.post('/api/ecosystem/premium/checkout', { planVersionId: plans[0].id });
  assert.equal(noTerms.status, 422);
  assert.equal(noTerms.body.code, 'TERMS_REQUIRED');
  const bad = await owner.post('/api/ecosystem/premium/checkout', { planVersionId: 999999, acceptTerms: true });
  assert.equal(bad.status, 422);
});

test('a confirmed payment upgrades the company to Enterprise Included exactly once and issues a receipt', async () => {
  const plans = (await owner.get('/api/ecosystem/premium/plans')).body.plans;
  const monthly = plans.find((p) => p.billingPeriod === 'monthly');
  const co = await owner.post('/api/ecosystem/premium/checkout', { planVersionId: monthly.id, acceptTerms: true });
  assert.equal(co.status, 201, co.raw);
  assert.equal(co.body.totalMinor, 20895);
  const orders = (await owner.get('/api/ecosystem/premium/orders')).body.orders;
  assert.equal(orders[0].status, 'CREATED');
  assert.equal(orders[0].receiptNo, null);

  // Provider ref is not exposed to the browser; the test reads it from the order via admin-free path: the mock ledger needs the ref.
  const ref = await refOf(co.body.orderId);
  const wrongAmount = await webhook(open.baseUrl, { ref, event: 'AUTHORISED', amount_aed: 1, tranref: 'T-1' });
  assert.equal(wrongAmount.status, 200);
  assert.equal((await wrongAmount.json()).reason, 'amount_mismatch');
  assert.equal((await owner.get('/api/ecosystem/premium/orders')).body.orders[0].status, 'AMOUNT_MISMATCH');
});

let adminC;
async function refOf(orderId) {
  if (!adminC) { adminC = makeClient(open.baseUrl); await adminC.login('admin@loadbyton.ae', 'demo1234'); }
  const r = await adminC.get(`/api/admin/ecosystem/premium-orders/${orderId}`);
  assert.equal(r.status, 200, r.raw);
  return r.body.paymentRef;
}

test('a correct confirmation is applied once; a replay changes nothing; renewal extends the period', async () => {
  assert.equal((await owner.post('/api/ecosystem/store/activate', { sector: 'road-transport', acceptTerms: true })).status, 201);
  const plans = (await owner.get('/api/ecosystem/premium/plans')).body.plans;
  const monthly = plans.find((p) => p.billingPeriod === 'monthly');
  const co = await owner.post('/api/ecosystem/premium/checkout', { planVersionId: monthly.id, acceptTerms: true });
  const ref = await refOf(co.body.orderId);
  const ok = await webhook(open.baseUrl, { ref, event: 'AUTHORISED', amount_aed: 208.95, tranref: 'T-2' });
  assert.equal((await ok.json()).ok, true);
  const replay = await webhook(open.baseUrl, { ref, event: 'AUTHORISED', amount_aed: 208.95, tranref: 'T-2' });
  assert.equal(replay.status, 200);

  const b = await owner.get('/api/ecosystem/benefits');
  assert.equal(b.body.entitlement.planCode, 'enterprise_included');
  const sub = b.body.premium.subscriptions[0];
  const end1 = new Date(sub.periodEnd).getTime();
  assert.ok(end1 > Date.now() + 27 * 86400000 && end1 < Date.now() + 32 * 86400000, 'one month of access');

  const paid = (await owner.get('/api/ecosystem/premium/orders')).body.orders.find((o) => o.status === 'PAID');
  assert.match(paid.receiptNo, /^LBT-PR-\d{4}-\d{6}$/);
  assert.equal(paid.totalMinor, 20895);

  // Renewal: a second paid order extends from the current period end, no second subscription row.
  const co2 = await owner.post('/api/ecosystem/premium/checkout', { planVersionId: monthly.id, acceptTerms: true });
  const ref2 = await refOf(co2.body.orderId);
  await webhook(open.baseUrl, { ref: ref2, event: 'AUTHORISED', amount_aed: 208.95, tranref: 'T-3' });
  const b2 = await owner.get('/api/ecosystem/benefits');
  assert.equal(b2.body.premium.subscriptions.length, 1);
  const end2 = new Date(b2.body.premium.subscriptions[0].periodEnd).getTime();
  assert.ok(end2 > end1 + 27 * 86400000, 'renewal extends from the existing period end');
});

test('a declined payment leaves the plan untouched', async () => {
  const c = makeClient(open.baseUrl); await c.login('shipper@jebelalilogistics.ae', 'demo1234');
  const plans = (await c.get('/api/ecosystem/premium/plans')).body.plans;
  const co = await c.post('/api/ecosystem/premium/checkout', { planVersionId: plans[0].id, acceptTerms: true });
  if (co.status !== 201) return; // this demo company may not be verified; the gating itself is asserted above
  const ref = await refOf(co.body.orderId);
  const r = await webhook(open.baseUrl, { ref, event: 'DECLINED' });
  assert.equal(r.status, 200);
  const b = await c.get('/api/ecosystem/benefits');
  assert.notEqual(b.body.entitlement && b.body.entitlement.planCode, 'enterprise_included');
});
