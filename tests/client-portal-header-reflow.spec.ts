import { expect, test } from '@playwright/test';

for (const width of [320, 375, 430]) {
  test(`client header fits ${width}px with realistic business names`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.route('**/api/client-portal/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const body = pathname.endsWith('/me')
        ? { brand: { companyName: 'QA Agents — Development Sandbox' }, client: { name: 'QA Synthetic Client' }, contact: { name: 'QA Client Contact' } }
        : pathname.endsWith('/retainer') ? null
        : pathname.endsWith('/unread-count') ? { recentMessages: 0, upcomingDeadlines: 0 }
        : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/client-portal');
    const logout = page.getByRole('button', { name: 'Log out of client portal' });
    await expect(logout).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const bounds = await logout.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await logout.focus();
    await expect(logout).toBeFocused();
    await page.evaluate(() => window.scrollTo(0, 160));
    const header = await page.locator('.cp-header').boundingBox();
    const tabs = await page.getByRole('tablist', { name: 'Portal sections' }).boundingBox();
    expect(tabs!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  });
}
