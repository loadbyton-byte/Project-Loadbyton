const crypto = require('node:crypto');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Minimal cookie parser — avoids pulling in a dependency for one header.
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function cookieParser(req, _res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  next();
}

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.requestId = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomToken(8);
  res.setHeader('x-request-id', req.requestId);
  next();
}

// index.html carries a tiny inline script that applies the saved light/dark
// theme before first paint. The CSP below has no 'unsafe-inline' for scripts,
// so the browser refused to run it ("Refused to execute inline script...") and
// dark-mode users got a flash of the light theme on every load. Allow exactly
// that one script by its SHA-256 hash, computed from the built index.html so
// it stays correct whenever the script is edited. Nothing else inline is
// allowed (the Google Analytics loader in the same file stays blocked).
let themeScriptSource;
function themeScriptCspSource() {
  if (themeScriptSource !== undefined) return themeScriptSource;
  themeScriptSource = '';
  try {
    const html = require('node:fs').readFileSync(require('./config').DIST_INDEX, 'utf8');
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      if (m[1].includes('loadbyton-theme')) {
        themeScriptSource = ` 'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`;
        break;
      }
    }
  } catch { /* no built SPA next to the server (API-only deploy) — nothing to allow */ }
  return themeScriptSource;
}

// Helmet-style security headers, hand-rolled to avoid an extra dependency.
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org https://api.mapbox.com https://*.stripe.com; style-src 'self' 'unsafe-inline' https://api.mapbox.com; font-src 'self' data:; script-src 'self'${themeScriptCspSource()} https://api.mapbox.com https://js.stripe.com; connect-src 'self' https://nominatim.openstreetmap.org https://api.mapbox.com https://api.stripe.com https://*.sentry.io; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  );
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  // Cache control: API responses must not be cached by intermediaries
  if (req.path && req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

function sendError(res, status, message, code = 'ERROR') {
  // Migrated to new envelope: adds success:false + _legacy + requestId while
  // keeping legacy `error` as string so existing tests checking `body.error`
  // (string) still pass. New clients should check `success` / `errorDetails`.
  return res.status(status).json({
    success: false,
    error: message,
    code,
    message,
    _legacy: { error: message },
    errorDetails: { code, message },
    requestId: null,
  });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// attempt: 0..2 keep the familiar 4-digit suffix (LBT-DXB-2610-4821); later
// attempts widen to 6 digits. A month only has 9,000 four-digit codes, and
// jobs.job_code is UNIQUE — with no retry, posting started failing at random
// (a raw unique-violation 500) at a few hundred jobs a month, and would fail
// every time once the month's 9,000 codes were used up. Callers retry with
// an incremented attempt on a unique violation (see isUniqueViolation).
function jobCode(attempt = 0) {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const suffix = attempt < 3 ? crypto.randomInt(1000, 10000) : crypto.randomInt(100000, 1000000);
  return `LBT-DXB-${yy}${mm}-${suffix}`;
}

// Unique/primary-key violation on either engine: Postgres reports SQLSTATE
// 23505; node:sqlite throws "UNIQUE constraint failed: <table>.<column>".
// Pass a column name to only match a violation of that specific column.
function isUniqueViolation(e, column) {
  if (!e) return false;
  const msg = String(e.message || '');
  const isUnique = e.code === '23505' || /UNIQUE constraint failed/i.test(msg) || /violates unique constraint/i.test(msg);
  if (!isUnique) return false;
  return column ? msg.includes(column) || String(e.constraint || '').includes(column) : true;
}

function referralCode(prefix, companyName) {
  const slug = (companyName || 'MEMBER')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 8) || 'MEMBER';
  const suffix = crypto.randomInt(10, 100);
  return `${prefix}-${slug}-${suffix}`;
}

module.exports = {
  randomToken,
  parseCookies,
  cookieParser,
  requestId,
  securityHeaders,
  sendError,
  asyncHandler,
  jobCode,
  isUniqueViolation,
  referralCode,
};
