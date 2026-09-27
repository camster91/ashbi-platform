import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockAuthenticatedApi, unmockedRequests } from './fixtures/authenticated-api';

// Support impersonation (#416, docs/privileged-actions.md): an admin starts a
// read-only view from the Team page; every page then shows a persistent,
// accessible banner with the remaining time and a Stop button.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoAxeViolations(page: Page, screen: string, include?: string) {
  await page.evaluate(() => Promise.all(
    document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)),
  ));
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const summary = results.violations.map(violation => ({
    id: violation.id,
    help: violation.help,
    nodes: violation.nodes.slice(0, 8).map(node => ({ target: node.target.join(' '), html: node.html.slice(0, 160) })),
  }));
  expect(summary, `${screen} has WCAG A/AA violations`).toEqual([]);
}

test.describe('Support impersonation', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test.afterEach(({ page }) => {
    expect(unmockedRequests(page), 'API requests with no fixture; add them to tests/fixtures/authenticated-api.ts').toEqual([]);
  });

  test('an admin starts a read-only view from the Team page and stops it from the banner', async ({ page }) => {
    const state = await mockAuthenticatedApi(page);
    await page.goto('/team');
    await expect(page.getByText('Terry Team').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Support views' })).toBeVisible();

    await page.getByRole('button', { name: 'View as Terry Team' }).click();
    const dialog = page.getByRole('dialog', { name: 'View as Terry Team?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('read only, for up to 30 minutes');
    await dialog.getByRole('textbox', { name: 'Reason (shown to Terry Team)' }).fill('Ticket 2231: cannot see assigned tasks');
    await dialog.getByRole('button', { name: 'Start read-only view' }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    const banner = page.getByRole('region', { name: 'Support view' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Viewing as Terry Team');
    await expect(banner).toContainText('read only');
    await expect(banner).toContainText(/ends in (29|30) min/);
    expect(state.impersonationStarts).toEqual([{ userId: 'user-team', reason: 'Ticket 2231: cannot see assigned tasks' }]);

    await banner.getByRole('button', { name: 'Stop viewing as Terry Team' }).click();
    await expect(page).toHaveURL(/\/team$/);
    await expect(page.getByRole('region', { name: 'Support view' })).toHaveCount(0);
    expect(state.impersonationStops).toBe(1);
    // Let the reloaded Team page settle so no request outlives the fixture.
    await page.waitForLoadState('networkidle');
  });

  test('the banner is axe-clean and stays visible on every page', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Axe rule results are engine-independent; scan on Chromium desktop and Pixel 5.');
    await mockAuthenticatedApi(page, { impersonating: true });
    await page.goto('/dashboard');
    const banner = page.getByRole('region', { name: 'Support view' });
    await expect(banner).toBeVisible();
    await expectNoAxeViolations(page, 'impersonation banner', '[data-testid="impersonation-banner"]');

    // Keyboard: the Stop button is reachable and has a visible focus target.
    const stop = banner.getByRole('button', { name: 'Stop viewing as Terry Team' });
    await stop.focus();
    await expect(stop).toBeFocused();
    const box = await stop.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await page.goto('/projects');
    await expect(page.getByRole('region', { name: 'Support view' })).toBeVisible();
    await page.waitForLoadState('networkidle');
  });
});
