// Vercel serves web/dist as plain static files — there's no Express process
// there to run server/index.js's renderSeoPage per-request. This script
// does the same splice (title/meta tags + the build-time-prerendered
// fragment from scripts/prerender.mjs) once, at build time, and writes a
// fully-formed static HTML file per public route so a crawler still gets
// real content on Vercel exactly like it does on the Express deploy path
// (Render/Oracle Cloud).
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

// Single source of truth, ../seo-meta.json (repo root) — this used to be a
// hand-copied object here AND in server/app.js, with only a code comment
// ("must match X exactly") holding the two in sync. Both now read the same
// file instead.
const SEO_META = JSON.parse(fs.readFileSync(path.join(webRoot, '..', 'seo-meta.json'), 'utf8'));

const PUBLIC_APP_PATHS_DISALLOWED = [
  '/dashboard', '/open-loads', '/my-bids', '/won-jobs', '/earnings', '/jobs/', '/profile',
  '/templates', '/contracts', '/notifications', '/admin', '/verify-email', '/reset-password', '/forgot-password',
];

// Always canonicalize to the real production domain, even on a preview
// deployment — a leaked/crawled preview URL should still point search
// engines at the one production URL, not a throwaway *.vercel.app one.
// SITE_ORIGIN remains overridable (e.g. a staging domain) via env.
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://loadbyton.com';

function loadPrerendered(slug) {
  const file = path.join(prerenderDir, `${slug}.html`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function renderSeoHtml(baseHtml, meta, route) {
  let html = baseHtml.replace(/<title>.*?<\/title>/, `<title>${meta.title}</title>`);
  const canonicalUrl = `${SITE_ORIGIN}${route === '/' ? '/' : route}`;
  const replacements = [
    [/(<meta name="description" content=")[^"]*(")/, `$1${meta.description}$2`],
    [/(<meta property="og:title" content=")[^"]*(")/, `$1${meta.title}$2`],
    [/(<meta property="og:description" content=")[^"]*(")/, `$1${meta.description}$2`],
    [/(<meta name="twitter:title" content=")[^"]*(")/, `$1${meta.title}$2`],
    [/(<meta name="twitter:description" content=")[^"]*(")/, `$1${meta.description}$2`],
    [/(<link rel="canonical" href=")[^"]*(")/, `$1${canonicalUrl}$2`],
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
    const html = renderSeoHtml(baseHtml, meta, route);
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
