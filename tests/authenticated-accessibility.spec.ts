import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockAuthenticatedApi, mockClientPortalApi, unmockedRequests } from './fixtures/authenticated-api';

// Issue #305: the public-page axe checks never saw the signed-in app. These
// scans cover the main staff screens and the CLIENT portal against hermetic,
// realistic API fixtures so they run inside the required browser job without
// a backend.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Colour contrast must be measured on the settled page. Entry animations
// (fades and colour transitions) blend foreground and background while they
// run, and on slower CI runners axe caught them mid-transition and reported
// contrast that no user sees once the page has loaded. Scans run with reduced
// motion (which the app honours) and wait for every finite animation to end;
// infinite ones (loading spinners) never settle and are ignored.
async function waitForSettledPage(page: Page) {
  await page.evaluate(() => Promise.all(
    document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)),
  ));
}

async function expectNoAxeViolations(page: Page, screen: string) {
  await waitForSettledPage(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 8).map(node => ({
      target: node.target.join(' '),
      html: node.html.slice(0, 160),
      why: node.failureSummary?.split('\n')[1]?.trim(),
    })),
  }));
  expect(summary, `${screen} has WCAG A/AA violations`).toEqual([]);
}

const staffScreens: Array<{ name: string; path: string; ready: (page: Page) => Promise<void> }> = [
  { name: 'dashboard', path: '/dashboard', ready: page => expect(page.getByRole('heading', { name: /Cameron/, level: 1 })).toBeVisible() },
  { name: 'projects list', path: '/projects', ready: page => expect(page.getByText('Website Redesign').filter({ visible: true }).first()).toBeVisible() },
  { name: 'project page', path: '/project/project-a', ready: page => expect(page.getByRole('heading', { name: 'Website Redesign', level: 1 })).toBeVisible() },
  { name: 'clients', path: '/clients', ready: page => expect(page.getByText('Northwind Studio').filter({ visible: true }).first()).toBeVisible() },
  { name: 'invoices list', path: '/invoices', ready: page => expect(page.getByRole('link', { name: 'INV-2026-001' }).filter({ visible: true })).toBeVisible() },
  { name: 'invoice detail', path: '/invoices/invoice-a', ready: page => expect(page.getByText('Discovery and wireframes').filter({ visible: true }).first()).toBeVisible() },
  { name: 'proposals', path: '/proposals', ready: page => expect(page.getByText('Website Redesign Proposal').filter({ visible: true }).first()).toBeVisible() },
  { name: 'settings', path: '/settings', ready: page => expect(page.getByText('Zapier').filter({ visible: true }).first()).toBeVisible() },
  { name: 'notifications', path: '/notifications', ready: page => expect(page.getByText('Northwind Studio viewed INV-2026-001.')).toBeVisible() },
];

test.describe('Authenticated accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test.afterEach(({ page }) => {
    expect(unmockedRequests(page), 'API requests with no fixture; add them to tests/fixtures/authenticated-api.ts').toEqual([]);
  });

  test.skip(({ browserName }) => browserName !== 'chromium', 'Axe rule results are engine-independent; scan once per layout on Chromium desktop and Pixel 5 to keep the required job fast.');

  for (const screen of staffScreens) {
    test(`${screen.name} has no automatically detectable WCAG A/AA violations`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', error => pageErrors.push(`${error.message} ${error.stack?.split('\n')[1]?.trim() ?? ''}`));
      await mockAuthenticatedApi(page);
      await page.goto(screen.path);
      await screen.ready(page).catch(error => {
        throw new Error(`${screen.name} did not render (page errors: ${pageErrors.join(' | ') || 'none'}): ${error.message}`);
      });
      expect(pageErrors, `${screen.name} threw while rendering`).toEqual([]);
      await expectNoAxeViolations(page, screen.name);
    });
  }

  test('project page forms and dialogs have no automatically detectable WCAG A/AA violations', async ({ page }) => {
    await mockAuthenticatedApi(page);
    await page.goto('/project/project-a');
    await page.getByRole('button', { name: 'Create new note' }).click();
    await expect(page.getByRole('form', { name: 'New note' })).toBeVisible();
    await expectNoAxeViolations(page, 'project page with the new-note form open');

    await page.getByRole('button', { name: 'Draft project update' }).click();
    await expect(page.getByRole('dialog', { name: 'Draft client update' })).toBeVisible();
    await expectNoAxeViolations(page, 'project draft-update dialog');
  });

  test('client portal tabs have no automatically detectable WCAG A/AA violations for a CLIENT user', async ({ page }) => {
    await mockClientPortalApi(page);
    await page.goto('/client-portal/verify?token=portal-a11y-token');
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await expectNoAxeViolations(page, 'client portal overview');

    for (const tab of ['Projects (1)', 'Invoices (1)', 'Contracts (1)', 'Documents', 'Chat']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      if (tab === 'Documents') await expect(page.getByText('brand-guidelines.pdf')).toBeVisible();
      if (tab === 'Chat') await expect(page.getByText('Homepage draft is ready for review.')).toBeVisible();
      await expectNoAxeViolations(page, `client portal ${tab}`);
    }

    await page.getByRole('tab', { name: 'Documents' }).click();
    await page.getByRole('button', { name: 'Delete brand-guidelines.pdf' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete document?' })).toBeVisible();
    await expectNoAxeViolations(page, 'client portal delete confirmation');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Projects (1)' }).click();
    await page.getByRole('button', { name: /Website Redesign/ }).click();
    await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();
    await expectNoAxeViolations(page, 'client portal project detail');
  });
});
