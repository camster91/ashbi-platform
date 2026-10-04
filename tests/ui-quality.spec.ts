import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminUser, mockAuthenticatedApi, unmockedRequests } from './fixtures/authenticated-api';

// UI quality regressions found by the live QA pass: axe violations on screens
// the authenticated-accessibility suite did not cover yet, the same key screens
// in dark mode, and page-level horizontal overflow on the project boards.
// Runs hermetically: the shared fixture answers the common API and the layer
// below adds the records these extra screens read.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const YESTERDAY = '2026-08-19T15:00:00.000Z';
const NEXT_WEEK = '2026-08-27T15:00:00.000Z';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const kanbanTasks = {
  PENDING: [{ id: 'task-b', title: 'Collect brand assets', status: 'PENDING', priority: 'NORMAL', dueDate: NEXT_WEEK, assignee: null }],
  IN_PROGRESS: [{ id: 'task-a', title: 'Finalize homepage wireframe with a deliberately long title that must wrap on mobile', status: 'IN_PROGRESS', priority: 'HIGH', dueDate: NEXT_WEEK, assignee: { id: adminUser.id, name: adminUser.name } }],
  BLOCKED: [],
  COMPLETED: [{ id: 'task-c', title: 'Kickoff call', status: 'COMPLETED', priority: 'LOW', dueDate: YESTERDAY, assignee: null }],
  WAITING_CLIENT: [{ id: 'task-d', title: 'Brand guidelines sign-off', status: 'WAITING_CLIENT', priority: 'LOW', dueDate: NEXT_WEEK, assignee: null }],
};

const taskPage = {
  id: 'task-a',
  title: 'Finalize homepage wireframe with a deliberately long title that must wrap on mobile',
  icon: '📄',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  dueDate: NEXT_WEEK,
  content: [{ type: 'heading1', content: 'Brief' }, { type: 'paragraph', content: 'Hero, services and contact sections.' }],
  properties: {},
  project: { id: 'project-a', name: 'Website Redesign' },
  assignee: { id: adminUser.id, name: adminUser.name },
  subpages: [],
  comments: [],
};

const clientDetail = {
  id: 'client-a',
  name: 'Northwind Studio',
  domain: 'northwind.example',
  status: 'ACTIVE',
  relationshipStatus: 'ACTIVE',
  totalRevenue: 12000,
  outstandingBalance: 4520,
  contacts: [{ id: 'contact-a', name: 'Dana Rivera', email: 'dana@northwind.example', isPrimary: true, role: 'Marketing lead' }],
  projects: [{ id: 'project-a', name: 'Website Redesign', status: 'DESIGN_DEV', health: 'ON_TRACK', updatedAt: YESTERDAY, _count: { tasks: 3 } }],
  threads: [],
  invoices: [{ id: 'invoice-a', invoiceNumber: 'INV-2026-001', status: 'SENT', total: 4520, currency: 'USD', dueDate: NEXT_WEEK, createdAt: YESTERDAY }],
  communicationPrefs: {},
  knowledgeBase: {},
  createdAt: YESTERDAY,
  updatedAt: YESTERDAY,
};

async function mockExtraApi(page: Page) {
  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method();
    const { pathname } = new URL(request.url());
    const path = pathname.replace(/^\/api/, '');
    if (method !== 'GET') return route.fallback();

    if (path === '/tasks/kanban/project-a') return json(route, kanbanTasks);
    if (path === '/tasks/task-a/page') return json(route, taskPage);
    if (path === '/tasks/task-a/breadcrumbs') return json(route, [{ id: 'project-a', title: 'Website Redesign', isProject: true }]);
    if (path === '/clients/client-a') return json(route, clientDetail);
    if (path === '/clients/client-a/insights') return json(route, { recentThreadCount: 2, sentimentBreakdown: { positive: 2 }, satisfactionTrend: 'Stable' });
    if (path === '/expenses') return json(route, { expenses: [{ id: 'expense-a', description: 'Stock photos', amount: 49, currency: 'USD', category: 'SOFTWARE', date: YESTERDAY, billable: true, client: { id: 'client-a', name: 'Northwind Studio' } }], total: 1 });
    if (path === '/expenses/summary') return json(route, { totalThisMonth: 49, allTimeTotal: 49, byCategory: { SOFTWARE: 49 }, billableTotal: 49 });
    if (path === '/assets') return json(route, { assets: [], total: 0 });
    if (path === '/approvals') return json(route, { approvals: [], total: 0 });
    if (path === '/approvals/stats') return json(route, { pending: 0, approved: 0, rejected: 0 });
    if (path === '/responses/pending') return json(route, []);
    if (path === '/credentials') return json(route, { credentials: [] });
    if (path === '/trash') return json(route, { items: [], total: 0 });
    if (path === '/brand') return json(route, { companyName: 'Ashbi Design', primaryColor: '#c9a84c', accentColor: '#1e293b' });
    if (path === '/team') return json(route, [{ ...adminUser, isActive: true, utilizationPercent: 45, assignedTasks: 3, capacityStatus: 'available' }]);
    if (path === '/team/workload') return json(route, []);
    if (path === '/contracts') return json(route, []);
    if (path === '/pipeline') return json(route, { stages: [] });
    if (path === '/pipeline/analytics') return json(route, { conversionRates: { leadToProposal: 50, proposalToContract: 20, contractToProject: 80, invoiceToPaid: 10 } });
    return route.fallback();
  });
}

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(
    document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)),
  ));
}

