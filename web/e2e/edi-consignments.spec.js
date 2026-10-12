import { test, expect } from '@playwright/test';
import path from 'node:path';

// Regression: this page threw "Cannot read properties of undefined (reading
// 'toLowerCase')" as soon as the shipper had a consignment, blanking the screen.
test.use({ storageState: path.join(process.cwd(), 'e2e', '.auth', 'shipper.json') });

test('EDI consignments list renders the seeded consignment without crashing', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/edi/consignments');
  await expect(page.getByRole('heading', { name: /EDI Consignments/i })).toBeVisible();
  await expect(page.getByText('EDI304-DEMO-001')).toBeVisible();
  // search filters without throwing
  await page.getByPlaceholder(/search consignments/i).fill('musaffah');
  await expect(page.getByText('EDI304-DEMO-001')).toBeVisible();
  await page.getByPlaceholder(/search consignments/i).fill('zzz-no-match');
  await expect(page.getByText(/no consignments/i)).toBeVisible();
  expect(pageErrors).toEqual([]);
});
