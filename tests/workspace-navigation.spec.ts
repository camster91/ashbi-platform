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
  // A pinned group (Dashboard, Daily Queue, Inbox, Clients) stays visible above
  // five collapsible areas: Sales, Work, Money, Studio and Settings.
  for (const name of ['Dashboard', 'Daily Queue', 'Inbox', 'Clients']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('button', { name: /^(Expand|Collapse) / })).toHaveCount(5);
  await expect(nav.getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Expand Work', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Collapse Work', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Invoices', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Expand Money', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Invoices', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  // The compact rail: four pinned icons plus one button per area.
  await expect(nav.getByRole('button', { name: /^Open / })).toHaveCount(5);
  await expect(nav.getByRole('link')).toHaveCount(4);
  await nav.getByRole('button', { name: 'Open Studio', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Docs', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(nav.getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(nav.getByRole('button', { name: 'Collapse Studio', exact: true })).toBeVisible();
});

test('staff navigation retains daily work and excludes administrator destinations', async ({ page }) => {
  await staffSession(page, 'TEAM');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(nav.getByRole('link', { name: 'Daily Queue', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Expand Work', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Timesheets', exact: true })).toBeVisible();
  for (const area of ['Sales', 'Money', 'Studio', 'Settings']) {
    await nav.getByRole('button', { name: `Expand ${area}`, exact: true }).click();
  }
  for (const name of ['Team', 'Credentials', 'Trash', 'Retainers', 'Rate Cards', 'Approvals']) {
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
  for (const name of ['Home', 'Sales', 'Money', 'Studio']) {
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
  // Inbox is in the pinned group, which the phone's Home tab covers.
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
});


test('staff can open personal timesheets from phone navigation', async ({ page }) => {
  await staffSession(page, 'TEAM');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open Settings navigation options' }).click();
  const menu = page.getByRole('menu');
  const timesheets = menu.getByRole('menuitem', { name: 'Timesheets', exact: true });
  await timesheets.scrollIntoViewIfNeeded();
  await expect(timesheets).toBeVisible();
  await timesheets.click();
  await expect(page).toHaveURL(/\/timesheets$/);
  await expect(page.getByRole('heading', { name: 'Timesheets', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve|Reject/ })).toHaveCount(0);
});