async function axeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map(violation => ({
    id: violation.id,
    nodes: violation.nodes.slice(0, 6).map(node => `${node.target.join(' ')} :: ${node.failureSummary?.split('\n')[1]?.trim() ?? ''}`),
  }));
}

type Screen = { name: string; path: string; ready: (page: Page) => Promise<void> };

const screens: Screen[] = [
  { name: 'task board', path: '/project/project-a/kanban', ready: page => expect(page.getByRole('heading', { name: 'Kanban Board' })).toBeVisible() },
  { name: 'task page', path: '/task/task-a', ready: page => expect(page.getByLabel('Task title')).toBeVisible() },
  { name: 'client detail', path: '/client/client-a', ready: page => expect(page.getByRole('heading', { name: 'Northwind Studio', level: 1 })).toBeVisible() },
  { name: 'expenses', path: '/expenses', ready: page => expect(page.getByRole('heading', { name: 'Expenses', level: 1 })).toBeVisible() },
  { name: 'assets', path: '/assets', ready: page => expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible() },
  { name: 'project planner', path: '/project-planner', ready: page => expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible() },
  { name: 'approvals', path: '/approvals', ready: page => expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible() },
  { name: 'client replies to approve', path: '/approvals/replies', ready: page => expect(page.getByRole('heading', { name: 'Client replies to approve', level: 1 })).toBeVisible() },
  { name: 'credentials', path: '/credentials', ready: page => expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible() },
  { name: 'trash', path: '/trash', ready: page => expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible() },
  { name: 'brand settings', path: '/admin/brand', ready: page => expect(page.getByLabel('Company Name')).toBeVisible() },
  { name: 'team', path: '/team', ready: page => expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible() },
  { name: 'pipeline', path: '/pipeline', ready: page => expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible() },
  { name: 'contracts', path: '/contracts', ready: page => expect(page.getByRole('heading', { name: 'Contracts', level: 1 })).toBeVisible() },
];

const darkScreens: Screen[] = [
  { name: 'dashboard', path: '/dashboard', ready: page => expect(page.getByRole('heading', { name: /Cameron/, level: 1 })).toBeVisible() },
  { name: 'projects list', path: '/projects', ready: page => expect(page.getByText('Website Redesign').filter({ visible: true }).first()).toBeVisible() },
  { name: 'project page', path: '/project/project-a', ready: page => expect(page.getByRole('heading', { name: 'Website Redesign', level: 1 })).toBeVisible() },
  { name: 'task board', path: '/project/project-a/kanban', ready: page => expect(page.getByRole('heading', { name: 'Kanban Board' })).toBeVisible() },
  { name: 'contracts', path: '/contracts', ready: page => expect(page.getByRole('heading', { name: 'Contracts', level: 1 })).toBeVisible() },
];

