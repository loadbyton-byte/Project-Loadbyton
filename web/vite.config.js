// PWA scaffold: web/public/manifest.json + web/public/site.webmanifest provide
// installability without any build plugin. vite-plugin-pwa is intentionally
// NOT required — the static manifests are copied verbatim to dist/ by Vite
// (publicDir) and linked via <link rel="manifest"> in index.html. If a
// service worker is ever needed, add it manually; do not add vite-plugin-pwa
// unless offline caching is actually specified.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import sentry from '@sentry/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.SENTRY_AUTH_TOKEN ? [sentry({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: { assets: './dist/**' },
      release: { name: process.env.SENTRY_RELEASE },
    })] : []),
  ].filter(Boolean),
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  // e2e (web/e2e/*.spec.js via playwright.config.js) runs against this,
  // not `server` above — a production build, not the dev server. Needed
  // because `server`'s dev mode (React.StrictMode's intentional
  // double-invoke of effects) doubles every AuthProvider /api/auth/me
  // call, which — combined with real logins across ~17 e2e specs — blew
  // well past authIpLimiter's 20-req/min-per-IP budget regardless of how
  // few logins any single spec performed. A production build doesn't
  // double-invoke effects, so this proxy exists to keep /api reachable
  // under `vite preview` the same way it already is under `vite dev`.
  preview: {
    port: 5173,
    // Explicit IPv4 bind — CI (github actions) resolved a bare loopback
    // bind to ::1 (IPv6) rather than 127.0.0.1, invisible to both
    // curl-based health checks and playwright.config.js's IPv4 baseURL
    // (see .github/workflows/ci.yml's own comment on the same issue for
    // `vite dev`'s boot step — applies equally here).
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          // Own chunk rather than bundled into JobDetail (the only importer
          // today) — it's sizable, rarely changes, and this way it's
          // cached independently of app-code deploys instead of inflating
          // JobDetail's chunk every time either changes.
          socket: ['socket.io-client'],
        },
      },
    },
  },
  // React Router v7's package exports resolve to a CJS-flavored entry under
  // Vite's Node SSR condition (used by scripts/prerender.mjs's
  // ssrLoadModule), which breaks named-export interop for its ESM source.
  // noExternal forces Vite to run these through its own transform pipeline
  // instead of Node's native require resolution — the standard fix for this
  // class of dual-package-hazard issue, and irrelevant to the real browser
  // build (which never goes through this SSR path).
  ssr: {
    noExternal: ['react-router', 'react-router-dom'],
    // Vite's SSR resolver always adds the "node" condition unless
    // ssr.target is 'webworker' — and react-router(-dom)'s package.json
    // resolves "node" to a CJS build that breaks once noExternal above
    // pulls it into Vite's ESM transform pipeline. 'webworker' makes
    // resolution browser-like (import/module conditions) instead, which is
    // what scripts/prerender.mjs's ssrLoadModule actually needs here — it's
    // rendering React components to a string, not touching real Node APIs.
    target: 'webworker',
  },
});
