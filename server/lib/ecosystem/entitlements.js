// Entitlement decisions for LOAD|BY|TON.store (master plan §3, §9).
//
// The rules, in one place:
//   * Nothing is granted until the company administrator has activated Store
//     (accepted terms, chosen a sector) — no silent workspace creation.
//   * Starter Included requires a verified company.
//   * An active premium subscription upgrades to Enterprise Included. The
//     company data and workspace stay; only the plan changes.
//   * Cancellation keeps Enterprise to the end of the paid period.
//   * A failed or unrenewed payment keeps Enterprise for GRACE_DAYS, then the
//     company reverts to Starter Included. Nothing is deleted here; the Store
//     turns excess modules read-only with export.
//   * Loyalty tiers (users.tier) and completed freight volume never count.
//
// decide() is pure so the rules are testable without a database. reconcile()
// applies the decision: it appends a numbered grant row and queues one signed
// event. Grants are state snapshots with a per-organisation version, so the
// receiver applies the highest version it has seen and a replayed or
// out-of-order delivery is harmless.

'use strict';

const crypto = require('node:crypto');
const db = require('../../db');
const C = require('./constants');
const { getOrganisationForUser, syncVerification, isVerifiedUser } = require('./orgs');

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (d) => new Date(d).toISOString();

// Where a single subscription stands at `now`.
function subscriptionState(sub, now, graceDays = C.GRACE_DAYS) {
  const periodEnd = new Date(sub.period_end);
  if (sub.status === 'ENDED') return { state: 'ENDED' };
  if (sub.status === 'CANCELLED') {
    return now < periodEnd ? { state: 'ACTIVE', endsAt: iso(periodEnd), cancelling: true } : { state: 'ENDED' };
  }
  if (sub.status === 'PAYMENT_FAILED') {
    const graceUntil = sub.grace_until ? new Date(sub.grace_until) : new Date(periodEnd.getTime() + graceDays * DAY_MS);
    return now < graceUntil ? { state: 'GRACE', graceUntil: iso(graceUntil) } : { state: 'ENDED' };
  }
  // ACTIVE: a period that ran out with no renewal event behaves like a failed
  // payment — enterprise never continues silently.
  if (now <= periodEnd) return { state: 'ACTIVE', endsAt: null };
  const graceUntil = new Date(periodEnd.getTime() + graceDays * DAY_MS);
  return now < graceUntil ? { state: 'GRACE', graceUntil: iso(graceUntil) } : { state: 'ENDED' };
}

function bestSubscription(subs, now, graceDays) {
  let best = null;
  for (const sub of subs) {
    const s = subscriptionState(sub, now, graceDays);
    if (s.state === 'ENDED') continue;
    if (!best || (s.state === 'ACTIVE' && best.state === 'GRACE')) best = { ...s, sub };
  }
  return best;
}

// Returns the desired entitlement, or null when there is nothing to grant yet.
function decide({ verified, activated, subs = [], now = new Date(), graceDays = C.GRACE_DAYS }) {
  if (!activated) return null;
  if (!verified) {
    return { plan_code: null, status: 'suspended', ends_at: null, grace_until: null, reason: 'organisation_unverified' };
  }
  const best = bestSubscription(subs, now, graceDays);
  if (best && best.state === 'ACTIVE') {
    return { plan_code: C.PLAN_ENTERPRISE_INCLUDED, status: 'active', ends_at: best.endsAt || null, grace_until: null, reason: best.cancelling ? 'premium_cancelled_until_period_end' : 'premium_active' };
  }
  if (best && best.state === 'GRACE') {
    return { plan_code: C.PLAN_ENTERPRISE_INCLUDED, status: 'grace', ends_at: null, grace_until: best.graceUntil, reason: 'premium_payment_grace' };
  }
  return { plan_code: C.PLAN_STARTER_INCLUDED, status: 'active', ends_at: null, grace_until: null, reason: subs.length ? 'premium_ended_reverted_to_starter' : 'verified_company' };
}

async function latestGrant(orgId) {
  return db.prepare('SELECT * FROM entitlement_grants WHERE organisation_id=? AND product=? ORDER BY version DESC LIMIT 1').get(orgId, C.PRODUCT_STORE);
}

function sameEntitlement(grant, want) {
  return grant.plan_code === want.plan_code && grant.status === want.status
    && (grant.ends_at || null) === (want.ends_at || null) && (grant.grace_until || null) === (want.grace_until || null);
}

function buildEventBody({ grant, org, activation, acceptedBySubject }) {
  return {
    id: grant.event_id,
    type: C.EVENT_ENTITLEMENT_UPDATED,
    created: grant.created_at,
    version: grant.version,
    organisation: { subject_id: org.subject_id, name: org.name, verified: org.verification_status === 'VERIFIED', verified_by: 'loadbyton.com' },
    entitlement: {
      product: grant.product, plan_code: grant.plan_code, status: grant.status,
      starts_at: grant.starts_at, ends_at: grant.ends_at || null, grace_until: grant.grace_until || null, reason: grant.reason,
    },
    activation: activation ? {
      sector: activation.sector, accepted_by_subject: acceptedBySubject || null,
      accepted_at: activation.accepted_at, terms_version: activation.terms_version,
    } : null,
  };
}

