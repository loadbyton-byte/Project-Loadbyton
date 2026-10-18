// Premium membership purchase: pricing, VAT, order creation, and the
// idempotent application of a confirmed payment to a subscription.
//
// Pricing decision (owner, 18 Oct 2026): affordable flat membership,
// AED 199 per month or AED 1,990 per year (two months free), excluding
// UAE VAT. Plan versions are immutable once published; a price change is a
// new version.

'use strict';

const crypto = require('node:crypto');
const db = require('../../db');
const payments = require('../payments');
const C = require('./constants');
const E = require('./entitlements');

const iso = (d = new Date()) => new Date(d).toISOString();

const PLAN_CODE = 'premium';
const SEED = [
  { billing: 'monthly', name: 'Premium Monthly', priceMinor: 19900 },
  { billing: 'annual', name: 'Premium Annual', priceMinor: 199000 },
];
const TAX_NOTE = 'Prices are in UAE dirhams and exclude value added tax. UAE VAT is added at checkout and shown before you pay.';
const CANCEL_TERMS = 'Cancel any time. Premium and Enterprise Included continue to the end of the period you have paid for, then your company returns to Starter Included. Your data is kept. A first payment is refundable within 14 days if no unusual use has occurred; renewals are not refundable once the period has started.';
const BENEFIT_TERMS = 'Upgrades Business OS (loadbyton.store) from Starter Included to Enterprise Included while Premium is active. Limits are plan ceilings, not guaranteed provider-funded usage; external usage, provider fees and managed services are quoted separately.';

function vatBps() {
  const n = Number(process.env.VAT_BPS);
  return Number.isInteger(n) && n >= 0 && n <= 2500 ? n : 500;
}

// Net + VAT in minor units. VAT rounds half away from zero on the whole order.
function priced(netMinor, bps = vatBps()) {
  const vat = Math.round((netMinor * bps) / 10000);
  return { netMinor, vatMinor: vat, totalMinor: netMinor + vat, vatBps: bps };
}

async function seedPlans() {
  const have = await db.prepare('SELECT COUNT(*) AS n FROM premium_plan_versions WHERE plan_code=?').get(PLAN_CODE);
  if (Number(have.n) > 0) return false;
  for (const p of SEED) {
    await db.prepare(
      `INSERT INTO premium_plan_versions (plan_code, version, name, billing_period, price_minor, currency, tax_note, cancellation_terms, benefit_terms, is_published)
       VALUES (?,?,?,?,?,?,?,?,?,1)`)
      .run(PLAN_CODE, p.billing === 'monthly' ? 1 : 2, p.name, p.billing, p.priceMinor, 'AED', TAX_NOTE, CANCEL_TERMS, BENEFIT_TERMS);
  }
  return true;
}

// Checkout opens only when staff switch it on AND a real provider is
// configured. The mock provider never opens it in production.
function checkoutState() {
  if (process.env.PREMIUM_CHECKOUT_ENABLED !== 'true') return { open: false, reason: 'not_enabled' };
  if (!payments.isConfigured()) return { open: false, reason: 'provider_not_configured' };
  if (payments.provider() === 'mock' && process.env.NODE_ENV === 'production') return { open: false, reason: 'mock_provider_in_production' };
  return { open: true, reason: null, provider: payments.provider() };
}

