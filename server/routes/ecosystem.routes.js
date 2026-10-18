// Company-facing and admin endpoints for the ecosystem layer: organisation
// identity, Store benefits, Store activation, premium plans/subscriptions and
// the signed read the Store uses to reconcile missed events.

'use strict';

const express = require('express');
const db = require('../db');
const { sendError, asyncHandler } = require('../lib/http');
const { writeAudit } = require('../lib/helpers');
const { auth } = require('../middleware/auth');
const C = require('../lib/ecosystem/constants');
const E = require('../lib/ecosystem/entitlements');
const { verify } = require('../lib/ecosystem/signing');
const { deliverPending } = require('../lib/ecosystem/delivery');
const P = require('../lib/ecosystem/premium');
const { timingSafeEqualStr } = require('../lib/helpers');

const router = express.Router();
const COMPANY = ['SHIPPER', 'CARRIER']; // aliases cover FORWARDER, BROKER, OWNER_OPERATOR

const iso = (d = new Date()) => new Date(d).toISOString();
const storeBase = () => (process.env.STORE_BASE_URL || '').replace(/\/$/, '');

async function benefitsFor(orgCtx) {
  const { org } = orgCtx;
  await E.reconcile(org.id);
  const fresh = await db.prepare('SELECT * FROM organisations WHERE id=?').get(org.id);
  const activation = await db.prepare('SELECT * FROM store_activations WHERE organisation_id=?').get(org.id);
  const grant = await E.latestGrant(org.id);
  const subs = await db.prepare(
    `SELECT s.*, p.plan_code, p.name AS plan_name, p.version, p.billing_period, p.price_minor, p.currency
       FROM org_subscriptions s JOIN premium_plan_versions p ON p.id=s.plan_version_id WHERE s.organisation_id=? ORDER BY s.id DESC`).all(org.id);
  const verified = fresh.verification_status === 'VERIFIED';
  const planCode = grant && grant.plan_code;
  return {
    organisation: { subjectId: fresh.subject_id, name: fresh.name, verification: fresh.verification_status },
    store: {
      activated: !!activation,
      canActivate: verified && !activation,
      blockedReason: !verified ? 'organisation_unverified' : null,
      sector: activation ? activation.sector : null,
      acceptedAt: activation ? activation.accepted_at : null,
      termsVersion: activation ? activation.terms_version : null,
      openUrl: activation && storeBase() ? `${storeBase()}/auth/loadbyton` : null,
    },
    entitlement: grant ? {
      planCode: grant.plan_code, status: grant.status, endsAt: grant.ends_at || null, graceUntil: grant.grace_until || null,
      reason: grant.reason, since: grant.starts_at, version: grant.version,
      limits: planCode ? C.STORE_PLAN_LIMITS[planCode] : null,
    } : null,
    premium: {
      subscriptions: subs.map((s) => ({
        id: s.id, planCode: s.plan_code, planName: s.plan_name, planVersion: s.version, status: s.status,
        periodStart: s.period_start, periodEnd: s.period_end, graceUntil: s.grace_until, cancelledAt: s.cancelled_at,
      })),
    },
    graceDays: C.GRACE_DAYS,
    notes: [
      'Limits are plan ceilings, not guaranteed provider-funded consumption.',
      'External usage, provider fees and managed services are quoted separately.',
    ],
    sectors: C.STORE_SECTORS,
  };
}

router.get('/api/ecosystem/me', auth(COMPANY), asyncHandler(async (req, res) => {
  const ctx = await E.getOrganisationForUser(req.actorId);
  if (!ctx) return sendError(res, 404, 'No organisation for this account');
  res.json({ organisation: { subjectId: ctx.org.subject_id, name: ctx.org.name, verification: ctx.org.verification_status }, orgRole: ctx.orgRole });
}));

router.get('/api/ecosystem/benefits', auth(COMPANY), asyncHandler(async (req, res) => {
  const ctx = await E.getOrganisationForUser(req.actorId);
  if (!ctx) return sendError(res, 404, 'No organisation for this account');
  res.json({ ...(await benefitsFor(ctx)), viewerRole: ctx.orgRole });
}));

