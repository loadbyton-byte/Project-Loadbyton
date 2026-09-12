import { test, expect } from '@playwright/test';

// components/CinematicIntro.jsx — first-visit-only homepage brand moment.
// Covers the three behavioral guarantees the brief requires: shows once
// per session, is always skippable, and never shows at all under
// prefers-reduced-motion (brief §12/§49).

test('shows on first visit, is skippable, and does not reappear within the same session', async ({ page }) => {
  await page.goto('/');
  const overlay = page.locator('.intro-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.locator('.intro-logo')).toBeVisible();

  const skip = page.getByRole('button', { name: 'Skip' });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(overlay).toBeHidden({ timeout: 2000 });

  // Same session (sessionStorage persists across a client-side or full
  // reload in the same tab) — a second visit must not show it again.
  await page.reload();
  await expect(page.locator('.intro-overlay')).toHaveCount(0);
});

test('auto-dismisses on its own well under the 5s hard cap', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.intro-overlay')).toBeVisible();
  // No click — must disappear by itself within the brief's stated bound.
  await expect(page.locator('.intro-overlay')).toBeHidden({ timeout: 5000 });
});

test.describe('prefers-reduced-motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('never shows the intro at all', async ({ page }) => {
    await page.goto('/');
    // Give it a beat to prove absence, not just "not yet rendered".
    await page.waitForTimeout(300);
    await expect(page.locator('.intro-overlay')).toHaveCount(0);
  });
});
