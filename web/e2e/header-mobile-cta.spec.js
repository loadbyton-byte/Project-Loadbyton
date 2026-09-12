import { test, expect } from '@playwright/test';

// Shell.jsx's mobile TopAppBar had "Log in" only, no primary conversion
// CTA at all, unlike the desktop header which already had both. Verifies
// the fix at the narrowest viewport the brief's mobile QA list requires
// (320px) — both actions present, reachable, and no horizontal overflow.
test.use({ viewport: { width: 320, height: 640 } });

test('mobile header shows both Log in and Get started with no horizontal overflow', async ({ page }) => {
  await page.goto('/');

  // Dismiss the cinematic intro (CinematicIntro.jsx) if it's up — unrelated
  // to what this test checks.
  const skip = page.getByRole('button', { name: 'Skip' });
  if (await skip.isVisible({ timeout: 1000 }).catch(() => false)) await skip.click();

  await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get started', exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1); // sub-pixel rounding only
});
