const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { rateLimiter, byIp } = require('./lib/rateLimit');
const {
  cookieParser, requestId, securityHeaders, sendError,
} = require('./lib/http');
const { init: initSentry, requestHandler: sentryRequestHandler, expressErrorHandler: sentryErrorHandler } = require('./lib/sentry');
const { DIST_DIR, DIST_INDEX, isAllowedOrigin } = require('./lib/config');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(cookieParser);
app.use(requestId);
const { requestLogger } = require('./lib/logger');
app.use(requestLogger);
app.use(securityHeaders);

initSentry();
app.use(sentryRequestHandler());

const apiLimiter = rateLimiter({ windowMs: 60 * 1000, max: 300, keyFn: byIp });
app.use('/api', apiLimiter);
const authLimiter = rateLimiter({ windowMs: 60 * 1000, max: 20, keyFn: byIp, message: 'Too many auth requests from this address. Try again shortly.' });
app.use('/api/auth', authLimiter);

// CORS for browser origins other than the API's own host. When the SPA is
// served by this same Express process (or proxied behind one domain, e.g.
// Vercel rewriting /api to Render) the browser sees a same-origin request
// and none of this matters. It only kicks in when a page on an allowed
// origin calls this API directly cross-origin.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-request-id, x-internal-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(require('./routes/system.routes'));
app.use(require('./routes/auth.routes'));
app.use(require('./routes/public.routes'));
app.use(require('./routes/bids.routes'));
app.use(require('./routes/jobs.routes'));
app.use(require('./routes/job-lifecycle.routes'));
app.use(require('./routes/job-extras.routes'));
app.use(require('./routes/org.routes'));
app.use(require('./routes/retention.routes'));
app.use(require('./routes/docs.routes'));
app.use(require('./routes/admin.routes'));
app.use(require('./routes/stripe.routes'));
app.use(require('./routes/verify.routes'));
app.use(require('./routes/location.routes'));
app.use(require('./routes/telematics.routes'));
app.use(require('./routes/currency.routes'));
app.use(require('./routes/enterprise.routes'));
app.use(require('./routes/rfp.routes'));
app.use(require('./routes/edi.routes'));
app.use(require('./routes/compliance.routes'));
app.use(require('./routes/ledger.routes'));
app.use(require('./routes/ml.routes'));
app.use(require('./routes/audit.routes'));
app.use(require('./routes/fleet.routes'));

// =============================================================================
// 7. SEO pages, static SPA, fallback
// =============================================================================

const PRERENDER_DIR = path.join(DIST_DIR, '__prerendered__');

const SEO_META = {
  '/': { title: 'Loadbyton — UAE Road Freight & Container Drayage Marketplace', description: 'Post a freight job — container, flatbed, tripper, or a multi-truck volume inquiry — get verified-carrier bids across Dubai, Abu Dhabi, Sharjah and Fujairah, and move it under escrow with live tracking and payout on delivery.', slug: 'root' },
  '/features': { title: 'Features — Loadbyton', description: 'Escrow-backed drayage jobs, live tracking, contract lanes and a verified carrier network — everything Loadbyton ships.', slug: 'features' },
  '/pricing': { title: 'Pricing — Loadbyton', description: 'A transparent 6% take rate, no subscription. See how Loadbyton pricing compares to broker markups.', slug: 'pricing' },
  '/about': { title: 'About — Loadbyton', description: 'Loadbyton is a UAE container drayage marketplace built to make the second shipment happen on-platform, not on WhatsApp.', slug: 'about' },
  '/blog': { title: 'Blog — Loadbyton', description: 'Notes on UAE drayage logistics and building a freight marketplace that survives past the first job.', slug: 'blog' },
  '/security': { title: 'Security — Loadbyton', description: 'How Loadbyton protects account, financial, and shipment data — what is built today, and what is on the roadmap.', slug: 'security' },
  '/compliance': { title: 'Compliance — Loadbyton', description: 'How Loadbyton handles personal data under UAE PDPL, VAT invoicing, and where account data is hosted.', slug: 'compliance' },
  '/terms': { title: 'Terms of Service — Loadbyton', description: 'Loadbyton Terms of Service — governing your use of the UAE road freight & container drayage marketplace.', slug: 'terms' },
  '/privacy': { title: 'Privacy Policy — Loadbyton', description: 'Loadbyton Privacy Policy — how we collect, use, protect, and share your personal data under UAE PDPL.', slug: 'privacy' },
};

// gstack review F4: these previously fell through to the SPA catch-all,
// so a crawler requesting either got a 200 of app-shell HTML instead of
// directives/a URL list. Built from the request's own host rather than a
// hardcoded domain, so this stays correct across environments (local,
// staging, a future custom domain) without a config knob.
function siteOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

const PUBLIC_APP_PATHS_DISALLOWED = [
  '/dashboard', '/open-loads', '/my-bids', '/won-jobs', '/earnings', '/jobs/', '/profile',
  '/templates', '/contracts', '/notifications', '/admin', '/verify-email', '/reset-password', '/forgot-password',
];

app.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600').type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      ...PUBLIC_APP_PATHS_DISALLOWED.map((p) => `Disallow: ${p}`),
      '',
      `Sitemap: ${siteOrigin(req)}/sitemap.xml`,
      '',
    ].join('\n')
  );
});

