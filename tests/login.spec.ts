import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should display login form when unauthenticated', async ({ page }) => {
    // Mock unauthorized response
    await page.route(/\/api\/auth\/me/, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' })
      });
    });

    await page.goto('/');

    // Wait for the login form to appear
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/password/i)).toBeVisible();
  });

  test('should login and redirect to dashboard', async ({ page }) => {
    // 1. Initially unauthorized
    await page.route(/\/api\/auth\/me/, async (route, request) => {
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Unauthorized' })
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    // 2. Mock successful login
    await page.route(/\/api\/auth\/login/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'usr-1', name: 'Test Admin', email: 'admin@test.com', role: 'ADMIN' },
          token: 'fake-jwt-token'
        })
      });
    });

    // 3. We also need to mock initial dashboard API calls
    await page.route(/\/api\/(dashboard|tasks|notifications)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ 
          stats: [], 
          IMMEDIATE: [], THIS_WEEK: [], UPCOMING: [], WAITING_CLIENT: [], WAITING_US: [],
          notifications: [], unreadCount: 0 
        })
      });
    });

    // 4. Mock the subsequent /me request that happens after login
    // We can unroute the previous /me mock and add a new one
    await page.unroute(/\/api\/auth\/me/);
    await page.route(/\/api\/auth\/me/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'usr-1', name: 'Test Admin', email: 'admin@test.com', role: 'ADMIN' }
        })
      });
    });

    // Perform login
    await page.getByPlaceholder(/email/i).fill('admin@test.com');
    await page.getByPlaceholder(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for URL to change or dashboard to load
    // Depending on the app's initial route, look for a known dashboard element
    // e.g., a "Dashboard" heading or the Navigation menu
    await expect(page.getByText('Test Admin')).toBeVisible({ timeout: 10000 });
  });
});
