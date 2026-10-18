// End-to-end ecosystem flow against the real server: organisation identity,
// Store activation, premium lifecycle, signed delivery to a fake Store,
// signed reconciliation read, and the OIDC authorization-code + PKCE flow.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { startServer, makeClient } = require('./harness');
const { sign, verify } = require('../lib/ecosystem/signing');

const SECRET = 'test-ecosystem-secret';
const CLIENT = { client_id: 'store', client_secret: 'store-client-secret', redirect_uris: ['https://store.example.test/auth/loadbyton/callback'] };
const INTERNAL = { 'x-internal-key': 'test-internal-key' };

let server; let receiver; let received = []; let receiverStatus = 200;
let shipper; let admin; let carrier; let orgSubject;

function startReceiver() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = receiverStatus; res.end('ok');
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test.before(async () => {
  receiver = await startReceiver();
  server = await startServer({
    ECOSYSTEM_SHARED_SECRET: SECRET,
    STORE_WEBHOOK_URL: `http://127.0.0.1:${receiver.address().port}/hook`,
    STORE_BASE_URL: 'https://store.example.test',
    OIDC_CLIENTS: JSON.stringify([CLIENT]),
    FRONTEND_URL: 'https://loadbyton.test',
  });
  shipper = makeClient(server.baseUrl); await shipper.login('shipper@jebelalilogistics.ae', 'demo1234');
  carrier = makeClient(server.baseUrl); await carrier.login('carrier@dubaidrayage.com', 'demo1234');
  admin = makeClient(server.baseUrl); await admin.login('admin@loadbyton.ae', 'demo1234');
});

test.after(async () => {
  await server.stop();
  receiver.close();
});

test('every company account gets a stable organisation identity; admins and anonymous callers do not', async () => {
  assert.equal((await makeClient(server.baseUrl).get('/api/ecosystem/me')).status, 401);
  assert.equal((await admin.get('/api/ecosystem/me')).status, 403);
  const me = await shipper.get('/api/ecosystem/me');
  assert.equal(me.status, 200, me.raw);
  assert.match(me.body.organisation.subjectId, /^[0-9a-f-]{36}$/);
  assert.equal(me.body.orgRole, 'owner');
  orgSubject = me.body.organisation.subjectId;
  const again = await shipper.get('/api/ecosystem/me');
  assert.equal(again.body.organisation.subjectId, orgSubject, 'identity must be stable');
  const other = await carrier.get('/api/ecosystem/me');
  assert.notEqual(other.body.organisation.subjectId, orgSubject, 'organisations are isolated');
});

test('nothing is granted before activation', async () => {
  const b = await shipper.get('/api/ecosystem/benefits');
  assert.equal(b.status, 200, b.raw);
  assert.equal(b.body.store.activated, false);
  assert.equal(b.body.store.canActivate, true);
  assert.equal(b.body.entitlement, null);
  assert.equal(b.body.sectors.length, 18);
});

test('activation needs accepted terms and a real sector', async () => {
  const noTerms = await shipper.post('/api/ecosystem/store/activate', { sector: 'road-transport' });
  assert.equal(noTerms.status, 422);
  assert.equal(noTerms.body.code, 'TERMS_REQUIRED');
  const badSector = await shipper.post('/api/ecosystem/store/activate', { sector: 'hospitality', acceptTerms: true });
  assert.equal(badSector.status, 422);
  assert.equal(badSector.body.code, 'INVALID_SECTOR');
});

test('activating Store grants Starter Included once, and a second try is refused', async () => {
  const ok = await shipper.post('/api/ecosystem/store/activate', { sector: 'road-transport', acceptTerms: true });
  assert.equal(ok.status, 201, ok.raw);
  assert.equal(ok.body.entitlement.planCode, 'starter_included');
  assert.equal(ok.body.openUrl, 'https://store.example.test/auth/loadbyton');
  const dup = await shipper.post('/api/ecosystem/store/activate', { sector: 'road-transport', acceptTerms: true });
  assert.equal(dup.status, 409);
  const b = await shipper.get('/api/ecosystem/benefits');
  assert.equal(b.body.entitlement.planCode, 'starter_included');
  assert.equal(b.body.entitlement.limits.max_users, 3);
  assert.equal(b.body.entitlement.version, 1);
});

