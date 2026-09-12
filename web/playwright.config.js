import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  // A production build, not the dev server — see vite.config.js's
  // `preview` block comment for why (React.StrictMode's dev-only
  // double-invoke of effects was doubling every auth/me call against a
  // shared per-IP rate limit). `timeout` here is generous for the build
  // step this now includes; reuseExistingServer still lets a local dev
  // loop skip rebuilding if something's already up on the port.
  webServer: { command: 'npx vite build && npx vite preview --port 5173', port: 5173, reuseExistingServer: true, timeout: 120000 },
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'on-first-retry' },
  // Pre-authenticates shipper/carrier/admin once for the whole run — see
  // e2e/global-setup.js's own comment for why (authIpLimiter rate-limit
  // collisions from every spec performing its own fresh login).
  globalSetup: './e2e/global-setup.js',
});