router.post('/api/ecosystem/store/activate', auth(COMPANY), asyncHandler(async (req, res) => {
  // Only the company administrator (the account owner, not a seat) may
  // accept terms and create the workspace link.
  if (req.user.actingSeatId) return sendError(res, 403, 'Only the company administrator can activate Business OS', 'OWNER_ONLY');
  const { sector, acceptTerms } = req.body || {};
  if (acceptTerms !== true) return sendError(res, 422, 'You must accept the Business OS terms to activate', 'TERMS_REQUIRED');
  if (!C.STORE_SECTORS.includes(sector)) return sendError(res, 422, `sector must be one of ${C.STORE_SECTORS.length} Store sectors`, 'INVALID_SECTOR');
  const ctx = await E.getOrganisationForUser(req.user.id);
  if (!ctx) return sendError(res, 404, 'No organisation for this account');
  const { syncVerification } = require('../lib/ecosystem/orgs');
  const org = await syncVerification(ctx.org, ctx.root);
  if (org.verification_status !== 'VERIFIED') return sendError(res, 403, 'Your company must be verified before Business OS can be activated', 'ORGANISATION_UNVERIFIED');
  const existing = await db.prepare('SELECT * FROM store_activations WHERE organisation_id=?').get(org.id);
  if (existing) return sendError(res, 409, 'Business OS is already activated for this company', 'ALREADY_ACTIVATED');
  const at = iso();
  try {
    await db.prepare('INSERT INTO store_activations (organisation_id, sector, accepted_by_user_id, terms_version, accepted_at) VALUES (?,?,?,?,?)')
      .run(org.id, sector, req.user.id, C.TERMS_VERSION, at);
  } catch (e) {
    if (/unique|constraint|duplicate/i.test(String(e.message))) return sendError(res, 409, 'Business OS is already activated for this company', 'ALREADY_ACTIVATED');
    throw e;
  }
  await writeAudit(req, { userId: req.actorId, action: 'STORE_ACTIVATED', details: `Activated Business OS (${sector}) terms ${C.TERMS_VERSION}`, entityType: 'organisation', entityId: org.id });
  const result = await E.reconcile(org.id);
  res.status(201).json({
    activation: { sector, termsVersion: C.TERMS_VERSION, acceptedAt: at },
    entitlement: result.grant ? { planCode: result.grant.plan_code, status: result.grant.status } : null,
    openUrl: storeBase() ? `${storeBase()}/auth/loadbyton` : null,
  });
}));

router.get('/api/ecosystem/premium/plans', auth(COMPANY), asyncHandler(async (req, res) => {
  const plans = await db.prepare('SELECT * FROM premium_plan_versions WHERE is_published=1 ORDER BY plan_code, version DESC').all();
  const state = P.checkoutState();
  res.json({
    plans: plans.map((p) => ({
      id: p.id, planCode: p.plan_code, version: p.version, name: p.name, billingPeriod: p.billing_period,
      priceMinor: p.price_minor, currency: p.currency, taxNote: p.tax_note,
      cancellationTerms: p.cancellation_terms, benefitTerms: p.benefit_terms,
      ...P.priced(Number(p.price_minor)),
    })),
    // Checkout opens only when PREMIUM_CHECKOUT_ENABLED=true and a real
    // payment provider is configured. Otherwise staff record subscriptions.
    checkout: state.open ? 'open' : 'not_open',
    checkoutReason: state.reason,
    termsVersion: C.TERMS_VERSION,
  });
}));

// Starts a hosted checkout for a published plan. Company administrator only.
router.post('/api/ecosystem/premium/checkout', auth(COMPANY), asyncHandler(async (req, res) => {
  if (req.user.actingSeatId) return sendError(res, 403, 'Only the company administrator can buy Premium', 'OWNER_ONLY');
  const { planVersionId, acceptTerms } = req.body || {};
  if (acceptTerms !== true) return sendError(res, 422, 'You must accept the Premium Membership terms', 'TERMS_REQUIRED');
  const state = P.checkoutState();
  if (!state.open) return sendError(res, 409, 'Premium checkout is not open yet', 'CHECKOUT_NOT_OPEN');
  const ctx = await E.getOrganisationForUser(req.user.id);
  if (!ctx) return sendError(res, 404, 'No organisation for this account');
  const { syncVerification } = require('../lib/ecosystem/orgs');
  const org = await syncVerification(ctx.org, ctx.root);
  if (org.verification_status !== 'VERIFIED') return sendError(res, 403, 'Your company must be verified before you can buy Premium', 'ORGANISATION_UNVERIFIED');
  const plan = await db.prepare('SELECT * FROM premium_plan_versions WHERE id=?').get(planVersionId);
  if (!plan || !plan.is_published) return sendError(res, 422, 'planVersionId must be a published plan version', 'VALIDATION_FAILED');
  const base = (process.env.SITE_ORIGIN || require('../lib/config').FRONTEND_URL || '').replace(/\/$/, '');
  const back = `${base}/account/benefits`;
  const order = await P.createOrder({ org, userId: req.user.id, plan, returnUrls: { auth: `${back}?paid=1`, cancel: `${back}?paid=cancelled`, decline: `${back}?paid=declined` } });
  if (!order.ok) return sendError(res, 502, 'The payment provider could not start the checkout', 'CHECKOUT_FAILED');
  await writeAudit(req, { userId: req.actorId, action: 'PREMIUM_CHECKOUT_STARTED', details: `${plan.plan_code} v${plan.version} order ${order.id} total ${order.money.totalMinor}`, entityType: 'organisation', entityId: org.id });
  res.status(201).json({ orderId: order.id, url: order.url, ...order.money });
}));