async function eventBodyForGrant(grant) {
  const org = await db.prepare('SELECT * FROM organisations WHERE id=?').get(grant.organisation_id);
  const activation = await db.prepare('SELECT * FROM store_activations WHERE organisation_id=?').get(grant.organisation_id);
  const accepter = activation ? await db.prepare('SELECT subject_id FROM users WHERE id=?').get(activation.accepted_by_user_id) : null;
  return buildEventBody({ grant, org, activation, acceptedBySubject: accepter && accepter.subject_id });
}

// Applies the decision for one organisation. Safe to call as often as you
// like: it writes only when the entitlement actually changed.
async function reconcile(orgId, { now = new Date() } = {}) {
  let org = await db.prepare('SELECT * FROM organisations WHERE id=?').get(orgId);
  if (!org) return { changed: false, reason: 'no_organisation' };
  const root = await db.prepare('SELECT * FROM users WHERE id=?').get(org.owner_user_id);
  org = await syncVerification(org, root);
  const activation = await db.prepare('SELECT * FROM store_activations WHERE organisation_id=?').get(org.id);
  const subs = await db.prepare('SELECT * FROM org_subscriptions WHERE organisation_id=?').all(org.id);
  const want = decide({ verified: isVerifiedUser(root), activated: !!activation, subs, now });
  if (!want) return { changed: false, reason: 'not_activated' };

  const have = await latestGrant(org.id);
  if (have && sameEntitlement(have, want)) return { changed: false, grant: have };

  const version = have ? have.version + 1 : 1;
  const grant = {
    event_id: crypto.randomUUID(), organisation_id: org.id, version, product: C.PRODUCT_STORE,
    ...want, starts_at: iso(now), created_at: iso(now),
  };
  const body = JSON.stringify(buildEventBody({
    grant, org, activation,
    acceptedBySubject: (await db.prepare('SELECT subject_id FROM users WHERE id=?').get(activation.accepted_by_user_id) || {}).subject_id,
  }));
  try {
    await db.transaction(async (trx) => {
      await trx.query(
        `INSERT INTO entitlement_grants (event_id, organisation_id, version, product, plan_code, status, starts_at, ends_at, grace_until, reason, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [grant.event_id, org.id, version, grant.product, grant.plan_code, grant.status, grant.starts_at, grant.ends_at, grant.grace_until, grant.reason, grant.created_at]);
      await trx.query(
        `INSERT INTO ecosystem_events (event_id, organisation_id, event_type, body, status, next_attempt_at, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [grant.event_id, org.id, C.EVENT_ENTITLEMENT_UPDATED, body, 'PENDING', grant.created_at, grant.created_at]);
    });
  } catch (e) {
    // Lost a race with a concurrent reconcile of the same version: the winner's
    // row is already the truth.
    if (/unique|constraint|duplicate/i.test(String(e.message))) return { changed: false, raced: true, grant: await latestGrant(org.id) };
    throw e;
  }
  return { changed: true, grant: await latestGrant(org.id) };
}

// Grants whose event never got queued (a crash between the two inserts cannot
// happen inside the transaction, but a row restored from backup could) are
// re-queued here so the nightly sweep repairs them.
async function requeueMissingEvents() {
  const rows = await db.prepare(
    `SELECT g.* FROM entitlement_grants g LEFT JOIN ecosystem_events e ON e.event_id=g.event_id WHERE e.id IS NULL`).all();
  for (const grant of rows) {
    const body = JSON.stringify(await eventBodyForGrant(grant));
    await db.prepare(`INSERT INTO ecosystem_events (event_id, organisation_id, event_type, body, status, next_attempt_at, created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(grant.event_id, grant.organisation_id, C.EVENT_ENTITLEMENT_UPDATED, body, 'PENDING', iso(new Date()), iso(new Date()));
  }
  return rows.length;
}

// Reconciles every activated organisation. Called on an interval and by the
// internal sweep route; it is what moves a company from grace to Starter.
async function sweep({ now = new Date() } = {}) {
  const orgs = await db.prepare('SELECT organisation_id FROM store_activations').all();
  let changed = 0;
  for (const { organisation_id } of orgs) {
    const r = await reconcile(organisation_id, { now });
    if (r.changed) changed += 1;
  }
  const requeued = await requeueMissingEvents();
  return { checked: orgs.length, changed, requeued };
}

// The grants as the Store should currently see them (reconciliation read).
async function currentGrants() {
  const rows = await db.prepare(
    `SELECT g.* FROM entitlement_grants g
      WHERE g.product=? AND g.version=(SELECT MAX(version) FROM entitlement_grants x WHERE x.organisation_id=g.organisation_id AND x.product=g.product)
      ORDER BY g.organisation_id`).all(C.PRODUCT_STORE);
  const out = [];
  for (const g of rows) out.push(await eventBodyForGrant(g));
  return out;
}

module.exports = {
  decide, subscriptionState, reconcile, sweep, currentGrants, latestGrant, requeueMissingEvents,
  getOrganisationForUser,
};
