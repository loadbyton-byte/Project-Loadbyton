// OpenID Connect issuer endpoints (lib/ecosystem/oidc.js documents the
// design). Mounted under /api/oidc so the session cookie, which the browser
// only sends to the frontend origin, reaches /authorize through the same
// rewrite as every other API call.

'use strict';

const express = require('express');
const db = require('../db');
const { parseCookies } = require('../lib/http');
const { FRONTEND_URL } = require('../lib/config');
const oidc = require('../lib/ecosystem/oidc');

const router = express.Router();

const noStore = (res) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Pragma', 'no-cache'); };

function disabled(res) {
  return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'Single sign-on is not configured on this server.' });
}
const ready = () => !!oidc.signingKey() && oidc.clients().length > 0;

router.get('/api/oidc/.well-known/openid-configuration', (req, res) => {
  if (!ready()) return disabled(res);
  const iss = oidc.issuer();
  res.json({
    issuer: iss,
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/token`,
    userinfo_endpoint: `${iss}/userinfo`,
    jwks_uri: `${iss}/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    scopes_supported: ['openid', 'profile', 'email', 'organisation'],
    claims_supported: ['sub', 'email', 'email_verified', 'name', 'org_sub', 'org_name', 'org_role', 'org_verified'],
    authorization_response_iss_parameter_supported: true,
  });
});

router.get('/api/oidc/jwks.json', (req, res) => {
  const key = oidc.signingKey();
  if (!key) return disabled(res);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ keys: [key.jwk] });
});

function redirectWith(res, redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  noStore(res);
  return res.redirect(302, url.toString());
}

router.get('/api/oidc/authorize', async (req, res) => {
  if (!ready()) return disabled(res);
  const q = req.query;
  // Until the client and redirect URI are proven valid there is nowhere safe
  // to send an error, so these answer directly instead of redirecting.
  const client = oidc.findClient(String(q.client_id || ''));
  if (!client) return res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client.' });
  const redirectUri = String(q.redirect_uri || '');
  if (!client.redirect_uris.includes(redirectUri)) return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is not registered for this client.' });

  const state = q.state ? String(q.state) : undefined;
  const fail = (error, description) => redirectWith(res, redirectUri, { error, error_description: description, state, iss: oidc.issuer() });

  if (q.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
  if (!state) return fail('invalid_request', 'state is required.');
  const scope = String(q.scope || '').split(/\s+/).filter(Boolean);
  if (!scope.includes('openid')) return fail('invalid_scope', 'scope must include openid.');
  if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(String(q.code_challenge || ''))) {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }

  const token = parseCookies(req.headers.cookie).lb_session;
  const session = token ? await db.prepare('SELECT * FROM sessions WHERE session_token=?').get(token) : null;
  if (!session || new Date(session.expires_at) < new Date()) {
    // Not signed in: send the person to log in, then straight back here. The
    // frontend only follows a return_to that is a relative /api/oidc/authorize path.
    const back = encodeURIComponent(req.originalUrl);
    noStore(res);
    return res.redirect(302, `${FRONTEND_URL.replace(/\/$/, '')}/login?return_to=${back}`);
  }

  const principal = await oidc.principalForSession(session);
  if (!principal) return fail('login_required', 'Session is no longer valid.');
  if (principal.denied) return fail('access_denied', 'This account type cannot sign in to other Loadbyton sites.');

  const code = await oidc.issueCode({
    clientId: client.client_id, userId: principal.user.id, redirectUri,
    codeChallenge: String(q.code_challenge), nonce: q.nonce ? String(q.nonce) : null, scope: scope.join(' '),
  });
  return redirectWith(res, redirectUri, { code, state, iss: oidc.issuer() });
});

router.post('/api/oidc/token', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
  noStore(res);
  if (!ready()) return disabled(res);
  const client = oidc.authenticateClient(req);
  if (!client) return res.status(401).json({ error: 'invalid_client' });
  const b = req.body || {};
  if (b.grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
  const result = await oidc.exchangeCode({ client, code: b.code, redirectUri: b.redirect_uri, codeVerifier: b.code_verifier });
  if (result.error) return res.status(400).json({ error: result.error });
  const { _userId, ...tokens } = result;
  return res.json(tokens);
});

router.get('/api/oidc/userinfo', async (req, res) => {
  noStore(res);
  if (!ready()) return disabled(res);
  const m = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  const claims = m && oidc.verifyJwt(m[1]);
  if (!claims || !claims.client_id) return res.status(401).json({ error: 'invalid_token' });
  const user = await db.prepare('SELECT * FROM users WHERE subject_id=? AND is_active=1').get(claims.sub);
  if (!user) return res.status(401).json({ error: 'invalid_token' });
  const principal = await oidc.principalForUser(user.id);
  if (!principal || principal.denied) return res.status(403).json({ error: 'access_denied' });
  return res.json({
    sub: principal.user.subject_id, email: principal.user.email, email_verified: !!principal.user.email_verified_at,
    name: principal.user.display_name || principal.org.name,
    org_sub: principal.org.subject_id, org_name: principal.org.name, org_role: principal.orgRole,
    org_verified: principal.org.verification_status === 'VERIFIED',
  });
});

module.exports = router;
