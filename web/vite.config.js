import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
