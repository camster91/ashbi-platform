import { expect, test } from '@playwright/test';

// Keep request mocking hermetic; the worker's activation/message behavior is
// covered by its contract tests, while this browser test exercises the actual
// account-transition helper and Cache Storage in each browser engine.
test.use({ serviceWorkers: 'block' });

test('account transition purges legacy API caches but preserves static assets', async ({ page }) => {
  await page.route(/\/api\/.*/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(/\/api\/auth\/me/, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unauthorized' }),
    });
  });
  await page.route(/\/api\/auth\/login/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'account-b', name: 'Account B', email: 'b@example.com', role: 'ADMIN' },
      }),
    });
  });

  await page.goto('/login');
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

  await page.evaluate(async () => {
    const privateCache = await caches.open('hub-api-vulnerable-session');
    await privateCache.put('/api/clients', new Response(JSON.stringify({ account: 'A' })));
    const staticCache = await caches.open('hub-static-v3');
    await staticCache.put('/icon-192.png', new Response('static'));
  });

  await page.getByPlaceholder(/email/i).fill('b@example.com');
  await page.getByPlaceholder(/password/i).fill('valid-password');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(async () => page.evaluate(() => caches.keys())).not.toContain('hub-api-vulnerable-session');
  await expect.poll(async () => page.evaluate(() => caches.keys())).toContain('hub-static-v3');

  await page.evaluate(async () => {
    const privateCache = await caches.open('hub-api-account-b');
    await privateCache.put('/api/invoices', new Response(JSON.stringify({ account: 'B' })));
  });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('api:unauthorized', {
      detail: { message: 'Session expired' },
    }));
  });

  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(async () => page.evaluate(() => caches.keys())).not.toContain('hub-api-account-b');
  await expect.poll(async () => page.evaluate(() => caches.keys())).toContain('hub-static-v3');
});
