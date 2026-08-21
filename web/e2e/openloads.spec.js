import { test, expect } from '@playwright/test';
test('openloads', async ({ page }) => { await page.goto('/'); await expect(page.locator('body')).toBeVisible(); });