router.get('/api/ecosystem/premium/orders', auth(COMPANY), asyncHandler(async (req, res) => {
  const ctx = await E.getOrganisationForUser(req.actorId);
  if (!ctx) return sendError(res, 404, 'No organisation for this account');
  const rows = await db.prepare(
    `SELECT o.*, p.name AS plan_name, p.billing_period FROM premium_orders o JOIN premium_plan_versions p ON p.id=o.plan_version_id
      WHERE o.organisation_id=? ORDER BY o.id DESC LIMIT 50`).all(ctx.org.id);
  res.json({ orders: rows.map(P.receiptOf) });
}));

// --- Staff ---------------------------------------------------------------

router.get('/api/admin/ecosystem/overview', auth(['ADMIN']), asyncHandler(async (req, res) => {
  const count = async (sql, ...p) => Number((await db.prepare(sql).get(...p)).n);
  res.json({
    organisations: await count('SELECT COUNT(*) AS n FROM organisations'),
    verified: await count("SELECT COUNT(*) AS n FROM organisations WHERE verification_status='VERIFIED'"),
    activations: await count('SELECT COUNT(*) AS n FROM store_activations'),
    subscriptions: await count('SELECT COUNT(*) AS n FROM org_subscriptions'),
    events: {
      pending: await count("SELECT COUNT(*) AS n FROM ecosystem_events WHERE status='PENDING'"),
      delivered: await count("SELECT COUNT(*) AS n FROM ecosystem_events WHERE status='DELIVERED'"),
      dead: await count("SELECT COUNT(*) AS n FROM ecosystem_events WHERE status='DEAD'"),
    },
    deliveryConfigured: !!(process.env.STORE_WEBHOOK_URL && process.env.ECOSYSTEM_SHARED_SECRET),
  });
}));

router.get('/api/admin/ecosystem/premium-plans', auth(['ADMIN']), asyncHandler(async (req, res) => {
  res.json({ plans: await db.prepare('SELECT * FROM premium_plan_versions ORDER BY plan_code, version DESC').all() });
}));

router.get('/api/admin/ecosystem/premium-orders/:id', auth(['ADMIN']), asyncHandler(async (req, res) => {
  const o = await db.prepare('SELECT * FROM premium_orders WHERE id=?').get(req.params.id);
  if (!o) return sendError(res, 404, 'Order not found');
  res.json({ id: o.id, status: o.status, paymentRef: o.payment_ref, provider: o.provider, tranref: o.tranref, totalMinor: Number(o.total_minor), receiptNo: o.receipt_no });
}));

router.post('/api/admin/ecosystem/premium-plans', auth(['ADMIN']), asyncHandler(async (req, res) => {
  const b = req.body || {};
  for (const f of ['planCode', 'name', 'billingPeriod', 'currency', 'taxNote', 'cancellationTerms', 'benefitTerms']) {
    if (!b[f] || typeof b[f] !== 'string') return sendError(res, 422, `${f} is required`, 'VALIDATION_FAILED');
  }
  if (!['monthly', 'annual'].includes(b.billingPeriod)) return sendError(res, 422, 'billingPeriod must be monthly or annual', 'VALIDATION_FAILED');
  if (!Number.isSafeInteger(b.priceMinor) || b.priceMinor < 0) return sendError(res, 422, 'priceMinor must be a non-negative integer (minor units)', 'VALIDATION_FAILED');
  const last = await db.prepare('SELECT MAX(version) AS v FROM premium_plan_versions WHERE plan_code=?').get(b.planCode);
  const version = (last && last.v ? Number(last.v) : 0) + 1;
  const r = await db.prepare(
    `INSERT INTO premium_plan_versions (plan_code, version, name, billing_period, price_minor, currency, tax_note, cancellation_terms, benefit_terms, is_published)
     VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`)
    .run(b.planCode, version, b.name, b.billingPeriod, b.priceMinor, b.currency.toUpperCase(), b.taxNote, b.cancellationTerms, b.benefitTerms, b.publish ? 1 : 0);
  await writeAudit(req, { userId: req.actorId, action: 'PREMIUM_PLAN_CREATED', details: `${b.planCode} v${version}`, entityType: 'premium_plan', entityId: Number(r.lastInsertRowid) });
  res.status(201).json({ id: Number(r.lastInsertRowid), planCode: b.planCode, version, published: !!b.publish });
}));

