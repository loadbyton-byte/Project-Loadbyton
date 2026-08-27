/**
 * Baseline axe accessibility helper.
 * Dynamically imports `axe-core` if available; otherwise no-ops.
 * Safe to call in any environment (SSR, tests, or when axe-core not installed).
 *
 * Usage:
 *   import { runAxe } from '../lib/a11y.js';
 *   if (import.meta.env.DEV) runAxe();
 */
export async function runAxe(context, options) {
  if (typeof document === 'undefined') return;
  const target = context || document;
  try {
    const mod = await import('axe-core');
    // axe-core may expose as default or namespace
    const axe = mod.default || mod;
    if (!axe || typeof axe.run !== 'function') return;
    const results = await axe.run(target, options || {});
    if (results?.violations?.length) {
      // eslint-disable-next-line no-console
      console.warn('[a11y] axe violations:', results.violations);
    }
    return results;
  } catch {
    // axe-core not installed or failed to load — intentionally no-op
    return;
  }
}

export default runAxe;
