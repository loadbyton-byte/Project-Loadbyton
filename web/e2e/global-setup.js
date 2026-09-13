// Pre-authenticates the 3 demo accounts most e2e specs need (shipper,
// carrier, admin) ONCE per test run, saving each session's cookies to a
// storageState file specs load directly instead of performing their own
// fresh login.
//
// Why this exists: every fresh Playwright browser context triggers one
// GET /api/auth/me on mount (web/src/lib/auth.jsx's AuthProvider calls it
// unconditionally), regardless of whether that test ever logs in. With
// ~17 specs each paying that unavoidable tax, plus each spec that DID need
// to be authenticated performing its own real POST /api/auth/login, total
// requests to authIpLimiter's shared 20-req/min-per-IP budget
// (server/routes/auth.routes.js — login/register/me all share it) reliably
// exceeded 20 within a single CI run, producing spurious 429s that looked
// like real login failures (see PR #88/#89's CI history). Logging in once
// here instead of once per spec is the actual fix — not a raised limit,
// which would be a real security-relevant change made purely to
// accommodate a testing artifact.
//
// login-post.spec.js is the deliberate exception: it exists specifically
// to test the real login UI flow, so it keeps its own fresh UI login
// rather than loading a pre-baked session.
const { request } = require('@playwright/test');
const path = require('node:path');

const BASE_URL = 'http://127.0.0.1:5173';
const AUTH_DIR = path.join(__dirname, '.auth');

const ACCOUNTS = {
  shipper: { email: 'shipper@jebelalilogistics.ae', password: 'demo1234' },
  carrier: { email: 'carrier@dubaidrayage.com', password: 'demo1234' },
  admin: { email: 'admin@loadbyton.ae', password: 'demo1234' },
};

module.exports = async function globalSetup() {
  for (const [role, { email, password }] of Object.entries(ACCOUNTS)) {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const res = await ctx.post('/api/auth/login', {
      headers: { 'x-loadbyton-client': '1' },
      data: { email, password },
    });
    if (!res.ok()) {
      const body = await res.text().catch(() => '');
      await ctx.dispose();
      throw new Error(`global-setup: ${role} login failed (${res.status()}): ${body}`);
    }
    await ctx.storageState({ path: path.join(AUTH_DIR, `${role}.json`) });
    await ctx.dispose();
  }
};
