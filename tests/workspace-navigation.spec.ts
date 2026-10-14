import { expect, test } from '@playwright/test';

async function staffSession(page, role = 'ADMIN') {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/auth/me'
      ? { id: 'navigation-qa', name: 'Navigation QA', email: 'qa@example.com', role }
      : path === '/api/projects' ? { projects: [] }
        : path.startsWith('/api/notifications') ? { notifications: [], total: 0 } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('five desktop areas reveal workflows and the compact rail stays small', async ({ page }) => {
  await staffSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(nav.getByRole('button', { name: /^(Expand|Collapse) / })).toHaveCount(5);
  await expect(nav.getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Invoices', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Collapse Work', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Expand Finance', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Invoices', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(nav.getByRole('button', { name: /^Open / })).toHaveCount(5);
  await expect(nav.getByRole('link')).toHaveCount(0);
  await nav.getByRole('button', { name: 'Open Knowledge', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Docs', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(nav.getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(nav.getByRole('button', { name: 'Collapse Knowledge', exact: true })).toBeVisible();
});

test('staff navigation retains daily work and excludes administrator destinations', async ({ page }) => {
  await staffSession(page, 'TEAM');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(nav.getByRole('link', { name: 'Daily Queue', exact: true })).toBeVisible();
  for (const area of ['Clients', 'Knowledge', 'Finance', 'Settings']) {
    await nav.getByRole('button', { name: `Expand ${area}`, exact: true }).click();
  }
  for (const name of ['Team', 'Credentials', 'Trash', 'Retainers', 'Rate Cards', 'Timesheets', 'Approvals']) {
    await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Collections', exact: true })).toBeVisible();
});

test('phone navigation uses the same areas and keeps Inbox discoverable', async ({ page }) => {
  await staffSession(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  for (const name of ['Work', 'Clients', 'Knowledge', 'Finance']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await nav.getByRole('button', { name: 'Open Settings navigation options' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const inbox = menu.getByRole('menuitem', { name: 'Inbox', exact: true });
  await inbox.scrollIntoViewIfNeeded();
  await expect(inbox).toBeInViewport();
  await inbox.click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(menu).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Clients', exact: true })).toHaveAttribute('aria-current', 'page');
});
