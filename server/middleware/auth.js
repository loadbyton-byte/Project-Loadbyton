const bcrypt = require('bcryptjs');
const db = require('../db');
const { parseCookies } = require('../lib/http');
const { SEAT_ROLES } = require('../lib/constants');
const { rateLimiter } = require('../lib/rateLimit');
const { hasPermission } = require('../lib/permissions');
const totp = require('../lib/totp');

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
    req.user = { ...user, profile };
    req.session = session;
    req.actorId = session.acting_seat_id || user.id;
    req.actorLabel = session.acting_seat_id
      ? `seat#${session.acting_seat_id} as ${user.email}`
      : user.email;

    if (allowedRoles && allowedRoles.length > 0) {
      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }

    next();
  };
}

function requireSeatRole(allowedSeatRoles) {
  return async (req, res, next) => {
    if (!req.session || !req.session.acting_seat_id) return next();
    const seat = await db.prepare('SELECT seat_role FROM users WHERE id=?').get(req.session.acting_seat_id);
    if (!seat) return res.status(403).json({ error: 'Seat account not found' });
    if (allowedSeatRoles && !allowedSeatRoles.includes(seat.seat_role)) {
      return res.status(403).json({ error: `Seat role ${seat.seat_role} not in [${allowedSeatRoles}]` });
    }
    next();
  };
}

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
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
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
// password change, or admin deactivation). Used by auth routes.
async function revokeAllSessions(userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

module.exports = { auth, requireSeatRole, requirePermission, requireReauth, revokeAllSessions, writeLimiter, isThrottled, recordFailure, clearThrottle };
