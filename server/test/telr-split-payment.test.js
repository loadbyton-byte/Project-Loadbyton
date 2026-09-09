// Unit coverage for the Telr Split Payment payout mechanism added to
// lib/payments.js — closes the previous "NOT IMPLEMENTED" gap for
// PAYMENTS_PROVIDER=telr's executePayout(). Runs against the real module
// with global.fetch mocked (no live Telr sandbox call) — proves the
// request-building and alreadySplitPaid short-circuit logic, not that
// Telr's actual API accepts this exact shape (that's the documented
// VERIFY point in lib/payments.js itself).

process.env.PAYMENTS_PROVIDER = 'telr';
process.env.TELR_STORE_ID = 'test-store';
process.env.TELR_AUTH_KEY = 'test-authkey';

const test = require('node:test');
const assert = require('node:assert/strict');
const payments = require('../lib/payments');

test('createCheckoutOrder includes a Telr splits array when a split beneficiary is passed', async (t) => {
  let capturedBody = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    capturedBody = opts.body;
    return { ok: true, json: async () => ({ order: { ref: 'ord123', url: 'https://secure.telr.com/pay/ord123' } }) };
  };
  t.after(() => { global.fetch = originalFetch; });

  const r = await payments.createCheckoutOrder({
    jobCode: 'LB-TEST-1',
    amountAed: 1000,
    paymentRef: 'lb_test_1',
    splitBeneficiary: { splitId: 'split-42', netAed: 940 },
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.splitApplied, true);
  const params = new URLSearchParams(capturedBody);
  assert.equal(params.get('splits[0][id]'), 'split-42');
  assert.equal(params.get('splits[0][type]'), 'flat');
  assert.equal(params.get('splits[0][value]'), '940');
  assert.equal(params.get('splits[1][id]'), '0');
  assert.equal(params.get('splits[1][type]'), 'remaining');
});

test('createCheckoutOrder omits splits entirely when no split beneficiary is passed (unaffected carriers keep today\'s behavior)', async (t) => {
  let capturedBody = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    capturedBody = opts.body;
    return { ok: true, json: async () => ({ order: { ref: 'ord124', url: 'https://secure.telr.com/pay/ord124' } }) };
  };
  t.after(() => { global.fetch = originalFetch; });

  const r = await payments.createCheckoutOrder({ jobCode: 'LB-TEST-2', amountAed: 500, paymentRef: 'lb_test_2' });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.splitApplied, false);
  const params = new URLSearchParams(capturedBody);
  assert.equal(params.get('splits[0][id]'), null, 'no split fields must be sent when the carrier has no Split ID on file');
});

test('executePayout with alreadySplitPaid reports success without any network call — the carrier was already paid at checkout', async () => {
  let fetchCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async () => { fetchCalled = true; throw new Error('must not be called'); };
  try {
    const r = await payments.executePayout({ paymentRef: 'payout-1', jobCode: 'LB-TEST-3', amountAed: 940, alreadySplitPaid: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(fetchCalled, false, 'a job already settled via split payment must not trigger a second real transfer attempt');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executePayout without alreadySplitPaid still reports not_implemented — Telr has no after-the-fact transfer API', async () => {
  const r = await payments.executePayout({ paymentRef: 'payout-2', jobCode: 'LB-TEST-4', amountAed: 500, alreadySplitPaid: false });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_implemented');
});
