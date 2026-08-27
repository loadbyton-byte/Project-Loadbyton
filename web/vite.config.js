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
    process.env.SENTRY_AUTH_TOKEN && sentry({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      include: './dist',
      release: process.env.SENTRY_RELEASE,
    }),
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
  build: {
    outDir: 'dist',
    sourcemap: true,
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
