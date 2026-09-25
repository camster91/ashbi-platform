import { expect, test } from '@playwright/test';

async function signInAsAdmin(page) {
  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/api/auth/me'
      ? { id: 'admin-a', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' }
      : pathname.startsWith('/api/notifications') ? { notifications: [], total: 0 } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('the More menu stays within a phone viewport and every item is reachable', async ({ page }) => {
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/dashboard');
  // A real click: the floating AI Chat button must not cover the More tab.
  await page.getByRole('button', { name: 'Open more navigation options' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  for (const item of [menu.getByRole('menuitem').first(), menu.getByRole('menuitem').last()]) {
    await item.scrollIntoViewIfNeeded();
    await expect(item).toBeInViewport();
  }
});

test('the AI chat drawer opens fully on screen above its button', async ({ page, isMobile }) => {
  await signInAsAdmin(page);
  await page.setViewportSize(isMobile ? { width: 375, height: 667 } : { width: 1280, height: 800 });
  await page.goto('/dashboard');
  const button = page.getByRole('button', { name: 'Open AI Chat' });
  await button.click();
  const drawer = page.getByRole('dialog', { name: 'Ask Ash' });
  await expect(drawer).toBeVisible();
  const drawerBox = (await drawer.boundingBox())!;
  expect(drawerBox.y).toBeGreaterThanOrEqual(0);
  expect(drawerBox.y + drawerBox.height).toBeLessThanOrEqual((await button.boundingBox())!.y);
});
