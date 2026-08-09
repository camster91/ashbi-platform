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

test('reduced-motion preference suppresses utility and custom animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login', { waitUntil: 'networkidle' });

  const motion = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'animate-spin animate-pulse animate-bounce animate-shake animate-fade-in transition-all';
    document.body.append(probe);
    const styles = getComputedStyle(probe);
    const result = {
      animationName: styles.animationName,
      opacity: styles.opacity,
      transform: styles.transform,
      transitionDuration: styles.transitionDuration,
    };
    probe.remove();
    return result;
  });

  expect(motion.animationName).toBe('none');
  expect(motion.opacity).toBe('1');
  expect(motion.transform).toBe('none');
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.00001);
});
