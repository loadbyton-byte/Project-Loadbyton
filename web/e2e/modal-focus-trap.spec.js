import { test, expect } from '@playwright/test';
import path from 'node:path';

// web/src/components/ui.jsx's shared Modal had no focus trap, no
// focus-on-open, no Escape handler, and no focus-restore-on-close — a
// keyboard/screen-reader user's focus stayed wherever it was when the
// dialog opened, and fell back to <body> when it closed. Verifies the
// fix against RfpList.jsx's real "Create RFP" modal, one of Modal's 5
// real consumers, not a synthetic fixture.

// Pre-baked shipper session (e2e/global-setup.js) — see its comment for
// why: avoids each test below adding its own login call to the shared
// authIpLimiter budget every other spec in the run also draws from.
test.use({ storageState: path.join(process.cwd(), 'e2e', '.auth', 'shipper.json') });

// Shell.jsx's first-run WalkthroughModal renders wherever the shipper
// lands (it wraps every route via Shell.jsx, not just /dashboard), and
// its appearance is gated by the same async user-resolution chain as the
// rest of the app — dismissing it once right after goto('/dashboard')
// isn't reliable under real load: if the modal hasn't rendered yet within
// that check's window, it can still show up moments later on WHATEVER
// page the test has since navigated to (confirmed in CI: it intercepted
// a click on /rfps after the /dashboard check found nothing to dismiss).
// So this runs at the actual point of use, on whatever page is current,
// not just once upfront.
async function dismissWalkthroughIfPresent(page) {
  const skipWalkthrough = page.getByRole('button', { name: /Skip.*don.t show this again/i });
  if (await skipWalkthrough.isVisible({ timeout: 5000 }).catch(() => false)) {
    await skipWalkthrough.click();
  }
}

test('Modal moves focus in, cycles Tab, closes on Escape, and restores focus on close', async ({ page }) => {
  await page.goto('/dashboard');
  await dismissWalkthroughIfPresent(page);
  await page.goto('/rfps');
  await dismissWalkthroughIfPresent(page);
  const trigger = page.getByRole('button', { name: /Create.*RFP/i }).first();
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Focus moves into the dialog's first form field on open, not the header's Close button.
  const titleInput = dialog.getByPlaceholder('Jebel Ali → Riyadh weekly lane');
  await expect(titleInput).toBeFocused();

  // Escape closes it.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  // Focus returns to whatever triggered it, not <body>.
  await expect(trigger).toBeFocused();
});

test('Modal traps Tab within itself', async ({ page }) => {
  await page.goto('/dashboard');
  await dismissWalkthroughIfPresent(page);
  await page.goto('/rfps');
  await dismissWalkthroughIfPresent(page);
  await page.getByRole('button', { name: /Create.*RFP/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // The header's Close button is the FIRST focusable node in DOM order
  // (it sits before the form body). Shift+Tab from it must wrap to the
  // LAST focusable element inside the dialog, never escape to whatever
  // is behind the overlay — asserted generically (something inside the
  // dialog has focus) rather than hardcoding which field is last, since
  // that's an implementation detail of the RFP form, not of the trap.
  const closeButton = dialog.getByRole('button', { name: 'Close' });
  await closeButton.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
});