test('the grant is delivered to the Store as one signed, verifiable event', async () => {
  received = [];
  const swept = await shipper.post('/api/system/ecosystem-sweep', {}, INTERNAL);
  assert.equal(swept.status, 200, swept.raw);
  assert.equal(swept.body.delivery.delivered, 1);
  assert.equal(received.length, 1);
  const [{ headers, body }] = received;
  assert.equal(verify(SECRET, body, headers['lbt-signature']).ok, true, 'signature must verify over the raw body');
  const ev = JSON.parse(body);
  assert.equal(ev.type, 'entitlement.updated');
  assert.equal(ev.id, headers['lbt-event-id']);
  assert.equal(ev.organisation.subject_id, orgSubject);
  assert.equal(ev.organisation.verified_by, 'loadbyton.com');
  assert.equal(ev.entitlement.plan_code, 'starter_included');
  assert.equal(ev.activation.sector, 'road-transport');
  // Delivered events are not re-sent.
  received = [];
  const again = await shipper.post('/api/system/ecosystem-sweep', {}, INTERNAL);
  assert.equal(again.body.delivery.delivered, 0);
  assert.equal(received.length, 0);
});

test('the sweep endpoint requires the internal key', async () => {
  assert.equal((await shipper.post('/api/system/ecosystem-sweep', {})).status, 403);
});

test('premium lifecycle: record, replay, grace, recovery, cancel — each change is one new versioned grant', async () => {
  const plan = await admin.post('/api/admin/ecosystem/premium-plans', {
    planCode: 'premium', name: 'Premium (test)', billingPeriod: 'monthly', priceMinor: 100, currency: 'aed',
    taxNote: 'Test tax note', cancellationTerms: 'Test cancellation', benefitTerms: 'Test benefits', publish: false,
  });
  assert.equal(plan.status, 201, plan.raw);
  const unpublished = await admin.post('/api/admin/ecosystem/subscriptions', {
    organisationSubjectId: orgSubject, planVersionId: plan.body.id, periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(), sourceRef: 'pay-1',
  });
  assert.equal(unpublished.status, 422, 'an unpublished plan version cannot be sold');
  assert.equal((await admin.post(`/api/admin/ecosystem/premium-plans/${plan.body.id}/publish`, {})).status, 200);

  const rec = await admin.post('/api/admin/ecosystem/subscriptions', {
    organisationSubjectId: orgSubject, planVersionId: plan.body.id, periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(), sourceRef: 'pay-1',
  });
  assert.equal(rec.status, 201, rec.raw);
  assert.equal(rec.body.entitlement, 'enterprise_included');
  const replay = await admin.post('/api/admin/ecosystem/subscriptions', {
    organisationSubjectId: orgSubject, planVersionId: plan.body.id, periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(), sourceRef: 'pay-1',
  });
  assert.equal(replay.body.replay, true, 'a replayed payment reference must not create a second subscription');

  const failed = await admin.post(`/api/admin/ecosystem/subscriptions/${rec.body.id}/payment-failed`, {});
  assert.deepEqual([failed.body.entitlement.planCode, failed.body.entitlement.status], ['enterprise_included', 'grace']);
  const recovered = await admin.post(`/api/admin/ecosystem/subscriptions/${rec.body.id}/payment-recovered`, {});
  assert.deepEqual([recovered.body.entitlement.planCode, recovered.body.entitlement.status], ['enterprise_included', 'active']);
  const cancelled = await admin.post(`/api/admin/ecosystem/subscriptions/${rec.body.id}/cancel`, {});
  assert.equal(cancelled.body.entitlement.planCode, 'enterprise_included', 'cancellation keeps Enterprise to period end');

  const b = await shipper.get('/api/ecosystem/benefits');
  assert.equal(b.body.entitlement.reason, 'premium_cancelled_until_period_end');
  assert.ok(b.body.entitlement.endsAt);
  assert.equal(b.body.entitlement.version, 5, 'starter, enterprise, grace, recovered, cancelling');
  assert.equal(b.body.entitlement.limits.max_users, 100);
});

test('premium plans are visible to companies but checkout stays closed', async () => {
  const plans = await shipper.get('/api/ecosystem/premium/plans');
  assert.equal(plans.status, 200);
  assert.equal(plans.body.checkout, 'not_open');
  assert.equal(plans.body.plans[0].priceMinor, 100);
});

test('queued events arrive in order and carry increasing versions', async () => {
  received = [];
  await shipper.post('/api/system/ecosystem-sweep', {}, INTERNAL);
  const versions = received.map((r) => JSON.parse(r.body).version);
  assert.deepEqual(versions, [2, 3, 4, 5]);
});

