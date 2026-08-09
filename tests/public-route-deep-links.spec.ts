import { expect, test } from '@playwright/test';

const routes = [
  ['/login', 'Login'],
  ['/forgot-password', 'ForgotPassword'],
  ['/reset-password?token=test', 'ResetPassword'],
  ['/portal/test', 'Portal'],
  ['/portal/proposal/test', 'PortalProposal'],
  ['/portal/contract/test', 'PortalContract'],
  ['/portal/invoice/test', 'PortalInvoice'],
  ['/portal/book', 'PortalBooking'],
  ['/portal/form/test', 'PortalIntakeForm'],
  ['/portal/estimate/test', 'PortalEstimate'],
  ['/client-portal', 'ClientPortal'],
] as const;

test('every public deep link loads only its selected route chunk without overflow', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.route('**/api/**', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Authentication required' }),
  }));

  for (const [path, chunk] of routes) {
    const scripts = new Set<string>();
    const listener = (response: { url(): string }) => {
      if (/\/assets\/[^/]+\.js(?:\?|$)/.test(response.url())) scripts.add(response.url());
    };
    page.on('response', listener);
    const response = await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.getByLabel('Loading page')).toHaveCount(0);
    expect(response?.status()).toBeLessThan(400);
    expect([...scripts].some((url) => new RegExp(`/assets/${chunk}-[^/]+\\.js`).test(url))).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    page.off('response', listener);
  }

  expect(pageErrors).toEqual([]);
});
