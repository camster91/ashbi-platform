import { expect, test, type Page } from '@playwright/test';
import { mockAuthenticatedApi, mockClientPortalApi, unmockedRequests } from '../fixtures/authenticated-api';
import { MATRIX, expectScreen, mockVisualExtras, prepare, snapshotName, type Theme, type ViewportName } from './visual-helpers';

// Visual-regression baselines (#322): representative screens in light and
// dark at 375 and 1440 CSS px, against the hermetic API fixtures. Proposed
// baselines; the design owner approves changes (docs/visual-baselines.md).

type Screen = {
  name: string;
  path: string;
  ready: (page: Page) => Promise<void>;
  /** Extra widths/themes beyond MATRIX, kept to cheap, high-value captures. */
  extra?: Array<{ theme: Theme; viewport: ViewportName }>;
  /** Show the one-time push-notification prompt in the shell. */
  pushPrompt?: boolean;
};

const h1 = (page: Page, name: string | RegExp) => expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

const staffScreens: Screen[] = [
  {
    name: 'dashboard',
    path: '/dashboard',
    ready: async page => {
      await h1(page, /Cameron/);
      await expect(page.getByText('Northwind Studio').filter({ visible: true }).first()).toBeVisible();
    },
    extra: [{ theme: 'light', viewport: 'tablet' }],
    // The dashboard is the landing screen, so it is where the shell's
    // push-notification prompt is captured; other screens start past it.
    pushPrompt: true,
  },
  { name: 'clients', path: '/clients', ready: page => expect(page.getByText('Northwind Studio').filter({ visible: true }).first()).toBeVisible() },
  { name: 'projects', path: '/projects', ready: page => expect(page.getByText('Website Redesign').filter({ visible: true }).first()).toBeVisible() },
  {
    name: 'project',
    path: '/project/project-a',
    ready: async page => {
      await h1(page, 'Website Redesign');
      await expect(page.getByText('Homepage draft is ready for review.')).toBeVisible();
    },
  },
  { name: 'invoices', path: '/invoices', ready: page => expect(page.getByRole('link', { name: 'INV-2026-001' }).filter({ visible: true })).toBeVisible() },
  { name: 'queue', path: '/queue', ready: page => expect(page.getByRole('link', { name: /Finalize homepage wireframe/ })).toBeVisible() },
  { name: 'settings', path: '/settings', ready: page => expect(page.getByText('Zapier').filter({ visible: true }).first()).toBeVisible() },
];

for (const screen of staffScreens) {
  test.describe(`${screen.name}`, () => {
    test.afterEach(({ page }) => {
      expect(unmockedRequests(page), 'API requests with no fixture').toEqual([]);
    });

    for (const { theme, viewport } of [...MATRIX, ...(screen.extra ?? [])]) {
      test(`${theme} ${viewport}`, async ({ page }) => {
        await prepare(page, theme, viewport, { pushPrompt: screen.pushPrompt });
        await mockAuthenticatedApi(page);
        await mockVisualExtras(page);
        await page.goto(screen.path);
        await screen.ready(page);
        if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
        await expectScreen(page, snapshotName(screen.name, theme, viewport));
      });
    }
  });
}

test.describe('login', () => {
  for (const { theme, viewport } of MATRIX) {
    test(`${theme} ${viewport}`, async ({ page }) => {
      await prepare(page, theme, viewport);
      await mockAuthenticatedApi(page, { signedIn: false });
      await page.goto('/login');
      await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
      await expectScreen(page, snapshotName('login', theme, viewport));
    });
  }
});

// The client portal is light-only (usePortalLightTheme), so a dark capture
// would duplicate the light one.
test.describe('client portal home', () => {
  for (const viewport of ['mobile', 'desktop'] as const) {
    test(`light ${viewport}`, async ({ page }) => {
      await prepare(page, 'light', viewport);
      await mockClientPortalApi(page);
      await page.goto('/client-portal/verify?token=visual-baseline-token');
      await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText('Website Redesign').filter({ visible: true }).first()).toBeVisible();
      await expectScreen(page, snapshotName('portal-home', 'light', viewport));
      expect(unmockedRequests(page), 'API requests with no fixture').toEqual([]);
    });
  }
});

// The UI lab gallery (alerts, empty state, skeletons) is captured full-page:
// it is the one place every shared state primitive renders side by side.
test.describe('ui lab gallery', () => {
  for (const { theme, viewport } of MATRIX) {
    test(`${theme} ${viewport}`, async ({ page }) => {
      await prepare(page, theme, viewport);
      await mockAuthenticatedApi(page, { signedIn: false });
      await page.goto('/ui-lab');
      await h1(page, 'UI polish lab');
      await expectScreen(page, snapshotName('ui-lab', theme, viewport), { fullPage: true });
    });
  }
});
