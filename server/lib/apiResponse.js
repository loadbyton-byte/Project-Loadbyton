// Canonical API envelope — every response uses the same shape so clients
// and contract tests can rely on it. Backwards compatible: existing
// routes that return { job } still work, but new code should use this.
const ERROR_CATALOG = {
  // Auth
  NOT_AUTHENTICATED: { status: 401, message: 'Not authenticated' },
  SESSION_EXPIRED: { status: 401, message: 'Session expired' },
  FORBIDDEN: { status: 403, message: 'Insufficient permissions' },
  REAUTH_REQUIRED: { status: 403, message: 'Re-authentication required' },
  // Jobs
  JOB_NOT_FOUND: { status: 404, message: 'Job not found' },
  JOB_ALREADY_AWARDED: { status: 409, message: 'Job already awarded' },
  JOB_NOT_OPEN: { status: 403, message: 'Job is not open' },
  BID_NOT_FOUND: { status: 404, message: 'Bid not found' },
  BID_NOT_PENDING: { status: 409, message: 'Bid is not pending' },
  // Payments
  PAYMENT_NOT_CONFIGURED: { status: 400, message: 'Payments not configured' },
  ESCROW_NOT_HELD: { status: 409, message: 'Escrow is not in HELD state' },
  // Payouts
  PAYOUT_DUPLICATE: { status: 409, message: 'Payout already submitted' },
  // General
  VALIDATION_FAILED: { status: 400, message: 'Validation failed' },
  RATE_LIMITED: { status: 429, message: 'Too many requests' },
  INTERNAL: { status: 500, message: 'Internal server error' },
};

function success(req, res, data, meta = {}, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    meta: { requestId: req.requestId || null, ...meta },
  });
}

function error(req, res, code, customMessage, extra = {}) {
  const catalog = ERROR_CATALOG[code] || ERROR_CATALOG.INTERNAL;
  const status = extra.status || catalog.status;
  const message = customMessage || catalog.message;
  // New envelope: success:false + structured error + _legacy for old clients
  // that still do `assert.equal(body.error, "Job not found")`. The _legacy
  // field preserves the string shape while `error` is the canonical object.
  return res.status(status).json({
    success: false,
    error: { code, message, ...extra },
    _legacy: { error: message },
    message,
    code,
    requestId: req.requestId || null,
  });
}

// Backwards-compatible sendError — wraps old { error: string } shape but
// also includes success:false and code for new clients that check it.
function sendErrorCompat(res, status, message, code = 'ERROR') {
  return res.status(status).json({ success: false, error: { code, message }, requestId: null, _legacy: { error: message } });
}

module.exports = { ERROR_CATALOG, success, error, sendErrorCompat };