test('a failing receiver is retried with back-off, not dropped', async () => {
  receiverStatus = 503;
  // Recovering the cancelled subscription changes the entitlement, which queues a new event.
  const subs = (await shipper.get('/api/ecosystem/benefits')).body.premium.subscriptions;
  const recovered = await admin.post(`/api/admin/ecosystem/subscriptions/${subs[0].id}/payment-recovered`, {});
  assert.equal(recovered.status, 200);
  received = [];
  const first = await shipper.post('/api/system/ecosystem-sweep', {}, INTERNAL);
  assert.equal(first.body.delivery.failed, 1);
  assert.equal(received.length, 1);
  const second = await shipper.post('/api/system/ecosystem-sweep', {}, INTERNAL);
  assert.equal(second.body.delivery.failed, 0, 'not due again until the back-off has passed');
  receiverStatus = 200;
});

test('reconciliation read is signed: valid signature lists current grants, bad ones are refused', async () => {
  const path = '/api/ecosystem/grants';
  const anon = makeClient(server.baseUrl);
  assert.equal((await anon.get(path)).status, 401);
  const res = await fetch(`${server.baseUrl}${path}`, { headers: { 'LBT-Signature': sign(SECRET, `GET ${path}`) } });
  assert.equal(res.status, 200);
  const body = await res.json();
  const mine = body.grants.find((g) => g.organisation.subject_id === orgSubject);
  assert.ok(mine);
  assert.equal(mine.entitlement.plan_code, 'enterprise_included');
  const stale = await fetch(`${server.baseUrl}${path}`, { headers: { 'LBT-Signature': sign(SECRET, `GET ${path}`, Date.now() - 10 * 60 * 1000) } });
  assert.equal(stale.status, 401);
  const wrongPath = await fetch(`${server.baseUrl}${path}?x=1`, { headers: { 'LBT-Signature': sign(SECRET, `GET ${path}`) } });
  assert.equal(wrongPath.status, 401, 'a signature is bound to the exact path and query');
});

test('only staff can touch premium plans and subscriptions', async () => {
  assert.equal((await shipper.post('/api/admin/ecosystem/premium-plans', {})).status, 403);
  assert.equal((await shipper.post('/api/admin/ecosystem/subscriptions', {})).status, 403);
  assert.equal((await shipper.get('/api/admin/ecosystem/overview')).status, 403);
  const overview = await admin.get('/api/admin/ecosystem/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.deliveryConfigured, true);
  assert.equal(overview.body.activations, 1);
});

// --- OIDC --------------------------------------------------------------

const b64u = (b) => Buffer.from(b).toString('base64url');
const pkce = () => { const verifier = b64u(crypto.randomBytes(32)); return { verifier, challenge: b64u(crypto.createHash('sha256').update(verifier).digest()) }; };
const authorizeUrl = (p, extra = {}) => {
  const u = new URL(`${server.baseUrl}/api/oidc/authorize`);
  const params = { response_type: 'code', client_id: CLIENT.client_id, redirect_uri: CLIENT.redirect_uris[0], scope: 'openid email organisation', state: 'st-1', nonce: 'no-1', code_challenge: p.challenge, code_challenge_method: 'S256', ...extra };
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
};
const get = (url, cookie) => fetch(url, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });

