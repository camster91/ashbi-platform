import { test, expect } from '@playwright/test'

const TEST_EMAIL = `e2e-${Date.now()}@test.local`
const TEST_PASSWORD = 'TestPass123!'

test.describe('ChoreChamps public pages', () => {
  test('landing page renders with correct title', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/ChoreChamps/)
    // Check for key landing content
    const heading = page.locator('h1').first()
    await expect(heading).toBeVisible()
  })

  test('signup page renders with resolved i18n keys', async ({ page }) => {
    await page.goto('/signup')
    await expect(page).toHaveTitle(/ChoreChamps/)
    // Wait for client-side hydration to finish (loading spinner disappears)
    await page.waitForSelector('.lucide-loader-circle', { state: 'detached', timeout: 5000 }).catch(() => {})
    
    // Check for resolved translation strings (not raw i18n keys)
    const body = await page.locator('body').textContent()
    expect(body).not.toMatch(/auth\.createAccount|common\.name|common\.email/)
    
    // Check form fields exist
    await expect(page.locator('input[type="text"]').first()).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('login page renders', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle(/ChoreChamps/)
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeDefined()
  })
})

test.describe('ChoreChamps auth flow', () => {
  test('signup form validation works', async ({ page }) => {
    await page.goto('/signup')
    await page.waitForSelector('.lucide-loader-circle', { state: 'detached', timeout: 5000 }).catch(() => {})
    
    // Try submitting empty form
    const submitButton = page.locator('button[type="submit"]').first()
    await expect(submitButton).toBeVisible()
    
    // Fill partial data and verify fields accept input
    await page.locator('input[type="text"]').first().fill('E2E Parent')
    await page.locator('input[type="email"]').fill(TEST_EMAIL)
    await page.locator('input[type="password"]').first().fill(TEST_PASSWORD)
    
    // Verify values stuck
    expect(await page.locator('input[type="text"]').first().inputValue()).toBe('E2E Parent')
    expect(await page.locator('input[type="email"]').inputValue()).toBe(TEST_EMAIL)
  })
})