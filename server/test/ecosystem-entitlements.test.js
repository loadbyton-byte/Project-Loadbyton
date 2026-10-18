// Pure rules for Store entitlements (lib/ecosystem/entitlements.js decide())
// and the webhook signing scheme shared with Loadbyton-OS. No server needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, subscriptionState } = require('../lib/ecosystem/entitlements');
const { sign, verify } = require('../lib/ecosystem/signing');
const { backoffSeconds } = require('../lib/ecosystem/delivery');
const C = require('../lib/ecosystem/constants');

const DAY = 86400000;
const now = new Date('2026-11-01T00:00:00Z');
const sub = (over) => ({ status: 'ACTIVE', period_end: new Date(now.getTime() + 10 * DAY).toISOString(), grace_until: null, ...over });

test('catalogue mirror: 18 sectors, starter and enterprise limits present', () => {
  assert.equal(C.STORE_SECTORS.length, 18);
  assert.equal(new Set(C.STORE_SECTORS).size, 18);
  assert.equal(C.STORE_PLAN_LIMITS.starter_included.max_users, 3);
  assert.equal(C.STORE_PLAN_LIMITS.enterprise_included.max_sectors, 18);
});

test('nothing is granted before the administrator activates Store', () => {
  assert.equal(decide({ verified: true, activated: false, subs: [sub()], now }), null);
});

test('an unverified company is suspended, never granted', () => {
  const d = decide({ verified: false, activated: true, subs: [], now });
  assert.equal(d.plan_code, null);
  assert.equal(d.status, 'suspended');
  assert.equal(d.reason, 'organisation_unverified');
});

test('verified company without premium gets Starter Included', () => {
  const d = decide({ verified: true, activated: true, subs: [], now });
  assert.deepEqual([d.plan_code, d.status, d.reason], ['starter_included', 'active', 'verified_company']);
});

test('active premium upgrades to Enterprise Included', () => {
  const d = decide({ verified: true, activated: true, subs: [sub()], now });
  assert.deepEqual([d.plan_code, d.status, d.reason], ['enterprise_included', 'active', 'premium_active']);
});

test('cancellation keeps Enterprise to the end of the paid period, then reverts to Starter', () => {
  const cancelled = sub({ status: 'CANCELLED' });
  const during = decide({ verified: true, activated: true, subs: [cancelled], now });
  assert.equal(during.plan_code, 'enterprise_included');
  assert.equal(during.reason, 'premium_cancelled_until_period_end');
  assert.equal(during.ends_at, cancelled.period_end);
  const after = decide({ verified: true, activated: true, subs: [cancelled], now: new Date(now.getTime() + 11 * DAY) });
  assert.deepEqual([after.plan_code, after.reason], ['starter_included', 'premium_ended_reverted_to_starter']);
});

test('failed payment: Enterprise for the grace window, then Starter', () => {
  const graceUntil = new Date(now.getTime() + 14 * DAY).toISOString();
  const failed = sub({ status: 'PAYMENT_FAILED', grace_until: graceUntil });
  const during = decide({ verified: true, activated: true, subs: [failed], now });
  assert.deepEqual([during.plan_code, during.status, during.grace_until], ['enterprise_included', 'grace', graceUntil]);
  const after = decide({ verified: true, activated: true, subs: [failed], now: new Date(now.getTime() + 15 * DAY) });
  assert.equal(after.plan_code, 'starter_included');
});

test('an unrenewed period behaves like a failed payment — Enterprise never continues silently', () => {
  const lapsed = sub({ period_end: new Date(now.getTime() - 1 * DAY).toISOString() });
  assert.equal(decide({ verified: true, activated: true, subs: [lapsed], now, graceDays: 14 }).status, 'grace');
  assert.equal(decide({ verified: true, activated: true, subs: [lapsed], now: new Date(now.getTime() + 20 * DAY), graceDays: 14 }).plan_code, 'starter_included');
});

test('the best subscription wins when an organisation has several', () => {
  const ended = sub({ status: 'ENDED' });
  const active = sub();
  assert.equal(decide({ verified: true, activated: true, subs: [ended, active], now }).plan_code, 'enterprise_included');
  assert.equal(subscriptionState(ended, now).state, 'ENDED');
});

test('signing: valid, tampered body, stale timestamp, wrong secret, malformed', () => {
  const body = '{"a":1}';
  const t0 = Date.now();
  const header = sign('s3cret', body, t0);
  assert.equal(verify('s3cret', body, header, { now: t0 }).ok, true);
  assert.equal(verify('s3cret', body + ' ', header, { now: t0 }).reason, 'mismatch');
  assert.equal(verify('s3cret', body, header, { now: t0 + 6 * 60 * 1000 }).reason, 'stale');
  assert.equal(verify('other', body, header, { now: t0 }).reason, 'mismatch');
  assert.equal(verify('s3cret', body, 'garbage', { now: t0 }).reason, 'malformed');
  assert.equal(verify('', body, header, { now: t0 }).reason, 'no_secret');
});

test('delivery back-off grows and is capped at one hour', () => {
  assert.equal(backoffSeconds(1), 30);
  assert.equal(backoffSeconds(2), 60);
  assert.equal(backoffSeconds(12), 3600);
});
