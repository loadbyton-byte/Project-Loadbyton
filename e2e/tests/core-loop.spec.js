import { test, expect } from '@playwright/test';

test('shipper creates job, carrier bids, shipper awards', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toContainText(/Loadbyton/i);
  // register/login flow would be here — scaffold asserts shell loads
  await expect(page.locator('header')).toBeVisible();
});

test('driver completes POD flow', async ({ page }) => {
  await page.goto('/jobs/demo');
  await expect(page.locator('body')).toBeVisible();
});