async function exchange(code, verifier, over = {}) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CLIENT.redirect_uris[0], code_verifier: verifier, client_id: CLIENT.client_id, client_secret: CLIENT.client_secret, ...over });
  return fetch(`${server.baseUrl}/api/oidc/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
}

test('OIDC discovery and JWKS are published', async () => {
  const d = await (await fetch(`${server.baseUrl}/api/oidc/.well-known/openid-configuration`)).json();
  assert.equal(d.issuer, 'https://loadbyton.test/api/oidc');
  assert.deepEqual(d.code_challenge_methods_supported, ['S256']);
  const jwks = await (await fetch(`${server.baseUrl}/api/oidc/jwks.json`)).json();
  assert.equal(jwks.keys[0].alg, 'RS256');
  assert.ok(jwks.keys[0].n && jwks.keys[0].kid);
});

test('authorize: unknown client and unregistered redirect_uri are never redirected to', async () => {
  const p = pkce();
  assert.equal((await get(authorizeUrl(p, { client_id: 'nope' }))).status, 400);
  assert.equal((await get(authorizeUrl(p, { redirect_uri: 'https://evil.example/cb' }))).status, 400);
});

test('authorize: PKCE and state are mandatory and reported to the registered redirect', async () => {
  const p = pkce();
  const cookie = shipper.getCookie();
  const noPkce = await get(authorizeUrl(p, { code_challenge: undefined, code_challenge_method: undefined }), cookie);
  assert.equal(noPkce.status, 302);
  assert.equal(new URL(noPkce.headers.get('location')).searchParams.get('error'), 'invalid_request');
  const plain = await get(authorizeUrl(p, { code_challenge_method: 'plain' }), cookie);
  assert.equal(new URL(plain.headers.get('location')).searchParams.get('error'), 'invalid_request');
  const noState = await get(authorizeUrl(p, { state: undefined }), cookie);
  assert.equal(new URL(noState.headers.get('location')).searchParams.get('error'), 'invalid_request');
});

test('authorize without a session sends the person to log in, then back', async () => {
  const res = await get(authorizeUrl(pkce()));
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://loadbyton.test/login');
  assert.match(loc.searchParams.get('return_to'), /^\/api\/oidc\/authorize\?/);
});

test('full flow: code, token exchange, signed ID token with organisation claims', async () => {
  const p = pkce();
  const res = await get(authorizeUrl(p), shipper.getCookie());
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, CLIENT.redirect_uris[0]);
  assert.equal(loc.searchParams.get('state'), 'st-1');
  assert.equal(loc.searchParams.get('iss'), 'https://loadbyton.test/api/oidc');
  const code = loc.searchParams.get('code');
  assert.ok(code);

  const tok = await exchange(code, p.verifier);
  assert.equal(tok.status, 200, await tok.clone().text());
  assert.equal(tok.headers.get('cache-control'), 'no-store');
  const tokens = await tok.json();
  assert.equal(tokens.token_type, 'Bearer');

  const jwks = await (await fetch(`${server.baseUrl}/api/oidc/jwks.json`)).json();
  const [h, pl, sg] = tokens.id_token.split('.');
  const pub = crypto.createPublicKey({ key: jwks.keys[0], format: 'jwk' });
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${pl}`), pub, Buffer.from(sg, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(pl, 'base64url'));
  assert.equal(claims.iss, 'https://loadbyton.test/api/oidc');
  assert.equal(claims.aud, CLIENT.client_id);
  assert.equal(claims.nonce, 'no-1');
  assert.equal(claims.org_sub, orgSubject);
  assert.equal(claims.org_role, 'owner');
  assert.equal(claims.org_verified, true);
  assert.equal(claims.email, 'shipper@jebelalilogistics.ae');
  assert.match(claims.sub, /^[0-9a-f-]{36}$/);
  assert.notEqual(claims.sub, claims.org_sub, 'a person and an organisation are different identities');

  const ui = await fetch(`${server.baseUrl}/api/oidc/userinfo`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  assert.equal(ui.status, 200);
  assert.equal((await ui.json()).org_sub, orgSubject);
  assert.equal((await fetch(`${server.baseUrl}/api/oidc/userinfo`, { headers: { Authorization: `Bearer ${tokens.id_token}x` } })).status, 401);
});

test('a code works once; a wrong verifier or client secret burns or rejects it', async () => {
  const p = pkce();
  const code = new URL((await get(authorizeUrl(p), shipper.getCookie())).headers.get('location')).searchParams.get('code');
  assert.equal((await exchange(code, p.verifier)).status, 200);
  assert.equal((await exchange(code, p.verifier)).status, 400, 'replay must fail');

  const p2 = pkce();
  const code2 = new URL((await get(authorizeUrl(p2), shipper.getCookie())).headers.get('location')).searchParams.get('code');
  assert.equal((await exchange(code2, pkce().verifier)).status, 400, 'wrong PKCE verifier');
  assert.equal((await exchange(code2, p2.verifier)).status, 400, 'the failed attempt burned the code');

  const p3 = pkce();
  const code3 = new URL((await get(authorizeUrl(p3), shipper.getCookie())).headers.get('location')).searchParams.get('code');
  assert.equal((await exchange(code3, p3.verifier, { client_secret: 'wrong' })).status, 401);
  assert.equal((await exchange(code3, p3.verifier, { redirect_uri: 'https://store.example.test/other' })).status, 400);
});

test('platform staff do not get company single sign-on', async () => {
  const res = await get(authorizeUrl(pkce()), admin.getCookie());
  assert.equal(new URL(res.headers.get('location')).searchParams.get('error'), 'access_denied');
});
