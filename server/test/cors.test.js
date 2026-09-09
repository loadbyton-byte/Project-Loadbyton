// Any custom header web/src/lib/api.js sends on a cross-origin request must
// be in Access-Control-Allow-Headers, or the browser's own CORS preflight
// silently blocks the real request — the client sees a bare "Failed to
// fetch" and nothing ever reaches the server (no request even lands in the
// server log). A same-origin dev setup never preflights, so this class of
// bug only shows up once the frontend and API are on different origins —
// the normal shape of a real deployment. Job posting's idempotency-key
// retry flow and the release-payout HSM-signature flow both hit this
// exactly: their custom headers (Idempotency-Key, x-hsm-sigs) were missing
// from the allowlist.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./harness');

let server;

test.before(async () => {
  server = await startServer();
});

test.after(async () => {
  await server.stop();
});

test('CORS preflight allows every custom header the frontend actually sends', async () => {
  const res = await fetch(`${server.baseUrl}/api/jobs`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5299',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type, Idempotency-Key',
    },
  });
  assert.equal(res.status, 204);
  const allowed = (res.headers.get('access-control-allow-headers') || '').toLowerCase().split(',').map((h) => h.trim());
  assert.ok(allowed.includes('idempotency-key'), `Idempotency-Key must be allowed — got: ${allowed.join(', ')}`);
  assert.ok(allowed.includes('x-hsm-sigs'), `x-hsm-sigs must be allowed — got: ${allowed.join(', ')}`);
});