// Published plan versions are immutable; publishing is one-way.
router.post('/api/admin/ecosystem/premium-plans/:id/publish', auth(['ADMIN']), asyncHandler(async (req, res) => {
  const plan = await db.prepare('SELECT * FROM premium_plan_versions WHERE id=?').get(req.params.id);
  if (!plan) return sendError(res, 404, 'Plan version not found');
  await db.prepare('UPDATE premium_plan_versions SET is_published=1 WHERE id=?').run(plan.id);
  await writeAudit(req, { userId: req.actorId, action: 'PREMIUM_PLAN_PUBLISHED', details: `${plan.plan_code} v${plan.version}`, entityType: 'premium_plan', entityId: plan.id });
  res.json({ ok: true });
}));

async function orgBySubject(subjectId) {
  return db.prepare('SELECT * FROM organisations WHERE subject_id=?').get(String(subjectId || ''));
}

// Records a premium subscription after payment was confirmed outside this
// service. sourceRef is the idempotency key: a replay returns the original row.
router.post('/api/admin/ecosystem/subscriptions', auth(['ADMIN']), asyncHandler(async (req, res) => {
  const { organisationSubjectId, planVersionId, periodStart, periodEnd, sourceRef } = req.body || {};
  if (!sourceRef || typeof sourceRef !== 'string') return sendError(res, 422, 'sourceRef is required', 'VALIDATION_FAILED');
  const replay = await db.prepare('SELECT * FROM org_subscriptions WHERE source_ref=?').get(sourceRef);
  if (replay) return res.json({ id: replay.id, replay: true });
  const org = await orgBySubject(organisationSubjectId);
  if (!org) return sendError(res, 404, 'Organisation not found');
  const plan = await db.prepare('SELECT * FROM premium_plan_versions WHERE id=?').get(planVersionId);
  if (!plan || !plan.is_published) return sendError(res, 422, 'planVersionId must be a published plan version', 'VALIDATION_FAILED');
  const start = new Date(periodStart || Date.now()); const end = new Date(periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return sendError(res, 422, 'periodEnd must be after periodStart', 'VALIDATION_FAILED');
  const r = await db.prepare(
    `INSERT INTO org_subscriptions (organisation_id, plan_version_id, status, period_start, period_end, source, source_ref) VALUES (?,?,?,?,?,?,?) RETURNING id`)
    .run(org.id, plan.id, 'ACTIVE', iso(start), iso(end), 'admin_recorded', sourceRef);
  await writeAudit(req, { userId: req.actorId, action: 'PREMIUM_SUBSCRIPTION_RECORDED', details: `${plan.plan_code} v${plan.version} for org ${org.id}`, entityType: 'organisation', entityId: org.id });
  const rec = await E.reconcile(org.id);
  res.status(201).json({ id: Number(r.lastInsertRowid), entitlement: rec.grant ? rec.grant.plan_code : null });
}));

const TRANSITIONS = {
  cancel: (sub) => ({ sql: "UPDATE org_subscriptions SET status='CANCELLED', cancelled_at=? WHERE id=?", args: [iso(), sub.id], action: 'PREMIUM_CANCELLED' }),
  'payment-failed': (sub) => ({ sql: "UPDATE org_subscriptions SET status='PAYMENT_FAILED', grace_until=? WHERE id=?", args: [iso(new Date(Date.now() + C.GRACE_DAYS * 86400000)), sub.id], action: 'PREMIUM_PAYMENT_FAILED' }),
  'payment-recovered': (sub) => ({ sql: "UPDATE org_subscriptions SET status='ACTIVE', grace_until=NULL WHERE id=?", args: [sub.id], action: 'PREMIUM_PAYMENT_RECOVERED' }),
};
for (const [name, build] of Object.entries(TRANSITIONS)) {
  router.post(`/api/admin/ecosystem/subscriptions/:id/${name}`, auth(['ADMIN']), asyncHandler(async (req, res) => {
    const sub = await db.prepare('SELECT * FROM org_subscriptions WHERE id=?').get(req.params.id);
    if (!sub) return sendError(res, 404, 'Subscription not found');
    if (sub.status === 'ENDED') return sendError(res, 409, 'Subscription has ended', 'SUBSCRIPTION_ENDED');
    const t = build(sub);
    await db.prepare(t.sql).run(...t.args);
    await writeAudit(req, { userId: req.actorId, action: t.action, details: `subscription ${sub.id}`, entityType: 'organisation', entityId: sub.organisation_id });
    const rec = await E.reconcile(sub.organisation_id);
    res.json({ ok: true, entitlement: rec.grant ? { planCode: rec.grant.plan_code, status: rec.grant.status } : null });
  }));
}

router.post('/api/admin/ecosystem/subscriptions/:id/renew', auth(['ADMIN']), asyncHandler(async (req, res) => {
  const { periodEnd, sourceRef } = req.body || {};
  const sub = await db.prepare('SELECT * FROM org_subscriptions WHERE id=?').get(req.params.id);
  if (!sub) return sendError(res, 404, 'Subscription not found');
  if (!sourceRef) return sendError(res, 422, 'sourceRef is required', 'VALIDATION_FAILED');
  const end = new Date(periodEnd);
  if (Number.isNaN(end.getTime()) || end <= new Date(sub.period_end)) return sendError(res, 422, 'periodEnd must extend the current period', 'VALIDATION_FAILED');
  // last_renewal_ref makes a replayed renewal a no-op.
  if (sub.last_renewal_ref === sourceRef) return res.json({ ok: true, replay: true });
  await db.prepare("UPDATE org_subscriptions SET status='ACTIVE', period_end=?, grace_until=NULL, cancelled_at=NULL, last_renewal_ref=? WHERE id=?").run(iso(end), sourceRef, sub.id);
  await writeAudit(req, { userId: req.actorId, action: 'PREMIUM_RENEWED', details: `subscription ${sub.id}`, entityType: 'organisation', entityId: sub.organisation_id });
  const rec = await E.reconcile(sub.organisation_id);
  res.json({ ok: true, entitlement: rec.grant ? { planCode: rec.grant.plan_code, status: rec.grant.status } : null });
}));

router.post('/api/admin/ecosystem/events/:id/retry', auth(['ADMIN']), asyncHandler(async (req, res) => {
  const r = await db.prepare("UPDATE ecosystem_events SET status='PENDING', attempts=0, next_attempt_at=?, last_error=NULL WHERE id=? AND status='DEAD'").run(iso(), req.params.id);
  if (!r.changes) return sendError(res, 404, 'No dead event with that id');
  res.json({ ok: true });
}));

// --- Machine endpoints -----------------------------------------------------

// Sweep: grace expiry, missed events, then delivery. Internal-key gated like
// the other /api/system sweeps; also run on an interval (workers/ecosystem.worker.js).
router.post('/api/system/ecosystem-sweep', asyncHandler(async (req, res) => {
  const key = req.headers['x-internal-key'];
  if (!key || !process.env.INTERNAL_KEY || !timingSafeEqualStr(String(key), process.env.INTERNAL_KEY)) return sendError(res, 403, 'Invalid internal key');
  const swept = await E.sweep();
  const delivered = await deliverPending();
  res.json({ ok: true, ...swept, delivery: delivered });
}));

// Signed read for the Store's nightly reconciliation: the latest grant state
// for every activated organisation. Signature covers "GET <path+query>".
router.get('/api/ecosystem/grants', asyncHandler(async (req, res) => {
  const secret = process.env.ECOSYSTEM_SHARED_SECRET;
  if (!secret) return sendError(res, 503, 'Ecosystem reconciliation is not configured', 'NOT_CONFIGURED');
  const check = verify(secret, `GET ${req.originalUrl}`, req.headers['lbt-signature']);
  if (!check.ok) return sendError(res, 401, 'Invalid signature', 'INVALID_SIGNATURE');
  res.json({ grants: await E.currentGrants(), generated_at: iso() });
}));

module.exports = router;
