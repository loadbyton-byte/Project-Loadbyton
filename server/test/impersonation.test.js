// Security-audit finding: two gaps in admin impersonation.
//
// 1. Every action taken WHILE impersonating was logged to audit_log under
//    the impersonated user's own id (req.actorId, the acting identity) —
//    only the IMPERSONATE_START/END bookends named the real admin. If a
//    victim later disputed an action ("I never cancelled that job"), the
//    audit trail couldn't prove or disprove admin involvement.
// 2. POST /api/admin/impersonate/end issued a fresh session for the real
//    admin but never invalidated the impersonation session it was
//    replacing — the old token stayed valid server-side for up to its own
//    30-minute max-age even after "ending" impersonation in the UI.
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

// Raw fetch with explicit cookie tracking — used here instead of
// harness.js's makeClient so each session token this test cares about
// (the real admin's own session, and the separate impersonation session)
// can be captured and used independently, including AFTER the client
// would normally have moved on to a newer cookie.
async function rawCall(method, path, cookie, body) {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-loadbyton-client': '1', ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: json, cookie: setCookie ? setCookie.split(';')[0] : null };
}

test('an action taken while impersonating is audit-logged with the REAL admin\'s id, not just the victim\'s', async () => {
  const adminLogin = await rawCall('POST', '/api/auth/login', null, { email: 'admin@loadbyton.ae', password: 'demo1234' });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
  const adminCookie = adminLogin.cookie;
  const adminId = adminLogin.body.user.id;

  const shipperLogin = await rawCall('POST', '/api/auth/login', null, { email: 'shipper@jebelalilogistics.ae', password: 'demo1234' });
  const shipperId = shipperLogin.body.user.id;

  const start = await rawCall('POST', `/api/admin/impersonate/${shipperId}`, adminCookie, {});
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const impersonationCookie = start.cookie;
  assert.ok(impersonationCookie, 'impersonate/:userId must set a fresh session cookie for the target');

  // Post a job (not itself audited) then cancel it (a simple, immediate
  // SHIPPER-only transition — OPEN -> CANCELLED needs no carrier/bid) —
  // job.service.js's status-change path writes a 'STATUS' audit entry for
  // every transition.
  const created = await rawCall('POST', '/api/jobs', impersonationCookie, {
    containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
    deliveryAddress: 'Impersonation audit test',
    readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const jobId = created.body.job.id;

  const cancelled = await rawCall('PATCH', `/api/jobs/${jobId}/status`, impersonationCookie, { status: 'CANCELLED' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));

  const audit = await rawCall('GET', '/api/admin/audit', adminCookie);
  assert.equal(audit.status, 200, JSON.stringify(audit.body));
  const entry = audit.body.entries.find((e) => e.action === 'STATUS' && e.entity_id === jobId);
  assert.ok(entry, `expected a STATUS audit entry for job ${jobId}, got actions: ${audit.body.entries.slice(0, 5).map((e) => `${e.action}#${e.entity_id}`).join(', ')}`);
  assert.equal(entry.user_id, shipperId, 'the acting identity (victim) must still be user_id, matching every other audit row');
  assert.equal(entry.acting_admin_id, adminId, 'the REAL admin performing the action while impersonating must be recorded separately');
});

test('ending impersonation invalidates the old impersonation session token, not just the cookie in the browser', async () => {
  const adminLogin = await rawCall('POST', '/api/auth/login', null, { email: 'admin@loadbyton.ae', password: 'demo1234' });
  const adminCookie = adminLogin.cookie;

  const carrierLogin = await rawCall('POST', '/api/auth/login', null, { email: 'carrier@dubaidrayage.com', password: 'demo1234' });
  const carrierId = carrierLogin.body.user.id;

  const start = await rawCall('POST', `/api/admin/impersonate/${carrierId}`, adminCookie, {});
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const impersonationCookie = start.cookie;

  // Confirm the impersonation session actually works before ending it.
  const meWhileImpersonating = await rawCall('GET', '/api/auth/me', impersonationCookie);
  assert.equal(meWhileImpersonating.status, 200);
  assert.equal(meWhileImpersonating.body.user.id, carrierId);

  const end = await rawCall('POST', '/api/admin/impersonate/end', impersonationCookie, {});
  assert.equal(end.status, 200, JSON.stringify(end.body));

  // The OLD impersonation token must no longer work at all, even though
  // it hasn't reached its own 30-minute expiry yet.
  const staleCheck = await rawCall('GET', '/api/auth/me', impersonationCookie);
  assert.equal(staleCheck.status, 401, 'the impersonation session token must be invalidated server-side when impersonation ends, not just replaced client-side');
});