test.describe('UI quality', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockAuthenticatedApi(page);
    await mockExtraApi(page);
  });

  test.afterEach(({ page }) => {
    expect(unmockedRequests(page), 'API requests with no fixture').toEqual([]);
  });

  test.skip(({ browserName }) => browserName !== 'chromium', 'Axe and layout checks run on Chromium desktop and Pixel 5.');

  for (const screen of screens) {
    test(`${screen.name} has no automatically detectable WCAG violations`, async ({ page }) => {
      await page.goto(screen.path);
      await screen.ready(page);
      expect(await axeViolations(page), `${screen.name} axe violations`).toEqual([]);
    });
  }

  for (const screen of darkScreens) {
    test(`${screen.name} has no WCAG violations in dark mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.goto(screen.path);
      await screen.ready(page);
      await expect(page.locator('html')).toHaveClass(/dark/);
      expect(await axeViolations(page), `${screen.name} dark-mode axe violations`).toEqual([]);
    });
  }

  for (const path of ['/projects', '/project/project-a/kanban', '/project/project-a']) {
    test(`${path} does not scroll the page horizontally`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).last()).toBeVisible();
      await settle(page);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `${path} is wider than the viewport`).toBeLessThanOrEqual(clientWidth + 1);
    });
  }

  // The shared page skeletons (PageSkeleton.jsx) render on every collection
  // screen while it loads. The UI lab (dev-only) shows all three side by side;
  // at 375px their headers used to be wider than the viewport (#322 baseline).
  test('page skeletons do not scroll the page horizontally at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/ui-lab');
    await expect(page.getByRole('heading', { name: 'UI polish lab', level: 1 })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading clients demo' })).toBeVisible();
    await settle(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, '/ui-lab skeletons are wider than the viewport').toBeLessThanOrEqual(clientWidth + 1);
  });

  test('project page opens at the top instead of scrolling to the chat', async ({ page }) => {
    await page.goto('/project/project-a');
    await expect(page.getByRole('heading', { name: 'Website Redesign', level: 1 })).toBeVisible();
    await expect(page.getByText('Homepage draft is ready for review.')).toBeVisible();
    await page.waitForTimeout(300);
    const scrolled = await page.evaluate(() => Math.max(window.scrollY, document.getElementById('main-content')?.scrollTop ?? 0));
    expect(scrolled).toBeLessThan(50);
    await expect(page.getByRole('heading', { name: 'Website Redesign', level: 1 })).toBeInViewport();
  });

  test('task cards can be moved with the keyboard and keep focus', async ({ page, isMobile }) => {
    const moves: unknown[] = [];
    let current = kanbanTasks;
    await page.route('**/api/tasks/kanban/project-a', route => json(route, current));
    await page.route('**/api/tasks/task-b/move', route => {
      const body = route.request().postDataJSON() as { status: 'IN_PROGRESS' };
      moves.push(body);
      const card = { ...kanbanTasks.PENDING[0], status: body.status };
      current = { ...kanbanTasks, PENDING: [], [body.status]: [...kanbanTasks[body.status], card] };
      return json(route, card);
    });
    await page.goto('/project/project-a/kanban');
    const card = page.locator('li[data-task-id="task-b"]');
    await card.focus();
    await expect(card).toBeFocused();
    await expect(card).toHaveAccessibleDescription(/In column To Do\./);
    // Stacked (mobile) columns move with Down; side-by-side columns with Right.
    await page.keyboard.press(isMobile ? 'ArrowDown' : 'ArrowRight');
    await expect.poll(() => moves).toEqual([{ status: 'IN_PROGRESS' }]);
    await expect(page.getByRole('status').filter({ hasText: 'Moved "Collect brand assets" to In Progress.' })).toBeAttached();
    const moved = page.locator('li[data-task-id="task-b"][data-status="IN_PROGRESS"]');
    await expect(moved).toBeVisible();
    await expect(moved).toBeFocused();
  });

  test('task board shows every task status and has no empty fixed-height columns on mobile', async ({ page, isMobile }) => {
    await page.goto('/project/project-a/kanban');
    await expect(page.getByRole('heading', { name: 'Waiting on client' })).toBeVisible();
    await expect(page.getByText('Brand guidelines sign-off')).toBeVisible();
    if (isMobile) {
      const blocked = page.getByRole('region', { name: 'Blocked' });
      const box = await blocked.boundingBox();
      expect(box?.height ?? 0).toBeLessThan(200);
    }
  });

  test('the Cmd/Ctrl+K shortcut is advertised on Create and opens Quick add', async ({ page, isMobile }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /Cameron/, level: 1 })).toBeVisible();
    const search = page.getByPlaceholder('Search threads, clients, projects...');
    await expect(search.locator('xpath=..').locator('kbd')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open quick create menu' })).toHaveAccessibleDescription(/Command K or Control K opens Quick add/);
    if (!isMobile) {
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog', { name: 'Quick add' })).toBeVisible();
    }
  });

  test('task title wraps instead of clipping', async ({ page }) => {
    await page.goto('/task/task-a');
    const title = page.getByLabel('Task title');
    await expect(title).toBeVisible();
    const { scrollWidth, clientWidth } = await title.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});

test.describe('Client invitation link', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Runs on Chromium desktop and Pixel 5.');

  test('opens the invitation page, not staff login, and has no WCAG violations', async ({ page }) => {
    await page.route('**/api/auth/me', route => json(route, { error: 'Unauthorized' }, 401));
    await page.goto('/client/invite?token=abc123');
    await expect(page.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible();
    await expect(page).toHaveURL(/\/client\/invite\?token=abc123$/);
    expect(await axeViolations(page)).toEqual([]);
  });
});

