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

// Helmet-style security headers, hand-rolled to avoid an extra dependency.
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  // req.secure reflects the real client-facing protocol, not the internal
  // hop to this process, because app.set('trust proxy', ...) makes Express
  // read it off X-Forwarded-Proto. Gated so a plain-HTTP local dev server
  // never emits it — browsers ignore HSTS over HTTP anyway, but there's no
  // reason to send a header that doesn't apply.
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  res.setHeader(
    'Content-Security-Policy',
    // Added Mapbox + telematics carve-outs (Phase 3/5) alongside OSM/Nominatim
    "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org https://api.mapbox.com https://*.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.mapbox.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' https://api.mapbox.com https://js.stripe.com; connect-src 'self' https://nominatim.openstreetmap.org https://api.mapbox.com https://api.stripe.com https://*.sentry.io; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  // Loadbyton never asks for any of these browser capabilities — deny them
  // outright rather than leaving the default (permissive) policy in place.
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  next();
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function jobCode() {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const suffix = crypto.randomInt(1000, 10000);
  return `LBT-DXB-${yy}${mm}-${suffix}`;
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
  referralCode,
};
