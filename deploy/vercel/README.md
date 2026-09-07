# Deploying the frontend to Vercel

**Status: already deployed.** Production frontend runs on Vercel; production
backend runs on Oracle Cloud (`deploy/oracle-cloud/`) against Supabase
Postgres. This doc is both the reference for how that's wired and the
runbook for redeploying from scratch if the project ever needs recreating.

Vercel runs serverless functions with an ephemeral filesystem — the backend
(`server/`) needs a persistent, stateful database connection (Postgres in
production, SQLite locally via Node's built-in `node:sqlite`), which doesn't
fit Vercel's model. So: **only the frontend (`web/`) is on Vercel.** The
backend runs on Oracle Cloud (`deploy/oracle-cloud/`), which provisions the
persistent compute this app needs; `render.yaml` remains as an alternative
one-click demo deploy target (`docs/DEMO_DEPLOY.md`), not the production host.

## What's already set up

- `vercel.json` (repo root) — build command, output directory, and the
  rewrites that make this work as a single-origin app from the browser's
  perspective (see below).
- `web/scripts/vercel-static-seo.mjs` — Vercel serves `web/dist` as plain
  static files, so there's no Express process there to run
  `server/index.js`'s `renderSeoPage` per request. This script does the same
  splice (per-route `<title>`/meta tags + the build-time-prerendered content
  from `web/scripts/prerender.mjs`) once, at build time, writing a real
  static HTML file per public route (`web/dist/features/index.html`, etc.)
  plus `robots.txt`/`sitemap.xml`. Verified locally serving `web/dist` with
  a plain static file server (no Express): a JS-disabled browser context
  still sees full real content on `/features`, and a normal browser
  hydrates and routes client-side with zero console errors. Only wired into
  `web/package.json`'s `build:vercel` script — the existing `npm run build`
  (used by `render.yaml` / `deploy/oracle-cloud/`) is untouched.

## Current configuration

1. **Backend URL is already wired in `vercel.json`** — the `/api/:path*`
   rewrite points at `https://api.loadbyton.com/api/:path*` (the Oracle
   Cloud-hosted backend). This makes Vercel transparently proxy API calls to
   the backend server-side — the browser only ever talks to the Vercel
   domain, so the `lb_session` cookie (`SameSite=Lax`) keeps working exactly
   like a single-process Express setup would. Pointing the frontend at the
   backend via `fetch` directly instead (cross-origin) would silently break
   login: `SameSite=Lax` cookies aren't sent on cross-site `fetch`/XHR, only
   top-level navigations.
2. **`SITE_ORIGIN`** is set as a Vercel project environment variable
   (Project Settings → Environment Variables) to the production domain —
   used to build absolute URLs in `sitemap.xml`. If ever unset, the build
   script falls back to Vercel's own `VERCEL_PROJECT_PRODUCTION_URL`/
   `VERCEL_URL`.
3. **`FRONTEND_URL`** is set on the *backend* host (Oracle Cloud) to the
   production Vercel domain — `server/app.js` reads it for CORS (see
   `docs/DEVELOPER_GUIDE.md`). With the rewrite proxy above, the browser
   never makes a cross-origin request, but the backend still needs to know
   its canonical frontend origin.

## Redeploying from scratch (if the project is ever recreated)

- **Dashboard**: vercel.com → New Project → import
  `loadbyton-byte/Project-Loadbyton` from GitHub. Vercel auto-detects
  `vercel.json` at the repo root — no manual build/output-directory config
  needed. Pushing to the branch Vercel is watching redeploys automatically.
- **CLI**: `npx vercel login`, then `npx vercel --prod` from the repo root.

Either way, redo the three steps above (backend URL in `vercel.json`,
`SITE_ORIGIN`, `FRONTEND_URL`) — until the `/api/:path*` rewrite points at a
real backend, every API call 404s and the app has nothing to log into.
