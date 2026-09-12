import { test, expect } from '@playwright/test';
import path from 'node:path';

// Relative to process.cwd(), not import.meta.url — Playwright's test
// transform doesn't carry import.meta through cleanly, and every
// Playwright run here always has cwd = web/ (where playwright.config.js
// lives), so this is simpler and just as reliable.
const AXE_SCRIPT = path.join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');

// axe-core (web/src/lib/a11y.js) was already a devDependency with a
// dev-console-only runner — never wired into any automated check. This
// injects the same library directly into the page (not the app-bundled
// helper, which only logs) and asserts on real violations for a handful
// of key pages: the public homepage, one marketing page, and one
// authenticated app page (representative of the two different "modes"
// brief §86 describes).
//
// Scoped to 'critical'/'serious' impact only — WCAG 2.2 AA is the brief's
// stated target, and axe's 'minor'/'moderate' findings include some
// genuinely subjective/borderline rules not worth gating a merge on yet.
//
// One specific, narrow exception: white text on --brand-accent
// (#E53935 light / #FF5449 dark) measures ~4.2:1, just under the 4.5:1
// normal-text minimum — already identified and deliberately accepted in
// index.css's own comment on --text-on-accent ("White is the better of
// the two real options here") before this spec existed. Changing the
// brand's one signature accent color to close a ~0.3 gap is a brand-
// identity call, not an engineering one — flagged for a real decision
// (server/lib doesn't own this, a designer/PM does), not made
// unilaterally here. Every OTHER color-contrast violation this test
// finds still fails it.
// Anti-aliased rendering measures a few units off the nominal hex (e.g.
// #e53a36 instead of #e53935 depending on what's layered underneath) —
// exact string matching missed real instances of this exact case, so
// this checks channel distance instead.
function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function closeTo(hexA, hexB, tolerance = 12) {
  const [ra, ga, ba] = hexToRgb(hexA);
  const [rb, gb, bb] = hexToRgb(hexB);
  return Math.abs(ra - rb) <= tolerance && Math.abs(ga - gb) <= tolerance && Math.abs(ba - bb) <= tolerance;
}
const KNOWN_ACCEPTED_ACCENT_HEX = ['#e53935', '#ff5449'];
function isKnownAcceptedAccentContrast(node) {
  const data = node.any?.[0]?.data;
  if (!data?.fgColor || !closeTo(data.fgColor, '#ffffff')) return false;
  return KNOWN_ACCEPTED_ACCENT_HEX.some((accent) => closeTo(data.bgColor || '', accent));
}

async function auditPage(page) {
  await page.addScriptTag({ path: AXE_SCRIPT });
  const results = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    return await axe.run(document, { resultTypes: ['violations'] });
  });
  const filtered = results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => (v.id !== 'color-contrast' ? v : { ...v, nodes: v.nodes.filter((n) => !isKnownAcceptedAccentContrast(n)) }))
    .filter((v) => v.nodes.length > 0);
  if (filtered.length && process.env.A11Y_DEBUG) {
    for (const v of filtered) {
      for (const n of v.nodes) {
        console.log('[a11y-debug]', v.id, '|', n.failureSummary?.split('\n')[1]?.trim(), '|', n.html);
      }
    }
  }
  return filtered;
}

function describeViolations(violations) {
  return violations.map((v) => `${v.id} (${v.impact}): ${v.description} — ${v.nodes.length} node(s)`).join('\n');
}

test('homepage has no critical/serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  const violations = await auditPage(page);
  expect(violations, describeViolations(violations)).toEqual([]);
});

test('pricing page has no critical/serious accessibility violations', async ({ page }) => {
  await page.goto('/pricing');
  const violations = await auditPage(page);
  expect(violations, describeViolations(violations)).toEqual([]);
});

// Spot-check for the --brand-accent-on-tint fix, which the same "eyebrow"
// badge pattern repeats verbatim across About/Compliance/Blog/Features/
// Pricing/Security/Terms/Privacy — one more page than Pricing (already
// covered above) is enough to confirm the shared token fix actually
// applies everywhere that pattern is used, without a dedicated test per
// page for what's the same CSS rule every time.
test('security page has no critical/serious accessibility violations', async ({ page }) => {
  await page.goto('/security');
  const violations = await auditPage(page);
  expect(violations, describeViolations(violations)).toEqual([]);
});

test('dashboard (authenticated) has no critical/serious accessibility violations', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'shipper@jebelalilogistics.ae');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/dashboard/);
  const skip = page.getByRole('button', { name: /Skip.*don.t show this again/i });
  if (await skip.isVisible({ timeout: 2000 }).catch(() => false)) await skip.click();

  const violations = await auditPage(page);
  expect(violations, describeViolations(violations)).toEqual([]);
});
