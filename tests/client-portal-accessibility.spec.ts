import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const viewports = [
  { width: 320, height: 812 },
  { width: 375, height: 812 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

test.describe('Client portal accessibility', () => {
  test('exchanges and removes magic tokens, uses the cookie session, and performs server logout', async ({ page }) => {
    let exchangedToken = '';
    let logoutCalled = false;
    await page.route('**/api/client-portal/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/verify-token')) {
        exchangedToken = request.postDataJSON().token;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { role: 'CLIENT' } }) });
      }
      if (pathname.endsWith('/logout')) {
        logoutCalled = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
      }
      if (pathname.endsWith('/me')) {
        return route.fulfill({
          status: logoutCalled ? 401 : 200,
          contentType: 'application/json',
          body: logoutCalled ? '{"error":"revoked"}' : JSON.stringify({ client: { name: 'Fixture Client' }, contact: { name: 'Fixture Contact' } }),
        });
      }
      if (pathname.endsWith('/projects') || pathname.endsWith('/invoices')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (pathname.endsWith('/retainer')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"recentMessages":0,"upcomingDeadlines":0}' });
    });

    await page.goto('/client-portal/verify?token=one-time-magic-token');
    await expect(page).toHaveURL(/\/client-portal$/);
    await expect(page.getByText('Fixture Client')).toBeVisible();
    expect(exchangedToken).toBe('one-time-magic-token');
    expect(page.url()).not.toContain('token=');

    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page.getByRole('button', { name: 'Send Login Link' })).toBeVisible();
    expect(logoutCalled).toBe(true);
  });

  test('login reflows without overflow at supported breakpoints', async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/client-portal');
      await expect(page.getByRole('heading', { name: 'Ashbi Design' })).toBeVisible();

      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      expect(dimensions.scrollWidth, `${viewport.width}px viewport`).toBeLessThanOrEqual(
        dimensions.clientWidth,
      );
    }
  });

  test('uses accessible muted text, input boundaries, and keyboard focus', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/client-portal');

    const subtitle = page.getByText('Client Portal', { exact: true });
    const email = page.getByPlaceholder('your@email.com');

    await expect(subtitle).toHaveCSS('color', 'rgb(107, 102, 127)');
    await expect(email).toHaveCSS('border-color', 'rgb(145, 140, 159)');

    await email.focus();
    await expect(email).toBeFocused();
    await expect(email).toHaveCSS('outline-width', '3px');
    await expect(email).toHaveCSS('outline-style', 'solid');
  });

  test('login has no automatically detectable WCAG A or AA violations', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/client-portal');
    await expect(page.getByRole('heading', { name: 'Ashbi Design' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
