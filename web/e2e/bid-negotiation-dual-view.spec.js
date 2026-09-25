import { test, expect, request } from '@playwright/test';
import path from 'node:path';

// Item #4's gap: bid_negotiations (the pre-award chat on a specific bid) was
// always readable/writable by either the job's shipper or the bid's own
// carrier server-side (bids.routes.js's loadBidWithJobForNegotiation), but
// the frontend only ever gave the SHIPPER an entry point to it (JobDetail.jsx's
// "Discuss & award" button/modal) — a carrier who placed a bid had no way at
// all to see or send anything in this thread, even though the backend fully
// supported it. This proves the fix end-to-end from both sides of the same
// conversation, including the sender-attribution fix needed once it became a
// real two-way UI (previously every message rendered identically regardless
// of who sent it, since only one side ever saw the thread) and the
// agree/awaiting-charge logic fix needed once the modal could be opened by
// either role (that logic was hardcoded to "my side = shipper", which never
// mattered while only the shipper ever opened it).

test.use({ storageState: path.join(process.cwd(), 'e2e', '.auth', 'carrier.json') });

async function skipWalkthroughIfShown(page) {
  const skip = page.getByRole('button', { name: /Skip.*don.t show this again/i });
  if (await skip.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)) {
    await skip.click();
  }
}

test('a carrier can discuss their own bid with the shipper, and the shipper sees the same conversation with correct attribution', async ({ page, baseURL }) => {
  const shipperApi = await request.newContext({ baseURL, storageState: path.join(process.cwd(), 'e2e', '.auth', 'shipper.json') });
  const createRes = await shipperApi.post('/api/jobs', {
    headers: { 'x-loadbyton-client': '1' },
    data: {
      containerSize: '20FT', containerType: 'DRY', pickupTerminal: 'JEBEL_ALI_T1', deliveryArea: 'AL_QUOZ',
      deliveryAddress: 'Dual-view negotiation e2e test',
      readyAt: new Date(Date.now() + 86400000).toISOString(), deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
    },
  });
  expect(createRes.status()).toBe(201);
  const jobId = (await createRes.json()).job.id;

  // Carrier places the bid via its own already-authenticated page context.
  const bidRes = await page.request.post(`/api/jobs/${jobId}/bids`, {
    headers: { 'x-loadbyton-client': '1' },
    data: { acknowledgePaymentTerms: true, amountAed: 950, etaAt: new Date(Date.now() + 24 * 3600000).toISOString(), truckType: 'flatbed' },
  });
  expect(bidRes.status()).toBe(201);

  // --- Carrier side ---
  await page.goto(`/jobs/${jobId}`);
  await skipWalkthroughIfShown(page);

  const discussWithShipper = page.getByRole('button', { name: 'Discuss with shipper' });
  await expect(discussWithShipper).toBeVisible();
  await discussWithShipper.click();

  await expect(page.getByText('Discuss your bid with the shipper')).toBeVisible();
  // Award-only content must not leak into the carrier's view of this modal.
  await expect(page.getByText('Every other bid on this job will be rejected')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm terms & assign' })).toHaveCount(0);

  const messageInput = page.getByPlaceholder('e.g. Any Salik charges expected?');
  await messageInput.fill('Can we add a Salik charge for this route?');
  await page.getByRole('button', { name: 'Send' }).click();

  const carrierOwnMessage = page.locator('p', { hasText: 'Can we add a Salik charge for this route?' });
  await expect(carrierOwnMessage).toBeVisible();
  // Sent-by-me attribution, not a flat unattributed list.
  await expect(page.getByText('You', { exact: true })).toBeVisible();

  await shipperApi.dispose();

  // --- Shipper side: same conversation, opposite attribution ---
  const shipperCtx = await page.context().browser().newContext({ storageState: path.join(process.cwd(), 'e2e', '.auth', 'shipper.json') });
  const shipperPage = await shipperCtx.newPage();
  await shipperPage.goto(`/jobs/${jobId}`);
  await skipWalkthroughIfShown(shipperPage);

  const discussAward = shipperPage.getByRole('button', { name: 'Discuss & award' });
  await expect(discussAward).toBeVisible();
  await discussAward.click();

  await expect(shipperPage.getByText('Discuss & award this bid')).toBeVisible();
  await expect(shipperPage.getByText('Every other bid on this job will be rejected')).toBeVisible();
  await expect(shipperPage.getByRole('button', { name: 'Confirm terms & assign' })).toBeVisible();

  await expect(shipperPage.locator('p', { hasText: 'Can we add a Salik charge for this route?' })).toBeVisible();
  await expect(shipperPage.getByText('Transporter', { exact: true })).toBeVisible();

  await shipperCtx.close();
});
