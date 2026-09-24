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
  //
  // isVisible() checks the CURRENT state once, with no polling — a real
  // race, since the modal only mounts once the dashboard's user/
  // walkthrough state finishes loading after the redirect. Caught this as
  // a real (not flaky) CI failure: the check ran before the modal had
  // appeared, returned false, skipped the dismiss click, and the modal
  // then opened moments later and sat there intercepting the "Post a job"
  // click for the rest of the test. waitFor() polls up to its timeout
  // instead of sampling once — same fix applied to every other spec with
  // this exact copy-pasted dismiss pattern (accessibility, command-palette,
  // dashboard-action-required, modal-focus-trap, notification-live-push).
  const skipWalkthrough = page.getByRole('button', { name: /Skip.*don.t show this again/i });
  if (await skipWalkthrough.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await skipWalkthrough.click();
  }
  await page.click('text=Post a job');
  await expect(page.getByRole('dialog')).toBeVisible();
});
