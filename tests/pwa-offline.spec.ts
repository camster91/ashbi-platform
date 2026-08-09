import { expect, test } from '@playwright/test';

test('visited login remains available offline without caching API data', async ({ context, page }) => {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.evaluate(async () => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'networkidle' });
  }
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  // The first controlled navigation is what populates the navigation and
  // static-asset caches. A page loaded before registration cannot be
  // intercepted retroactively by its newly installed worker.
  await page.goto('/login', { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  const cacheKeys = await page.evaluate(() => caches.keys());
  expect(cacheKeys).toContain('hub-v3');
  expect(cacheKeys.some((key) => key.startsWith('hub-api-'))).toBe(false);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  const apiResult = await page.evaluate(async () => {
    const response = await fetch('/api/health');
    return { status: response.status, body: await response.text() };
  });
  expect(apiResult.status).toBe(503);
  expect(apiResult.body).toBe('Offline');
  expect(await page.evaluate(() => caches.keys())).not.toContainEqual(expect.stringMatching(/^hub-api-/));

  await context.setOffline(false);
});
