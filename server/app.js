const express = require('express');
const path = require('node:path');
const { FRONTEND_URL, ADDITIONAL_ORIGINS, DIST_DIR, DIST_INDEX } = require('./lib/config');
const { cookieParser, requestId, securityHeaders } = require('./lib/http');
const sentry = require('./lib/sentry');
const { requestLogger } = require('./lib/logger');

sentry.init();

const app = express();
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-request-id,x-internal-key,x-setup-key');
  const origin = req.headers.origin;
  // Use centralized origin check from config to avoid duplication drift
  const { isAllowedOrigin: isAllowed } = require('./lib/config');
  if (isAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({
  limit: '2mb',
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

app.use(cookieParser);
app.use(requestId);
app.use(securityHeaders);
app.use(sentry.requestHandler());
app.use(requestLogger);

const routes = [
  './routes/auth.routes',
  './routes/jobs.routes',
  './routes/job-lifecycle.routes',
  './routes/job-extras.routes',
  './routes/bids.routes',
  './routes/admin.routes',
  './routes/verify.routes',
  './routes/system.routes',
  './routes/public.routes',
  './routes/audit.routes',
  './routes/compliance.routes',
  './routes/currency.routes',
  './routes/docs.routes',
  './routes/driver.routes',
  './routes/edi.routes',
  './routes/enterprise.routes',
  './routes/fleet.routes',
  './routes/ledger.routes',
  './routes/location.routes',
  './routes/ml.routes',
  './routes/org.routes',
  './routes/retention.routes',
  './routes/rfp.routes',
  './routes/stripe.routes',
  './routes/telematics.routes',
];
for (const r of routes) {
  try {
    app.use(require(r));
  } catch (err) {
    console.error(`[app] Failed to load route ${r}:`, err.message);
    if (process.env.NODE_ENV !== 'production') throw err;
  }
}

// Mirrors web/scripts/vercel-static-seo.mjs's SEO_META — that script covers
// the live Vercel-static deploy path, this covers the Express-serves-the-SPA
// path (docker-compose / Oracle Cloud / any non-Vercel deploy). Keep both in
// sync if either changes; this list is small and rarely edited.
const SEO_META = {
  '/': { title: 'Loadbyton — UAE Road Freight & Container Drayage Marketplace', description: 'Post a freight job — container, flatbed, tripper, or a multi-truck volume inquiry — get verified-carrier bids across Dubai, Abu Dhabi, Sharjah and Fujairah, and move it under escrow with live tracking and payout on delivery.' },
  '/features': { title: 'Features — Loadbyton', description: 'Escrow-backed drayage jobs, live tracking, contract lanes and a verified carrier network — everything Loadbyton ships.' },
  '/pricing': { title: 'Pricing — Loadbyton', description: 'A transparent 6% take rate, no subscription. See how Loadbyton pricing compares to broker markups.' },
  '/about': { title: 'About — Loadbyton', description: 'Loadbyton is a UAE container drayage marketplace built to make the second shipment happen on-platform, not on WhatsApp.' },
  '/blog': { title: 'Blog — Loadbyton', description: 'Notes on UAE drayage, demurrage, and building a freight marketplace that survives past the first job.' },
  '/security': { title: 'Security — Loadbyton', description: 'How Loadbyton protects account, financial, and shipment data — what is built today, and what is on the roadmap.' },
  '/compliance': { title: 'Compliance — Loadbyton', description: 'How Loadbyton handles personal data under UAE PDPL, VAT invoicing, and where account data is hosted.' },
  '/terms': { title: 'Terms of Service — Loadbyton', description: 'Loadbyton Terms of Service — governing your use of the UAE road freight & container drayage marketplace.' },
  '/privacy': { title: 'Privacy Policy — Loadbyton', description: 'Loadbyton Privacy Policy — how we collect, use, protect, and share your personal data under UAE PDPL.' },
};
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://loadbyton.com';

function renderSeoHtml(baseHtml, meta, route) {
  let html = baseHtml.replace(/<title>.*?<\/title>/, `<title>${meta.title}</title>`);
  const canonicalUrl = `${SITE_ORIGIN}${route}`;
  const replacements = [
    [/(<meta name="description" content=")[^"]*(")/, `$1${meta.description}$2`],
    [/(<meta property="og:title" content=")[^"]*(")/, `$1${meta.title}$2`],
    [/(<meta property="og:description" content=")[^"]*(")/, `$1${meta.description}$2`],
    [/(<meta name="twitter:title" content=")[^"]*(")/, `$1${meta.title}$2`],
    [/(<meta name="twitter:description" content=")[^"]*(")/, `$1${meta.description}$2`],
    [/(<link rel="canonical" href=")[^"]*(")/, `$1${canonicalUrl}$2`],
  ];
  for (const [pattern, replacement] of replacements) html = html.replace(pattern, replacement);
  return html;
}

const fs = require('node:fs');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, {
    index: false,
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, filePath) => {
      // HTML must never be cached immutably — only hashed assets
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const prerenderFile = req.path === '/' ? 'root.html' : `${req.path.slice(1)}.html`;
    const prerenderPath = path.join(DIST_DIR, '__prerendered__', prerenderFile);
    const meta = SEO_META[req.path];
    if (fs.existsSync(prerenderPath)) {
      const prerendered = fs.readFileSync(prerenderPath, 'utf8');
      let index = fs.readFileSync(DIST_INDEX, 'utf8');
      if (meta) index = renderSeoHtml(index, meta, req.path);
      return res.type('html').send(index.replace('<div id="root"></div>', `<div id="root">${prerendered}</div>`));
    }
    res.sendFile(DIST_INDEX, (err) => { if (err) next(); });
  });
}

app.use(sentry.expressErrorHandler());

app.use((err, req, res, _next) => {
  if (err.status >= 500 || !err.status) {
    try { sentry.captureException(err, { requestId: req.requestId, userId: req.user?.id }); } catch {}
  }
  console.error(`[${req.requestId || 'unknown'}]`, err);
  const status = err.status || 500;
  // Enterprise envelope: always return structured error, hide 500 details in production
  const message = status >= 500 && process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(status).json({
    success: false,
    error: { code: err.code || 'INTERNAL', message },
    _legacy: { error: message },
    message,
    code: err.code || 'INTERNAL',
    requestId: req.requestId || null,
  });
});

module.exports = app;
