# Deploying the frontend to Vercel

Vercel runs serverless functions with an ephemeral filesystem — the backend
(`server/`) stores everything (users, jobs, escrow, the audit log) in a local
SQLite file via Node's built-in `node:sqlite`, which would reset on every
cold start there. the project keeps dependencies minimal by design — swapping in a hosted DB
driver, and `render.yaml` already documents why the backend needs a
persistent disk. So: **only the frontend (`web/`) goes on Vercel.** The
backend stays on Render (`render.yaml`, repo root) or Oracle Cloud
(`deploy/oracle-cloud/`) — either already provisions the persistent disk
this app needs.

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

## What you need to fill in

1. **Deploy the backend first** (Render or Oracle Cloud — see the sibling
   `deploy/` folders) and note its public URL.
2. **Edit `vercel.json`** at the repo root: replace
   `https://REPLACE-WITH-YOUR-BACKEND-HOST` in the `/api/:path*` rewrite
   with that backend's real URL. This makes Vercel transparently proxy API
   calls to the backend server-side — the browser only ever talks to your
   Vercel domain, so the `lb_session` cookie (`SameSite=Lax`, no `Secure`
   flag in dev) keeps working exactly like the single-process Express setup
   does. Pointing the frontend at the backend via `fetch` directly instead
   (cross-origin) would silently break login: `SameSite=Lax` cookies aren't
   sent on cross-site `fetch`/XHR, only top-level navigations.
3. **Set the `SITE_ORIGIN` environment variable** in the Vercel project
   (Project Settings → Environment Variables) to your final Vercel domain,
   e.g. `https://loadbyton.ae` — used to build absolute URLs in
   `sitemap.xml`. If unset, the build script falls back to Vercel's own
   `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL` (usually correct without
   any manual config), then a placeholder.
4. **Also set `FRONTEND_URL`** on the *backend* host to your Vercel domain —
   `server/index.js` uses it for CORS (`FRONTEND_URL` env var, see
   `docs/DEVELOPER_GUIDE.md`). With the rewrite proxy above the browser
   never makes a cross-origin request, but the backend should still know
   its canonical frontend origin.

## Connecting the project

This session has no Vercel account/token, so the actual deploy trigger is a
step for you to run, either:

- **Dashboard**: vercel.com → New Project → import `shamhar07-max/loadbyton`
  from GitHub. Vercel auto-detects `vercel.json` at the repo root — no
  manual build/output-directory config needed. Push to the branch Vercel is
  watching and it redeploys automatically.
- **CLI**: `npx vercel login`, then `npx vercel --prod` from the repo root.

Either way, do steps 1–4 above (backend URL, `SITE_ORIGIN`, `FRONTEND_URL`)
before or right after the first deploy — until the `/api/:path*` rewrite
points at a real backend, every API call 404s and the app has nothing to
log into.
