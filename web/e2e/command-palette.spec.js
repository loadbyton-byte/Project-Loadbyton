import { test, expect } from '@playwright/test';
import path from 'node:path';

// components/CommandPalette.jsx (brief §44) — Ctrl/Cmd+K quick nav + job
// search. Authorization is NOT re-tested here — it's a UI layer over the
// same GET /api/jobs?q= endpoint OpenLoads.jsx's own search box already
// calls, which is already role-scoped server-side. This only proves the
// palette itself opens, searches, and navigates correctly.

// Pre-baked shipper session (e2e/global-setup.js) — see its comment for
// why: avoids each test below adding its own login call to the shared
// authIpLimiter budget every other spec in the run also draws from.
test.use({ storageState: path.join(process.cwd(), 'e2e', '.auth', 'shipper.json') });

async function dismissWalkthrough(page) {
  await page.goto('/dashboard');
  const skip = page.getByRole('button', { name: /Skip.*don.t show this again/i });
  if (await skip.isVisible({ timeout: 5000 }).catch(() => false)) await skip.click();
}

test('opens with Ctrl/Cmd+K, filters nav items while typing, and navigates on Enter', async ({ page }) => {
  await dismissWalkthrough(page);

  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Jump to' });
  await expect(dialog).toBeVisible();

  const input = dialog.getByPlaceholder('Search pages, or a job code…');
  await expect(input).toBeFocused();

  // "Messages" is in the SHIPPER nav (navByRole, Shell.jsx) — the demo
  // account this suite logs in as.
  await input.fill('messages');
  await expect(dialog.getByText('Messages', { exact: true })).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/messages/);
});

test('the visible search button opens the same palette (discoverability for non-keyboard users)', async ({ page }) => {
  await dismissWalkthrough(page);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('dialog', { name: 'Jump to' })).toBeVisible();
});

test('finds a real job by code and navigates to it', async ({ page }) => {
  await dismissWalkthrough(page);

  const createRes = await page.request.post('/api/jobs', {
    headers: { 'x-loadbyton-client': '1' },
    data: {
      containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
      deliveryAddress: 'Command palette e2e test',
      readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    },
  });
  expect(createRes.status()).toBe(201);
  const job = (await createRes.json()).job;

  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Jump to' });
  await dialog.getByPlaceholder('Search pages, or a job code…').fill(job.job_code);

  const resultButton = dialog.getByRole('button', { name: new RegExp(job.job_code) });
  await expect(resultButton).toBeVisible({ timeout: 3000 });
  await resultButton.click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}`));
});
