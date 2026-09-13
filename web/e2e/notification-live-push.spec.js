import { test, expect, request } from '@playwright/test';
import path from 'node:path';

// Full-stack proof that the notification live-push wiring actually
// renders, not just that the backend emits the right socket event
// (server/test/notification-priority-socket.test.js already covers that
// in isolation). A second, independent "session" (carrier, via a plain
// API request context — no browser) triggers a notification for the
// shipper while the shipper's own page stays open in the browser — the
// shipper's NotificationBell unread dot (Shell.jsx, data-testid
// "notification-unread-dot") must appear live, with no reload and no
// click on the bell.

// Pre-baked shipper session (e2e/global-setup.js) — see its comment for
// why: avoids this spec's own login call adding to the shared
// authIpLimiter budget every other spec in the run also draws from.
test.use({ storageState: path.join(process.cwd(), 'e2e', '.auth', 'shipper.json') });

test('a new bid makes the shipper\'s unread bell dot appear live, without a click or reload', async ({ page, baseURL }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/dashboard/);
  const skipWalkthrough = page.getByRole('button', { name: /Skip.*don.t show this again/i });
  if (await skipWalkthrough.isVisible({ timeout: 5000 }).catch(() => false)) {
    await skipWalkthrough.click();
  }

  // Known baseline: this demo account accumulates unread notifications
  // across the whole suite/seed data — clear them first so "the dot
  // appears" below is caused by THIS test's bid, not leftover state.
  await page.request.post('/api/notifications/read', { headers: { 'x-loadbyton-client': '1' } });
  await page.reload();
  // Shell.jsx renders NotificationBell twice — once in the mobile
  // TopAppBar, once in the desktop slim header — only one is actually
  // visible at the current viewport, but both exist in the DOM.
  await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible();
  await expect(page.locator('[data-testid="notification-unread-dot"]')).toHaveCount(0);

  const createRes = await page.request.post('/api/jobs', {
    headers: { 'x-loadbyton-client': '1' },
    data: {
      containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
      deliveryAddress: 'Live push e2e test',
      readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    },
  });
  expect(createRes.status()).toBe(201);
  const job = (await createRes.json()).job;

  // Independent session — a different real user, not the shipper's own
  // cookies — matches how two real people would interact. Pre-baked
  // carrier session (e2e/global-setup.js) instead of a fresh login, same
  // authIpLimiter-budget reasoning as the shipper session above.
  const carrierContext = await request.newContext({ baseURL, storageState: path.join(process.cwd(), 'e2e', '.auth', 'carrier.json') });
  const bidRes = await carrierContext.post(`/api/jobs/${job.id}/bids`, {
    headers: { 'x-loadbyton-client': '1' },
    data: { amountAed: 1500, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' },
  });
  expect(bidRes.status()).toBe(201);
  await carrierContext.dispose();

  // No reload, no click — Playwright's expect auto-retries until this
  // becomes true or the timeout elapses, which is exactly what a live
  // push (rather than a poll-on-click) needs to prove. Both the mobile
  // and desktop bell re-render from the same `user.unreadNotifications`,
  // so both dots appear together.
  await expect(page.locator('[data-testid="notification-unread-dot"]')).toHaveCount(2, { timeout: 5000 });
});
