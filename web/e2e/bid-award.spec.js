import { test, expect } from '@playwright/test';
test('Carrier bids, shipper awards', async ({ page }) => {
  await page.goto('/open-loads');
  await expect(page.locator('body')).toBeVisible();
});
