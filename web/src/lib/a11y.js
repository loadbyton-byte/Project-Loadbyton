/**
 * Baseline axe accessibility helper.
 * Tries to dynamically import `axe-core` (installed via `npm install axe-core`
 * — succeeds as devDependency `axe-core@^4.13.0` in web/package.json); if the
 * package is not installed or fails to load, this remains a safe no-op so
 * production and SSR builds never break. Installed successfully 2026-08-28;
 * fallback no-op path is retained for environments where axe-core is absent.
 *
 * Safe to call in any environment (SSR, tests, or when axe-core not installed).
 *
 * Usage:
 *   import { runAxe } from '../lib/a11y.js';
 *   if (import.meta.env.DEV) runAxe();
 *
 * Implementation: calls `axe.run(document)` and logs violations.
 */
export async function runAxe(context, options) {
  if (typeof document === 'undefined') return;
  const target = context || document;
  try {
    const mod = await import('axe-core');
    // axe-core may expose as default or namespace (ESM vs CJS interop)
    const axe = mod.default || mod;
    if (!axe || typeof axe.run !== 'function') return;
    const results = await axe.run(target, options || {});
    if (results?.violations?.length) {
      // eslint-disable-next-line no-console
      console.warn('[a11y] axe violations:', results.violations);
      // Detailed per-violation logging for easier triage in dev
      // eslint-disable-next-line no-console
      results.violations.forEach((v) => {
        console.warn(`[a11y] ${v.id} (${v.impact}): ${v.description}`, {
          helpUrl: v.helpUrl,
          nodes: v.nodes,
        });
      });
    } else {
      // eslint-disable-next-line no-console
      console.log('[a11y] axe: no violations found');
    }
    return results;
  } catch {
    // axe-core not installed or failed to load — intentionally no-op.
    // This path keeps builds working when `npm install axe-core` fails or the
    // package is deliberately omitted in a minimal install. No throw, no log.
    return;
  }
}

export default runAxe;
