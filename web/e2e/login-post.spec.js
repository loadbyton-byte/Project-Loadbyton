import { test, expect } from '@playwright/test';
test('Login → Post → OpenLoads → JobDetail', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'shipper@jebelalilogistics.ae');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/dashboard/);
  await page.click('text=Post a job');
  await expect(page.getByRole('dialog')).toBeVisible();
});
