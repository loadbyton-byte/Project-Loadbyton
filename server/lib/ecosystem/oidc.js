// Minimal OpenID Connect issuer so other Loadbyton domains can sign people in
// with their loadbyton.com account (master plan §9).
//
// Authorization-code flow with PKCE (S256 only), state, nonce, exact redirect
// URI matching against a per-client allowlist, confidential clients
// (client_secret_post / client_secret_basic), RS256 tokens. Tokens are issued
// to the relying party's server; nothing is put in a URL except the
// single-use, 5-minute authorization code. No refresh tokens: the relying
// party keeps its own short per-domain session.
//
// Configuration (environment):
//   OIDC_CLIENTS          JSON array: [{ "client_id", "client_secret", "redirect_uris": [...] }]
//   OIDC_SIGNING_KEY_PEM  RSA private key (PEM, "\n" escapes allowed). Without it
//                         a process-local key is generated outside production;
//                         in production the issuer refuses to start without it.
//   OIDC_ISSUER           defaults to `${FRONTEND_URL}/api/oidc` so the issuer is
//                         served through the same origin as the session cookie.

'use strict';

const crypto = require('node:crypto');
const db = require('../../db');
const { FRONTEND_URL } = require('../config');
const { getOrganisationForUser, ensureSubjectId } = require('./orgs');

const CODE_TTL_SECONDS = 300;
const ID_TOKEN_TTL_SECONDS = 600;
const ACCESS_TOKEN_TTL_SECONDS = 600;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

let keyCache = null;
function signingKey() {
  if (keyCache) return keyCache;
  const pem = (process.env.OIDC_SIGNING_KEY_PEM || '').replace(/\\n/g, '\n').trim();
  let privateKey;
  if (pem) {
    privateKey = crypto.createPrivateKey(pem);
  } else if (process.env.NODE_ENV === 'production') {
    return null;
  } else {
    privateKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = b64url(crypto.createHash('sha256').update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })).digest());
  keyCache = { privateKey, publicKey, kid, jwk: { ...jwk, kid, use: 'sig', alg: 'RS256' } };
  return keyCache;
}

const issuer = () => (process.env.OIDC_ISSUER || `${FRONTEND_URL.replace(/\/$/, '')}/api/oidc`).replace(/\/$/, '');

function clients() {
  try {
    const parsed = JSON.parse(process.env.OIDC_CLIENTS || '[]');
    return Array.isArray(parsed) ? parsed.filter((c) => c && c.client_id && Array.isArray(c.redirect_uris)) : [];
  } catch { return []; }
}
const findClient = (clientId) => clients().find((c) => c.client_id === clientId) || null;

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function authenticateClient(req) {
  let id; let secret;
  const basic = /^Basic (.+)$/i.exec(req.headers.authorization || '');
  if (basic) {
    const [i, ...rest] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
    id = decodeURIComponent(i); secret = decodeURIComponent(rest.join(':'));
  } else {
    id = req.body && req.body.client_id; secret = req.body && req.body.client_secret;
  }
  const client = id && findClient(id);
  if (!client || !client.client_secret || !secret || !safeEqual(client.client_secret, secret)) return null;
  return client;
}

function signJwt(payload, header = {}) {
  const key = signingKey();
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key.privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

function verifyJwt(token, { audience } = {}) {
  const key = signingKey();
  const parts = String(token || '').split('.');
  if (!key || parts.length !== 3) return null;
  let header; let payload;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); payload = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { return null; }
  if (header.alg !== 'RS256' || header.kid !== key.kid) return null;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key.publicKey, Buffer.from(parts[2], 'base64url'));
  if (!ok || payload.iss !== issuer() || payload.exp * 1000 < Date.now()) return null;
  if (audience && payload.aud !== audience) return null;
  return payload;
}

// The person a code is issued for: the acting seat if a seat logged in,
// otherwise the account owner. Platform staff and driver seats do not get
// company single sign-on.
async function principalForUser(actorId) {
  const actor = await db.prepare('SELECT * FROM users WHERE id=? AND is_active=1').get(actorId);
  if (!actor) return null;
  if (['DRIVER', 'DRIVER_ASSOCIATE'].includes(actor.seat_role)) return { denied: 'driver_seat' };
  const ctx = await getOrganisationForUser(actor.id);
  if (!ctx) return { denied: 'no_organisation' };
  await ensureSubjectId(actor.id);
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(actor.id);
  return { user, org: ctx.org, orgRole: ctx.orgRole, root: ctx.root };
}

async function principalForSession(session) {
  if (!session) return null;
  const owner = await db.prepare('SELECT id FROM users WHERE id=? AND is_active=1').get(session.user_id);
  if (!owner) return null;
  return principalForUser(session.acting_seat_id || owner.id);
}

async function issueCode({ clientId, userId, redirectUri, codeChallenge, nonce, scope, now = new Date() }) {
  const code = crypto.randomBytes(32).toString('base64url');
  await db.prepare(
    `INSERT INTO oidc_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, nonce, scope, auth_time, expires_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(sha256Hex(code), clientId, userId, redirectUri, codeChallenge, nonce || null, scope, now.toISOString(),
      new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString());
  return code;
}

// Exchanges a code for tokens. Returns { error } on any failure; the code is
// burned on first presentation whether or not the rest of the checks pass, so
// a stolen code cannot be retried with guessed parameters.
async function exchangeCode({ client, code, redirectUri, codeVerifier, now = new Date() }) {
  const hash = sha256Hex(String(code || ''));
  const row = await db.prepare('SELECT * FROM oidc_codes WHERE code_hash=?').get(hash);
  if (!row) return { error: 'invalid_grant' };
  const burned = await db.prepare('UPDATE oidc_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL').run(now.toISOString(), hash);
  if (!burned.changes) return { error: 'invalid_grant' };
  if (row.client_id !== client.client_id || row.redirect_uri !== redirectUri || new Date(row.expires_at) < now) return { error: 'invalid_grant' };
  const challenge = b64url(crypto.createHash('sha256').update(String(codeVerifier || '')).digest());
  if (!codeVerifier || !safeEqual(challenge, row.code_challenge)) return { error: 'invalid_grant' };

  const principal = await principalForUser(row.user_id);
  if (!principal || principal.denied) return { error: 'access_denied' };

  const iat = Math.floor(now.getTime() / 1000);
  const base = { iss: issuer(), sub: principal.user.subject_id, aud: client.client_id, iat };
  const idToken = signJwt({
    ...base, exp: iat + ID_TOKEN_TTL_SECONDS, auth_time: Math.floor(new Date(row.auth_time).getTime() / 1000),
    nonce: row.nonce || undefined,
    email: principal.user.email, email_verified: !!principal.user.email_verified_at,
    name: principal.user.display_name || principal.org.name,
    org_sub: principal.org.subject_id, org_name: principal.org.name, org_role: principal.orgRole,
    org_verified: principal.org.verification_status === 'VERIFIED',
  });
  const accessToken = signJwt({ ...base, exp: iat + ACCESS_TOKEN_TTL_SECONDS, scope: row.scope, client_id: client.client_id, jti: crypto.randomUUID() }, { typ: 'at+jwt' });
  return { id_token: idToken, access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, scope: row.scope };
}

module.exports = {
  issuer, clients, findClient, authenticateClient, signingKey, signJwt, verifyJwt,
  principalForSession, principalForUser, issueCode, exchangeCode, CODE_TTL_SECONDS,
};
