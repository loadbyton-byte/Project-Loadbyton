const db = require('../db');
const { sendError } = require('../lib/http');
const { rateLimiter, byIp } = require('../lib/rateLimit');
const { writeAudit } = require('../lib/helpers');

const writeLimiter = rateLimiter({ windowMs: 60 * 1000, max: 30, keyFn: byIp, message: 'Too many requests. Slow down and try again.' });

// Account approval gate: until an admin approves a newly registered
// shipper/carrier account, the user may browse (all GET endpoints) but
// cannot perform ANY workflow action — the read-only demo mode. Enforced
// here, inside auth(), the single choke-point every authenticated route
// passes through, so no future route can silently skip it. Housekeeping
// routes a pending account still needs are exempt (auth flows, profile
// fixes, notification prefs). Admins are always exempt; the UI mirrors this
// with a banner, but the enforcement is server-side.
const APPROVAL_EXEMPT_PREFIXES = ['/api/auth/', '/api/system/'];
const APPROVAL_EXEMPT_EXACT = new Set([
  '/api/profile',
  '/api/notifications/read',
  '/api/notifications/preferences',
]);
function isApprovalExempt(path) {
  if (APPROVAL_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return true;
  return APPROVAL_EXEMPT_EXACT.has(path);
}

function auth(roles) {
  return (req, res, next) => {
    const token = req.cookies.lb_session;
    if (!token) return sendError(res, 401, 'Not authenticated');
    const session = db.prepare('SELECT * FROM sessions WHERE session_token=?').get(token);
    if (!session || new Date(session.expires_at) < new Date()) return sendError(res, 401, 'Session expired');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
    if (!user) return sendError(res, 401, 'Not authenticated');
    const profile = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(user.id);
    req.user = { ...user, profile };
    req.session = session;

    req.actorId = user.id;
    req.seatRole = null;
    req.actorLabel = user.email;
    if (session.acting_seat_id) {
      const seat = db.prepare('SELECT * FROM users WHERE id=?').get(session.acting_seat_id);
      if (!seat || !seat.is_active) return sendError(res, 401, 'This seat has been deactivated');
      req.actorId = seat.id;
      req.seatRole = seat.seat_role;
      req.actorLabel = seat.display_name || seat.email;
    }

    if (roles && roles.length && !roles.includes(user.role)) return sendError(res, 403, 'Not permitted for this role');

    // Pending-approval accounts are read-only: browse works, nothing that
    // changes state does. (GETs on protected routes are fine — listing and
    // viewing is exactly what "just view everything" means.)
    const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (isWrite && user.role !== 'ADMIN' && (user.account_approval_status || 'PENDING') !== 'APPROVED' && !isApprovalExempt(req.path)) {
      return sendError(
        res,
        403,
        'Your account is pending admin approval — you can browse, but this action is unavailable until an admin approves your account.'
      );
    }
    next();
  };
}

// Gates a mutating action to org roots (req.seatRole === null) and seats
// whose seat_role is in the allow-list. A VIEWER or FINANCE seat hitting
// "post a job" or "place a bid" must get the same 403 a wrong role would —
// this is the enforcement point for that, applied per-route below.
function requireSeatRole(allowed) {
  return (req, res, next) => {
    if (req.seatRole === null) return next(); // org root — full access
    if (allowed.includes(req.seatRole)) return next();
    return sendError(res, 403, `Your seat role (${req.seatRole}) cannot perform this action`);
  };
}

// Per-email login throttle — in-process, resets on restart. 8 fails / 15 min.
const loginAttempts = new Map();
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const THROTTLE_MAX = 8;

function isThrottled(email) {
  const rec = loginAttempts.get(email);
  if (!rec) return false;
  if (Date.now() - rec.firstFailAt > THROTTLE_WINDOW_MS) {
    loginAttempts.delete(email);
    return false;
  }
  return rec.count >= THROTTLE_MAX;
}

function recordFailure(email) {
  const rec = loginAttempts.get(email);
  if (!rec || Date.now() - rec.firstFailAt > THROTTLE_WINDOW_MS) {
    loginAttempts.set(email, { count: 1, firstFailAt: Date.now() });
  } else {
    rec.count += 1;
  }
}

function clearThrottle(email) {
  loginAttempts.delete(email);
}

module.exports = { auth, requireSeatRole, writeLimiter, isThrottled, recordFailure, clearThrottle };
