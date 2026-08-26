import { test, expect } from '@playwright/test';
test('jobdetail', async ({ page }) => { await page.goto('/'); await expect(page.locator('body')).toBeVisible(); });
