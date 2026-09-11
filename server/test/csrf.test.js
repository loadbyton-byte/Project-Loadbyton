// Security-audit finding: no CSRF defense existed anywhere. SameSite alone
// doesn't help once frontend and API are on different domains in
// production (the session cookie has to be SameSite=None cross-origin to
// work there at all), and SameSite=None is sent by the browser on a
// request from ANY site, not just this app's own frontend. A plain HTML
// <form> POST (no preflight — it can't set a custom header or a non-form
// Content-Type) was enough to ride a logged-in victim's session and
// silently perform a real action, e.g. withdrawing a carrier's bid or
// confirming a pending two-person admin approval.
//
// Fix (server/app.js): every mutating request that carries the session
// cookie must also carry a custom x-loadbyton-client header. Neither a
// <form> POST nor a "simple" cross-origin fetch/XHR can attach a custom
// header without triggering a CORS preflight, which the existing origin
// allowlist already blocks for any non-allowed origin.
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

// Deliberately NOT using harness.js's makeClient here — it already sends
// the CSRF header on every call (as a real frontend would), so it can't
// exercise the missing-header case. This test drives fetch() directly to
// simulate exactly what a cross-site <form> POST (or an attacker script
// that forgot the header) would send: the session cookie, no custom header.
async function rawCall(method, path, cookie, extraHeaders = {}, body) {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json, setCookie: res.headers.get('set-cookie') };
}

test('a mutating request carrying the session cookie but not the CSRF header is refused, simulating a cross-site form POST', async () => {
  const login = await rawCall('POST', '/api/auth/login', null, { 'x-loadbyton-client': '1' }, { email: 'shipper@jebelalilogistics.ae', password: 'demo1234' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const cookie = login.setCookie.split(';')[0];

  // No x-loadbyton-client header — this is exactly what a plain cross-site
  // <form action="..." method="POST"> submission would send: the browser
  // attaches the cookie automatically, but a form can't add custom headers.
  const forged = await rawCall('POST', '/api/jobs', cookie, {}, {
    shipmentType: 'IMPORT', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ', deliveryAddress: 'CSRF test',
    containerSize: '20FT', containerType: 'DRY',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(forged.status, 403, JSON.stringify(forged.body));
  assert.equal(forged.body.code, 'CSRF_HEADER_MISSING');
});

test('the same request WITH the CSRF header succeeds — legitimate frontend traffic is unaffected', async () => {
  const login = await rawCall('POST', '/api/auth/login', null, { 'x-loadbyton-client': '1' }, { email: 'shipper@jebelalilogistics.ae', password: 'demo1234' });
  const cookie = login.setCookie.split(';')[0];

  const real = await rawCall('POST', '/api/jobs', cookie, { 'x-loadbyton-client': '1' }, {
    shipmentType: 'IMPORT', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ', deliveryAddress: 'CSRF test — legit',
    containerSize: '20FT', containerType: 'DRY',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(real.status, 201, JSON.stringify(real.body));
});

test('GET requests never require the CSRF header, even with a session cookie', async () => {
  const login = await rawCall('POST', '/api/auth/login', null, { 'x-loadbyton-client': '1' }, { email: 'shipper@jebelalilogistics.ae', password: 'demo1234' });
  const cookie = login.setCookie.split(';')[0];
  const me = await rawCall('GET', '/api/auth/me', cookie, {});
  assert.equal(me.status, 200, JSON.stringify(me.body));
});

test('a request with no session cookie at all is never blocked by the CSRF check (webhooks, login itself)', async () => {
  // The login POST above (no cookie yet — that's the whole point of
  // logging in) already implicitly proves this, since it always succeeds
  // in every other test in this file. This makes it explicit: a request
  // with no cookie must not be rejected for a missing CSRF header, since
  // it has no session for CSRF to ride in the first place.
  const login = await rawCall('POST', '/api/auth/login', null, {}, { email: 'shipper@jebelalilogistics.ae', password: 'demo1234' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
});
