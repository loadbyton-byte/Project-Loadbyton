import { test, expect } from '@playwright/test';
test('Login → Post → OpenLoads → JobDetail', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'shipper@jebelalilogistics.ae');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/dashboard/);
  // Shell.jsx's first-run WalkthroughModal covers the page independently
  // of this flow — dismiss it if present, same as modal-focus-trap.spec.js,
  // so it doesn't intercept the "Post a job" click underneath it. This test
  // could never actually run before @playwright/test was a declared
  // dependency, so this gap was never caught.
  const skipWalkthrough = page.getByRole('button', { name: /Skip.*don.t show this again/i });
  if (await skipWalkthrough.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipWalkthrough.click();
  }
  await page.click('text=Post a job');
  await expect(page.getByRole('dialog')).toBeVisible();
});