app.get('/sitemap.xml', (req, res) => {
  const origin = siteOrigin(req);
  const urls = Object.keys(SEO_META)
    .map((p) => `  <url><loc>${origin}${p}</loc></url>`)
    .join('\n');
  res
    .set('Cache-Control', 'public, max-age=3600')
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// Reads once at boot rather than per-request — these files only ever
// change on a fresh deploy (a new build), never while the process is
// running, so there's no staleness risk from caching them in memory.
const prerenderedCache = {};
function loadPrerendered(slug) {
  if (slug in prerenderedCache) return prerenderedCache[slug];
  const file = path.join(PRERENDER_DIR, `${slug}.html`);
  const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  prerenderedCache[slug] = html;
  return html;
}

function renderSeoPage(res, meta) {
  if (!fs.existsSync(DIST_INDEX)) {
    return res
      .status(200)
      .set('Content-Type', 'text/html')
      .send(`<!doctype html><html><head><title>${meta.title}</title><meta name="description" content="${meta.description}"></head><body><p>Build the frontend (<code>cd web && npm run build</code>) to see this page rendered with the SPA shell.</p></body></html>`);
  }
  let html = fs.readFileSync(DIST_INDEX, 'utf8');
  html = html.replace(/<title>.*?<\/title>/, `<title>${meta.title}</title>`);
  // Replace each existing meta tag's content in place rather than appending
  // duplicates — the built index.html already ships default SEO tags.
  const replacements = [
    [/(<meta name="description" content=")[^"]*(")/, `$1${meta.description}$2`],
    [/(<meta property="og:title" content=")[^"]*(")/, `$1${meta.title}$2`],
    [/(<meta property="og:description" content=")[^"]*(")/, `$1${meta.description}$2`],
    [/(<meta name="twitter:title" content=")[^"]*(")/, `$1${meta.title}$2`],
    [/(<meta name="twitter:description" content=")[^"]*(")/, `$1${meta.description}$2`],
  ];
  for (const [pattern, replacement] of replacements) html = html.replace(pattern, replacement);

  // The actual crawlability fix: splice build-time-prerendered markup into
  // the root div, so a non-JS fetcher (a search crawler, a link-preview
  // bot, WebFetch) sees the real page instead of an empty shell. Falls
  // back to the untouched empty div — same behavior as before this existed
  // — if prerendering never ran for this route. This is prerendering for
  // crawlers, not hydration: main.jsx still boots with plain createRoot(),
  // which replaces this markup the moment client JS mounts (Landing.jsx has
  // its own guard against the resulting entrance-animation replay).
  const prerendered = meta.slug ? loadPrerendered(meta.slug) : null;
  if (prerendered) {
    html = html.replace('<div id="root"></div>', `<div id="root">${prerendered}</div>`);
  }

  // gstack review F26, fixed independently on both branches — kept main's
  // no-cache (not no-store): still cacheable, but every load revalidates
  // against the ETag Express already attaches to res.send, so a repeat
  // visitor gets a cheap 304 instead of skipping the request entirely,
  // while still always seeing the current build. HTML must never be cached
  // long regardless — it's what points a repeat visitor at the *current*
  // hashed asset filenames.
  res.status(200).set('Content-Type', 'text/html').set('Cache-Control', 'no-cache').send(html);
}

if (fs.existsSync(DIST_DIR)) {
  app.use(
    express.static(DIST_DIR, {
      index: false,
      // gstack review F26, fixed independently on both branches — kept
      // main's version. Only /assets/* filenames are content-hashed by the
      // Vite build (index-<hash>.js/.css) — a change in content is
      // guaranteed to be a change in URL, so these can be cached forever.
      // Everything else under dist (favicon.svg, brand/*.svg,
      // __prerendered__/*) keeps express.static's own default (effectively
      // no caching), since those filenames don't change when their content
      // does.
      setHeaders(res, filePath) {
        if (path.join(DIST_DIR, 'assets') === path.dirname(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
}

app.get(['/', '/features', '/pricing', '/about', '/blog', '/security', '/compliance', '/terms', '/privacy'], (req, res) => renderSeoPage(res, SEO_META[req.path]));

// F4 was fixed independently on both branches — the /robots.txt and
// /sitemap.xml handlers above (registered right after SEO_META) are the
// surviving implementation; this branch's version disallows the
// authenticated app routes specifically rather than a blanket `/api/`
// only, which is the more precise crawl-budget signal.

app.use('/api', (req, res) => sendError(res, 404, 'Not found'));

app.get('*', (req, res) => {
  if (!fs.existsSync(DIST_INDEX)) {
    return res.status(200).send('Loadbyton API is running. Start the Vite dev server in web/ (npm run dev) or build it (npm run build) to serve the SPA from here.');
  }
  res.sendFile(DIST_INDEX, { headers: { 'Cache-Control': 'no-cache' } });
});

// Sentry error handler — must be before the catch-all error handler
app.use(sentryErrorHandler());

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // Also capture to Sentry if not already handled
  const { captureException } = require('./lib/sentry');
  captureException(err, { requestId: req.requestId, userId: req.user?.id });
  sendError(res, 500, 'Internal server error');
});

module.exports = app;
