import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const user = { id: 'user-one', email: 'person@example.com', name: 'Test Admin', role: 'ADMIN' };

test('a transient session-check failure keeps the private deep link and offers recovery', async ({ page }) => {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Service unavailable' }),
  }));

  await page.goto('/projects?create=true');

  const alert = page.getByRole('alert');
  await expect(alert.getByRole('heading', { name: 'We could not verify your session' })).toBeVisible();
  await expect(alert).toContainText('you have not been signed out');
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\?create=true$/);

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test('an explicit API revocation returns to login with durable recovery guidance', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
    }
    if (url.pathname === '/api/projects') {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'This session was revoked by an administrator.' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/projects');

  await expect(page).toHaveURL(/\/login$/);
  const notice = page.getByRole('status');
  await expect(notice).toContainText('revoked by an administrator');
  await expect(notice).toContainText('Locally saved drafts remain on this device');
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
});
