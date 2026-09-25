import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const adminTasks = [
  { id: 'add-client', title: 'Add your first client', description: 'Create or import the client account.', href: '/clients', permission: 'ADMIN', completed: false, skipped: false },
  { id: 'create-project', title: 'Create a client project', description: 'Give client work a shared home.', href: '/projects', permission: 'ADMIN', completed: false, skipped: false },
  { id: 'create-proposal', title: 'Create a proposal', description: 'Build the first revenue workflow.', href: '/proposals', permission: 'ADMIN', completed: false, skipped: false },
];

test('account-backed ADMIN onboarding is accessible and responsive without recording navigation as success', async ({ page }) => {
  let progress = { supported: true, role: 'ADMIN', state: 'eligible', startedAt: null, completedCount: 0, totalCount: 3, tasks: adminTasks };
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname === '/api/auth/me') return json({ id: 'admin-a', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' });
    if (pathname === '/api/onboarding/progress' && request.method() === 'GET') return json(progress);
    if (pathname === '/api/onboarding/progress/start') {
      progress = { ...progress, state: 'in_progress', startedAt: '2026-08-09T12:00:00.000Z' };
      return json(progress);
    }
    if (pathname.startsWith('/api/notifications')) return json({ notifications: [], total: 0 });
    if (pathname.includes('/unread')) return json({ count: 0 });
    return json({});
  });

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/dashboard');
  const welcome = page.getByRole('dialog', { name: 'Welcome to Ashbi Hub' });
  await expect(welcome).toBeVisible({ timeout: 15_000 });
  // Eligible users walk a short feature intro before starting the checklist.
  await welcome.getByRole('button', { name: 'Next' }).click();
  await welcome.getByRole('button', { name: 'Next' }).click();
  await welcome.getByRole('button', { name: 'Start checklist' }).click();
  await expect(page.getByRole('dialog', { name: 'Your getting-started checklist' })).toBeVisible();

  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 720 : 900 });
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll('*')]
        .map(element => ({ element: element.tagName, className: String(element.className), rect: element.getBoundingClientRect().toJSON() }))
        .filter(item => item.rect.right > window.innerWidth + 1)
        .slice(0, 10),
    }));
    expect(dimensions.scrollWidth, `${width}px viewport: ${JSON.stringify(dimensions.overflowing)}`).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.getByRole('progressbar', { name: 'Onboarding progress' })).toHaveAttribute('aria-valuenow', '0');
  }

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  await page.getByRole('dialog', { name: 'Your getting-started checklist' }).getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('button', { name: 'Resume getting started, 0 of 3 tasks resolved' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume getting started, 0 of 3 tasks resolved' }).click();
  await page.getByRole('button', { name: 'Open task' }).first().click();
  await expect(page).toHaveURL(/\/clients$/);
  expect(progress.completedCount).toBe(0);
});

test('TEAM onboarding excludes admin outcomes and keeps server save failures recoverable', async ({ page }) => {
  const tasks = [
    { id: 'complete-task', title: 'Complete an assigned task', description: 'Complete one task.', href: '/tasks', permission: 'TEAM', completed: false, skipped: false },
    { id: 'log-time', title: 'Log time on project work', description: 'Record time.', href: '/time', permission: 'TEAM', completed: false, skipped: false },
    { id: 'create-document', title: 'Contribute a project document', description: 'Create a page.', href: '/docs', permission: 'TEAM', completed: false, skipped: false },
  ];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname === '/api/auth/me') return json({ id: 'team-a', name: 'Team member', email: 'team@example.com', role: 'TEAM' });
    if (pathname === '/api/onboarding/progress' && request.method() === 'GET') {
      return json({ supported: true, role: 'TEAM', state: 'in_progress', startedAt: '2026-08-09T12:00:00.000Z', completedCount: 0, totalCount: 3, tasks });
    }
    if (pathname === '/api/onboarding/progress/tasks/skip') return json({ error: 'Progress service unavailable' }, 503);
    if (pathname.startsWith('/api/notifications')) return json({ notifications: [], total: 0 });
    if (pathname.includes('/unread')) return json({ count: 0 });
    return json({});
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/dashboard');
  await expect(page.getByRole('dialog', { name: 'Your getting-started checklist' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Complete an assigned task' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add your first client' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip this task' }).first().click();
  await expect(page.getByText('Progress service unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Your getting-started checklist' })).toBeVisible();
});
