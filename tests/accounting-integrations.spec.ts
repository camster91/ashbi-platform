import { expect, test } from '@playwright/test';

test('accounting providers are truthful, unavailable, and responsive', async ({ page }) => {
  await page.route(/\/api\/.*/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(/\/api\/auth\/me/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'admin-1',
        name: 'Admin',
        email: 'admin@example.com',
        role: 'ADMIN',
      }),
    });
  });
  await page.route(/\/api\/api-keys/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ keys: [] }),
    });
  });

  await page.goto('/settings');

  // Scope every assertion to the Accounting Integrations region so valid
  // integrations elsewhere on Settings (Google Calendar, Slack) cannot fail
  // this gate, while a connect/sync control appearing inside the accounting
  // section itself still fails it.
  const accountingSection = page.getByRole('region', { name: 'Accounting Integrations' });
  await expect(accountingSection).toBeVisible();
  await expect(accountingSection.getByRole('heading', { name: 'Accounting Integrations' })).toBeVisible();
  await expect(accountingSection.getByText('QuickBooks Online')).toBeVisible();
  await expect(accountingSection.getByText('Xero', { exact: true })).toBeVisible();
  await expect(accountingSection.getByText('Unavailable')).toHaveCount(2);
  await expect(accountingSection.getByRole('button', { name: /connect|sync|disconnect/i })).toHaveCount(0);
  await expect(accountingSection.getByText(/connected|sync started|last synced/i)).toHaveCount(0);

  const hasHorizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ));
  expect(hasHorizontalOverflow).toBe(false);
});
