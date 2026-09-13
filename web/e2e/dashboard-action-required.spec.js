import { test, expect, request } from '@playwright/test';
import path from 'node:path';

// components/ActionRequired.jsx on Dashboard.jsx (brief §15/§16) — must
// surface an unread high/critical-priority notification (a dispute, in
// this case — notifications.priority='high' per
// NOTIFICATION_PRIORITY_BY_TYPE) with a direct link to the job, and must
// render nothing at all once there's nothing to act on (no empty-section
// clutter).

// Pre-baked shipper session (e2e/global-setup.js) — see its comment for
// why: avoids this spec's own login call adding to the shared
// authIpLimiter budget every other spec in the run also draws from.
test.use({ storageState: path.join(process.cwd(), 'e2e', '.auth', 'shipper.json') });

test('a dispute appears in Dashboard\'s Action Required section and links to the job', async ({ page, baseURL }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/dashboard/);
  const skipWalkthrough = page.getByRole('button', { name: /Skip.*don.t show this again/i });
  if (await skipWalkthrough.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipWalkthrough.click();
  }

  // Clean baseline — this account accumulates notifications across the
  // whole suite/seed data.
  await page.request.post('/api/notifications/read', { headers: { 'x-loadbyton-client': '1' } });
  await page.reload();
  await expect(page.getByText('Action required')).toHaveCount(0);

  const createRes = await page.request.post('/api/jobs', {
    headers: { 'x-loadbyton-client': '1' },
    data: {
      containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
      deliveryAddress: 'Action required e2e test',
      readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    },
  });
  expect(createRes.status()).toBe(201);
  const job = (await createRes.json()).job;

  // Pre-baked admin session (e2e/global-setup.js) instead of a fresh
  // login — same authIpLimiter-budget reasoning as the shipper session above.
  const adminContext = await request.newContext({ baseURL, storageState: path.join(process.cwd(), 'e2e', '.auth', 'admin.json') });
  const disputeRes = await adminContext.post('/api/admin/disputes', {
    headers: { 'x-loadbyton-client': '1' },
    data: { jobId: job.id, reason: 'Action required e2e test dispute' },
  });
  expect(disputeRes.status()).toBe(201);
  await adminContext.dispose();

  // No reload — proves the live push (Phase 1) feeds this section too,
  // not just the bell/toast.
  const actionCard = page.getByRole('link', { name: /Dispute opened/i });
  await expect(actionCard).toBeVisible({ timeout: 5000 });
  await actionCard.click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}`));
});