function periodEndFrom(start, billing) {
  const d = new Date(start);
  if (billing === 'annual') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

function newRef() { return `PREM-${crypto.randomBytes(9).toString('hex')}`; }

async function createOrder({ org, userId, plan, returnUrls }) {
  const money = priced(Number(plan.price_minor));
  const ref = newRef();
  const r = await db.prepare(
    `INSERT INTO premium_orders (organisation_id, user_id, plan_version_id, status, net_minor, vat_minor, total_minor, currency, vat_bps, payment_ref, provider, terms_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
    .run(org.id, userId, plan.id, 'CREATED', money.netMinor, money.vatMinor, money.totalMinor, plan.currency, money.vatBps, ref, payments.provider(), C.TERMS_VERSION);
  const id = Number(r.lastInsertRowid);
  const checkout = await payments.createCheckoutOrder({
    jobCode: `PREMIUM-${id}`, amountAed: money.totalMinor / 100, currency: plan.currency,
    description: `Loadbyton ${plan.name} (incl. VAT)`, returnUrls, paymentRef: ref,
  });
  if (!checkout.ok) {
    await db.prepare("UPDATE premium_orders SET status='FAILED' WHERE id=?").run(id);
    return { ok: false, error: checkout.error || 'checkout_failed', id };
  }
  return { ok: true, id, ref, url: checkout.url || null, mock: !!checkout.mock, money };
}

async function nextReceiptNo() {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM premium_orders WHERE receipt_no IS NOT NULL').get();
  const year = new Date().getUTCFullYear();
  return `LBT-PR-${year}-${String(Number(row.n) + 1).padStart(6, '0')}`;
}

// Applies a provider event for a PREM- reference. Idempotent: a replayed
// AUTHORISED never extends the period twice (the order row is the lock).
async function applyPaymentEvent({ ref, event, tranref, amountAed }) {
  const order = await db.prepare('SELECT * FROM premium_orders WHERE payment_ref=?').get(ref);
  if (!order) return { ok: false, reason: 'unknown_ref' };
  if (event === 'DECLINED' || event === 'CANCELLED') {
    if (order.status === 'CREATED') await db.prepare("UPDATE premium_orders SET status=? WHERE id=? AND status='CREATED'").run(event === 'DECLINED' ? 'FAILED' : 'CANCELLED', order.id);
    return { ok: true, status: event };
  }
  if (event === 'REFUNDED') {
    await db.prepare("UPDATE premium_orders SET status='REFUNDED' WHERE id=?").run(order.id);
    return { ok: true, status: 'REFUNDED' };
  }
  if (event !== 'AUTHORISED') return { ok: false, reason: 'unknown_event' };
  if (order.status === 'PAID') return { ok: true, idempotent: true, status: 'PAID' };
  // The amount the provider took must match the order total; anything else is held for staff.
  if (amountAed != null && Math.round(Number(amountAed) * 100) !== Number(order.total_minor)) {
    await db.prepare("UPDATE premium_orders SET status='AMOUNT_MISMATCH', tranref=? WHERE id=?").run(tranref || null, order.id);
    return { ok: false, reason: 'amount_mismatch' };
  }
  const lock = await db.prepare("UPDATE premium_orders SET status='PAID', tranref=?, paid_at=? WHERE id=? AND status IN ('CREATED','FAILED','CANCELLED')")
    .run(tranref || null, iso(), order.id);
  if (!lock.changes) return { ok: true, idempotent: true, status: 'PAID' };
  const plan = await db.prepare('SELECT * FROM premium_plan_versions WHERE id=?').get(order.plan_version_id);
  const sourceRef = `premium-order-${order.id}`;
  // Renewal extends from the later of now and the current period end.
  const existing = await db.prepare(
    `SELECT s.* FROM org_subscriptions s JOIN premium_plan_versions p ON p.id=s.plan_version_id
      WHERE s.organisation_id=? AND p.plan_code=? AND s.status IN ('ACTIVE','CANCELLED','PAYMENT_FAILED') ORDER BY s.id DESC LIMIT 1`).get(order.organisation_id, plan.plan_code);
  let subId;
  if (existing && new Date(existing.period_end) > new Date(Date.now() - C.GRACE_DAYS * 86400000)) {
    const base = new Date(Math.max(Date.now(), new Date(existing.period_end).getTime()));
    const end = periodEndFrom(base, plan.billing_period);
    await db.prepare("UPDATE org_subscriptions SET status='ACTIVE', period_end=?, grace_until=NULL, cancelled_at=NULL, last_renewal_ref=?, plan_version_id=? WHERE id=?")
      .run(iso(end), sourceRef, plan.id, existing.id);
    subId = existing.id;
  } else {
    const start = new Date();
    const r = await db.prepare(
      `INSERT INTO org_subscriptions (organisation_id, plan_version_id, status, period_start, period_end, source, source_ref) VALUES (?,?,?,?,?,?,?) RETURNING id`)
      .run(order.organisation_id, plan.id, 'ACTIVE', iso(start), iso(periodEndFrom(start, plan.billing_period)), 'checkout', sourceRef);
    subId = Number(r.lastInsertRowid);
  }
  await db.prepare('UPDATE premium_orders SET subscription_id=?, receipt_no=? WHERE id=?').run(subId, await nextReceiptNo(), order.id);
  const rec = await E.reconcile(order.organisation_id);
  return { ok: true, status: 'PAID', subscriptionId: subId, entitlement: rec.grant ? rec.grant.plan_code : null };
}

function receiptOf(o) {
  return {
    id: o.id, receiptNo: o.receipt_no, status: o.status, planName: o.plan_name, billingPeriod: o.billing_period, currency: o.currency,
    netMinor: Number(o.net_minor), vatMinor: Number(o.vat_minor), totalMinor: Number(o.total_minor), vatBps: Number(o.vat_bps),
    paidAt: o.paid_at, createdAt: o.created_at, termsVersion: o.terms_version,
  };
}

module.exports = { PLAN_CODE, TAX_NOTE, vatBps, priced, seedPlans, checkoutState, periodEndFrom, createOrder, applyPaymentEvent, receiptOf };
