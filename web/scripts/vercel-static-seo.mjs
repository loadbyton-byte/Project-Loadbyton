// Vercel serves web/dist as plain static files — there's no Express process
// there to run server/index.js's renderSeoPage per-request. This script
// does the same splice (title/meta tags + the build-time-prerendered
// fragment from scripts/prerender.mjs) once, at build time, and writes a
// fully-formed static HTML file per public route so a crawler still gets
// real content on Vercel exactly like it does on the Express deploy path
// (Render/Oracle Cloud). Mirrors SEO_META/renderSeoPage in server/index.js —
// keep the two in sync if either changes.
//
// Only runs as part of the Vercel build (see package.json's "build:vercel"
// script) — the Express deploy path is untouched and keeps doing this
// per-request, so nothing here affects `npm run build` / render.yaml /
// deploy/oracle-cloud.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const distDir = path.join(webRoot, 'dist');
const indexPath = path.join(distDir, 'index.html');
const prerenderDir = path.join(distDir, '__prerendered__');

// Must match server/index.js's SEO_META exactly.
const SEO_META = {
  '/': { title: 'Loadbyton — UAE Road Freight & Container Drayage Marketplace', description: 'Post a freight job — container, flatbed, tripper, or a multi-truck volume inquiry — get verified-carrier bids across Dubai, Abu Dhabi, Sharjah and Fujairah, and move it under escrow with live tracking and payout on delivery.', slug: 'root' },
  '/features': { title: 'Features — Loadbyton', description: 'Escrow-backed drayage jobs, live tracking, contract lanes and a verified carrier network — everything Loadbyton ships.', slug: 'features' },
  '/pricing': { title: 'Pricing — Loadbyton', description: 'A transparent 6% take rate, no subscription. See how Loadbyton pricing compares to broker markups.', slug: 'pricing' },
  '/about': { title: 'About — Loadbyton', description: 'Loadbyton is a UAE container drayage marketplace built to make the second shipment happen on-platform, not on WhatsApp.', slug: 'about' },
  '/blog': { title: 'Blog — Loadbyton', description: 'Notes on UAE drayage, demurrage, and building a freight marketplace that survives past the first job.', slug: 'blog' },
  '/security': { title: 'Security — Loadbyton', description: 'How Loadbyton protects account, financial, and shipment data — what is built today, and what is on the roadmap.', slug: 'security' },
  '/compliance': { title: 'Compliance — Loadbyton', description: 'How Loadbyton handles personal data under UAE PDPL, VAT invoicing, and where account data is hosted.', slug: 'compliance' },
};

const PUBLIC_APP_PATHS_DISALLOWED = [
  '/dashboard', '/open-loads', '/my-bids', '/won-jobs', '/earnings', '/jobs/', '/profile',
  '/templates', '/contracts', '/notifications', '/admin', '/verify-email', '/reset-password', '/forgot-password',
];

// Set this to the real production domain once it's known (Vercel exposes
// it as VERCEL_PROJECT_PRODUCTION_URL at build time on the platform, no
// manual config needed for the common case).
const SITE_ORIGIN =
  process.env.SITE_ORIGIN ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
  'https://example.com';

function loadPrerendered(slug) {
  const file = path.join(prerenderDir, `${slug}.html`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function renderSeoHtml(baseHtml, meta) {
  let html = baseHtml.replace(/<title>.*?<\/title>/, `<title>${meta.title}</title>`);
  const replacements = [
    [/(<meta name="description" content=")[^"]*(")/, `$1${meta.description}$2`],
    [/(<meta property="og:title" content=")[^"]*(")/, `$1${meta.title}$2`],
    [/(<meta property="og:description" content=")[^"]*(")/, `$1${meta.description}$2`],
    [/(<meta name="twitter:title" content=")[^"]*(")/, `$1${meta.title}$2`],
    [/(<meta name="twitter:description" content=")[^"]*(")/, `$1${meta.description}$2`],
  ];
  for (const [pattern, replacement] of replacements) html = html.replace(pattern, replacement);
  const prerendered = meta.slug ? loadPrerendered(meta.slug) : null;
  if (prerendered) html = html.replace('<div id="root"></div>', `<div id="root">${prerendered}</div>`);
  return html;
}

function main() {
  if (!fs.existsSync(indexPath)) {
    console.error('[vercel-static-seo] dist/index.html not found — run vite build first.');
    process.exit(1);
  }
  const baseHtml = fs.readFileSync(indexPath, 'utf8');

  for (const [route, meta] of Object.entries(SEO_META)) {
    const html = renderSeoHtml(baseHtml, meta);
    if (route === '/') {
      // Overwrite the root index.html in place — Vercel serves this for "/"
      // by default, so the root route needs no extra rewrite.
      fs.writeFileSync(indexPath, html, 'utf8');
    } else {
      // Vercel (like any static host) resolves a clean URL to
      // <path>/index.html automatically — no rewrite needed for these
      // either, just the file in the right place.
      const dir = path.join(distDir, route.slice(1));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    }
    console.log(`[vercel-static-seo] ${route} -> static HTML written`);
  }

  fs.writeFileSync(
    path.join(distDir, 'robots.txt'),
    [
      'User-agent: *',
      'Allow: /',
      ...PUBLIC_APP_PATHS_DISALLOWED.map((p) => `Disallow: ${p}`),
      '',
      `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
      '',
    ].join('\n'),
    'utf8'
  );

  const urls = Object.keys(SEO_META).map((p) => `  <url><loc>${SITE_ORIGIN}${p}</loc></url>`).join('\n');
  fs.writeFileSync(
    path.join(distDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    'utf8'
  );
  console.log(`[vercel-static-seo] robots.txt / sitemap.xml written (origin: ${SITE_ORIGIN})`);
}

main();
