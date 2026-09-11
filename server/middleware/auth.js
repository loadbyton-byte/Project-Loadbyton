const bcrypt = require('bcryptjs');
const db = require('../db');
const { parseCookies } = require('../lib/http');
const { SEAT_ROLES } = require('../lib/constants');
const { rateLimiter } = require('../lib/rateLimit');
const { hasPermission } = require('../lib/permissions');
const { resolveActingSeat } = require('../lib/helpers');
const totp = require('../lib/totp');

// A DRIVER seat is deliberately the most restricted account this platform
// has — its req.user is still the carrier owner's full row (see the
// session model comment on auth() below), so without an explicit allowlist
// it would inherit every read the owner or an OPS/FINANCE/VIEWER seat can
// do (fleet, earnings, every job the carrier has ever touched). This is
// the single default-deny boundary for that: every route a DRIVER seat may
// reach at all is listed here; everything else 403s before the route
// handler runs. Per-job ownership (only *their* assigned job, not every
// job the carrier has) is enforced separately, inside
// isParticipantOrBidder/isPartyOnJob/canViewJob (lib/helpers.js) and
// messaging.js, which the routes below already call.
// Change 27 role aliases — new account types reuse existing route guards
// without rewriting every allow-list:
//   FORWARDER → satisfies SHIPPER checks (posts jobs, awards, confirms)
//   OWNER_OPERATOR → satisfies CARRIER checks (bids, executes, POD)
//   BROKER → satisfies BOTH (posts + direct-assigns), with the disclosed
//     one-hop rule enforced at the job level (see broker.routes.js), not here.
function roleSatisfies(userRole, allowedRoles) {
  if (allowedRoles.includes(userRole)) return true;
  if (userRole === 'FORWARDER' && allowedRoles.includes('SHIPPER')) return true;
  if (userRole === 'OWNER_OPERATOR' && allowedRoles.includes('CARRIER')) return true;
  if (userRole === 'BROKER' && (allowedRoles.includes('SHIPPER') || allowedRoles.includes('CARRIER'))) return true;
  return false;
}

const DRIVER_SEAT_ALLOWED_ROUTES = [  { method: 'GET', pattern: /^\/api\/auth\/me$/ },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/ },
  { method: 'GET', pattern: /^\/api\/driver\/job$/ },
  { method: 'GET', pattern: /^\/api\/driver\/wallet$/ },
  { method: 'GET', pattern: /^\/api\/driver\/trip-offer$/ },
  { method: 'POST', pattern: /^\/api\/driver\/trip-offer\/\d+\/respond$/ },
  { method: 'GET', pattern: /^\/api\/jobs\/\d+\/threads$/ },
  { method: 'GET', pattern: /^\/api\/jobs\/\d+\/messages$/ },
  { method: 'POST', pattern: /^\/api\/jobs\/\d+\/messages$/ },
  { method: 'GET', pattern: /^\/api\/notifications$/ },
  { method: 'POST', pattern: /^\/api\/notifications\/read$/ },
  // DriverLocationTracking.jsx (web/src/pages) is built specifically for
  // this seat role — it calls api.driverJob() (already allowed above) then
  // posts/reads location off the assigned job. Without these two, a
  // DRIVER/DRIVER_ASSOCIATE seat gets 403'd out of the one page meant for
  // them, and live tracking never works for an actual driver.
  { method: 'POST', pattern: /^\/api\/jobs\/\d+\/location$/ },
  { method: 'GET', pattern: /^\/api\/jobs\/\d+\/locations$/ },
];

const writeLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyFn: (req) => `write:${req.user ? req.user.id : req.ip}`,
  message: 'Too many write requests. Try again in a minute.',
});

const loginFailures = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;

