import { test, expect } from '@playwright/test';
import path from 'node:path';
import crypto from 'node:crypto';

// The ecosystem surfaces exist in every build except one made with
// VITE_ECOSYSTEM_UI=false (web/src/lib/features.js), and the OIDC checks need the API started with
// OIDC_CLIENTS registering the callback below (see docs/ECOSYSTEM.md for the
// exact commands). Without both, this file is skipped rather than failing.
test.skip(process.env.VITE_ECOSYSTEM_UI === 'false', 'the ecosystem specs need a build with the ecosystem UI on (the default)');

test.use({ reducedMotion: 'reduce' });
const auth = (role) => path.join(process.cwd(), 'e2e', '.auth', `${role}.json`);
const CALLBACK = 'http://127.0.0.1:5173/oidc-callback';

test.describe('public ecosystem surfaces', () => {
  test('Business OS page, network menu and footer directory', async ({ page }) => {
    await page.goto('/business-os');
    await expect(page.getByRole('heading', { level: 1, name: /Run the company behind the load/i })).toBeVisible();
    await expect(page.getByText('Starter Included').first()).toBeVisible();
    await expect(page.getByText('Enterprise Included').first()).toBeVisible();
    // Sector list has all eighteen
    await expect(page.locator('.eco-sector-list li')).toHaveCount(18);

    // Footer directory names all six; planned ones are text, not links
    const footer = page.locator('footer');
    for (const d of ['loadbyton.com', 'loadbyton.store', 'loadbyton.shop', 'loadbyton.net', 'loadbyton.me', 'loadbyton.xyz']) {
      await expect(footer.getByText(d, { exact: false }).first()).toBeVisible();
    }
    await expect(footer.getByRole('link', { name: /loadbyton\.shop/ })).toHaveCount(0);
    await expect(footer.getByRole('link', { name: /loadbyton\.store/ })).toHaveAttribute('href', '/go/store');

    // Menu: opens, shows status, closes on Escape, keyboard reachable
    const menuBtn = page.getByRole('button', { name: /Loadbyton network/ });
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
    await menuBtn.focus();
    await page.keyboard.press('Enter');
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.eco-menu-panel').getByText('Coming soon')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('cross-domain interstitial names the destination; planned domains cannot be opened; paths cannot escape', async ({ page }) => {
    await page.goto('/go/store');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('You are going to loadbyton.store');
    await expect(page.getByRole('link', { name: /Continue to loadbyton\.store/ })).toHaveAttribute('href', 'https://loadbyton.store');

    await page.goto('/go/store?to=' + encodeURIComponent('//evil.example/x'));
    await expect(page.getByRole('link', { name: /Continue to loadbyton\.store/ })).toHaveAttribute('href', 'https://loadbyton.store');

    await page.goto('/go/shop');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('not open yet');
    await expect(page.getByRole('link', { name: /Continue to/ })).toHaveCount(0);

    await page.goto('/go/nonsense');
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('company benefits', () => {
  test.use({ storageState: auth('carrier') });

  test('verified company activates Business OS and sees its plan ceilings', async ({ page }) => {
    await page.goto('/account/benefits');
    await expect(page.getByRole('heading', { level: 1, name: /Business OS & benefits/ })).toBeVisible();
    await expect(page.getByText('Verified company')).toBeVisible();

    const activate = page.getByRole('button', { name: 'Activate Business OS' });
    if (await activate.isVisible()) {
      await expect(activate).toBeDisabled();           // needs a sector and the terms
      await page.getByLabel('Your main sector').selectOption('road-transport');
      await page.getByRole('checkbox').check();
      await expect(activate).toBeEnabled();
      await activate.click();
    }
    await expect(page.getByText('Starter Included · Active')).toBeVisible();
    await expect(page.getByText('Road transport')).toBeVisible();
    const users = page.getByRole('row', { name: /^Users/ });
    await expect(users).toContainText('3');
    await expect(page.getByText(/Online checkout is not open yet/)).toBeVisible();
  });

  test('organisation page shows a stable organisation id', async ({ page }) => {
    await page.goto('/account/organisation');
    await expect(page.getByRole('heading', { level: 1, name: 'Organisation' })).toBeVisible();
    await expect(page.getByText(/^[0-9a-f]{8}-[0-9a-f]{4}-/)).toBeVisible();
  });

  test('sidebar offers Business OS to a company account', async ({ page }) => {
    await page.goto('/open-loads');
    await page.getByRole('link', { name: 'Business OS' }).first().click();
    await expect(page).toHaveURL(/\/account\/benefits/);
  });
});

test.describe('sign-in for other Loadbyton sites (OIDC)', () => {
  const pkce = () => { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; };
  const authorize = (c) => '/api/oidc/authorize?' + new URLSearchParams({
    response_type: 'code', client_id: 'e2e-store', redirect_uri: CALLBACK, scope: 'openid email organisation',
    state: 'e2e-state', nonce: 'e2e-nonce', code_challenge: c, code_challenge_method: 'S256',
  });

  test('a signed-out person logs in once and is sent back with a code', async ({ page }) => {
    const { c } = pkce();
    await page.goto(authorize(c));
    await expect(page).toHaveURL(/\/login\?return_to=/);
    await page.fill('input[type="email"]', 'shipper@jebelalilogistics.ae');
    await page.fill('input[type="password"]', 'demo1234');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/oidc-callback\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get('state')).toBe('e2e-state');
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.get('iss')).toMatch(/\/api\/oidc$/);
  });

  test('an unsafe return_to is ignored: login lands in the app, not on the attacker', async ({ page }) => {
    for (const bad of ['https://evil.example/', '//evil.example', '/api/oidc/authorize/../../x', 'javascript:alert(1)']) {
      await page.context().clearCookies();
      await page.goto('/login?return_to=' + encodeURIComponent(bad));
      await page.fill('input[type="email"]', 'shipper@jebelalilogistics.ae');
      await page.fill('input[type="password"]', 'demo1234');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/dashboard/);
      expect(new URL(page.url()).hostname).toBe('127.0.0.1');
    }
  });
});

// Accessibility of the new surfaces (critical/serious only, as in
// accessibility.spec.js). Unlike that spec, nothing is exempted here: the new
// pages must pass contrast outright, which is why they use --lb-red-accessible
// and --lb-amber-text rather than the brand accent / warning colours.
const AXE_SCRIPT = path.join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');
async function audit(page) {
  await page.addScriptTag({ path: AXE_SCRIPT });
  const results = await page.evaluate(async () => axe.run(document, { resultTypes: ['violations'] })); // eslint-disable-line no-undef
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}
const describeViolations = (vs) => vs.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.map((n) => n.html).slice(0, 2).join(' | ')}`).join('\n');

test.describe('accessibility of ecosystem surfaces', () => {
  test('Business OS page, with the network menu open', async ({ page }) => {
    await page.goto('/business-os');
    await page.getByRole('button', { name: /Loadbyton network/ }).click();
    const v = await audit(page);
    expect(v, describeViolations(v)).toEqual([]);
  });

  test('ecosystem legal pages carry the draft notice and are accessible', async ({ page }) => {
    for (const [route, heading] of [['/premium-terms', /Premium Membership Terms/], ['/business-os-terms', /Business OS Activation Terms/], ['/data-sharing', /Data Sharing Notice/]]) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText(/awaiting review by a qualified UAE lawyer/)).toBeVisible();
      const v = await audit(page);
      expect(v, `${route}\n${describeViolations(v)}`).toEqual([]);
    }
  });

  test('interstitial', async ({ page }) => {
    await page.goto('/go/store');
    const v = await audit(page);
    expect(v, describeViolations(v)).toEqual([]);
  });

  test.describe('signed in', () => {
    test.use({ storageState: auth('carrier') });
    test('benefits and organisation', async ({ page }) => {
      for (const route of ['/account/benefits', '/account/organisation']) {
        await page.goto(route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const skip = page.getByRole('button', { name: /Skip.*don.t show this again/i });
        if (await skip.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await skip.click();
        const v = await audit(page);
        expect(v, `${route}\n${describeViolations(v)}`).toEqual([]);
      }
    });
  });
});