function isThrottled(email) {
  const entry = loginFailures.get(email);
  if (!entry) return false;
  if (Date.now() - entry.start > LOGIN_WINDOW_MS) {
    loginFailures.delete(email);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordFailure(email) {
  let entry = loginFailures.get(email);
  if (!entry || Date.now() - entry.start > LOGIN_WINDOW_MS) {
    entry = { count: 0, start: Date.now() };
  }
  entry.count++;
  loginFailures.set(email, entry);
}

function clearThrottle(email) {
  loginFailures.delete(email);
}

function auth(allowedRoles) {
  return async (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.lb_session;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const session = await db.prepare('SELECT * FROM sessions WHERE session_token=?').get(token);
    if (!session) return res.status(401).json({ error: 'Invalid session' });
    if (new Date(session.expires_at) < new Date()) {
      await db.prepare('DELETE FROM sessions WHERE session_token=?').run(token);
      return res.status(401).json({ error: 'Session expired' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE id=? AND is_active=1').get(session.user_id);
    if (!user) return res.status(401).json({ error: 'Account not found or deactivated' });

    const profile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(user.id);
    const { actingSeatId, actingSeatRole } = await resolveActingSeat(session);
    req.user = { ...user, profile, actingSeatId, actingSeatRole };
    req.session = session;
    req.actorId = session.acting_seat_id || user.id;
    req.actorLabel = session.acting_seat_id
      ? `seat#${session.acting_seat_id} as ${user.email}`
      : user.email;

    if (allowedRoles && allowedRoles.length > 0) {
      if (!roleSatisfies(user.role, allowedRoles)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }

    if (actingSeatRole === 'DRIVER' || actingSeatRole === 'DRIVER_ASSOCIATE') {
      const permitted = DRIVER_SEAT_ALLOWED_ROUTES.some((r) => r.method === req.method && r.pattern.test(req.path));
      if (!permitted) return res.status(403).json({ error: 'Driver accounts can only view their assigned job and messages' });
    }

    next();
  };
}

function requireSeatRole(allowedSeatRoles) {
  return async (req, res, next) => {
    // auth() (always run first in every route chain that uses this) has
    // already resolved and attached the acting seat's role — no need to
    // hit the users table a second time.
    if (!req.user || !req.user.actingSeatId) return next();
    if (allowedSeatRoles && !allowedSeatRoles.includes(req.user.actingSeatRole)) {
      return res.status(403).json({ error: `Seat role ${req.user.actingSeatRole} not in [${allowedSeatRoles}]` });
    }
    next();
  };
}

// "New account starts PENDING and is read-only until an admin approves it"
// — stated in Shell.jsx's own banner ("posting, bidding, and other actions
// are disabled until an admin approves it") and disabled client-side on
// Dashboard.jsx's Post-a-job button, but never enforced server-side until
// this middleware: a PENDING account calling the API directly (bypassing
// the disabled button) could post jobs, bid, and dispatch freely. REJECTED
// accounts are already blocked entirely by auth()'s `is_active=1` check
// (verification.service.js sets is_active=0 on rejection) — this only
// needs to cover the PENDING case.
function requireApproved() {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.account_approval_status && req.user.account_approval_status !== 'APPROVED') {
      return res.status(403).json({ error: 'Your account is pending admin approval — this action is disabled until then.' });
    }
    next();
  };
}

// @deprecated No route in this repo applies this middleware — every route
// still gates on auth([...roles]) directly. The permission model it reads
// from (lib/permissions.js) is otherwise unused too. Left in place rather
// than deleted since it's a working, tested auth gate a future
// fine-grained-permissions rollout could wire in without rewriting it.
function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: `Missing permission: ${permission}`, code: 'FORBIDDEN' });
    }
    next();
  };
}

// Sensitive operations (IBAN change, payout account, ownership, admin role)
// require re-authentication: password + MFA if enabled. Prevents session
// hijack from escalating to financial fraud without fresh credentials.
function requireReauth({ requireMfa = true } = {}) {
  return async (req, res, next) => {
    const { password, totpCode } = req.body || {};
    if (!password) {
      return res.status(403).json({ error: 'Re-authentication required: password needed for sensitive operation', code: 'REAUTH_REQUIRED' });
    }
    // req.user is always the org owner's row for a seat login (see auth()
    // above) — re-auth must verify the actually-acting identity's own
    // password (req.actorId), or a seat could never pass this with their
    // own credentials, and would silently need the owner's password instead.
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.actorId);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(403).json({ error: 'Re-authentication failed: invalid password', code: 'REAUTH_FAILED' });
    }
    if (requireMfa && user.mfa_enabled) {
      if (!totpCode) {
        return res.status(403).json({ error: 'MFA code required for sensitive operation', code: 'MFA_REQUIRED' });
      }
      const ok = totp.verifyCode(user.mfa_secret, totpCode);
      if (!ok) return res.status(403).json({ error: 'Invalid MFA code', code: 'MFA_FAILED' });
    }
    next();
  };
}

// Session revocation — invalidate all sessions for a user (e.g., after
// password change, or admin deactivation).
// @deprecated The "Used by auth routes" claim this comment used to make no
// longer holds — grepping the repo turns up zero callers; password-change
// and deactivation flows don't currently revoke other sessions. Left in
// place (it's a correct, tested one-liner) rather than deleted, since
// wiring it back in looks like the right fix, not removing it.
async function revokeAllSessions(userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

module.exports = { auth, requireSeatRole, requireApproved, requirePermission, requireReauth, revokeAllSessions, writeLimiter, isThrottled, recordFailure, clearThrottle, roleSatisfies };
