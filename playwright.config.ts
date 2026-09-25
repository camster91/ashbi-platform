import { defineConfig, devices } from '@playwright/test';

const browserTestPort = Number(process.env.PLAYWRIGHT_PORT || 4188);
const browserTestBaseUrl = `http://127.0.0.1:${browserTestPort}`;
// Optional local override for sandboxes that ship a pre-installed Chromium
// build instead of Playwright's bundled one. Unset in CI.
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const chromiumLaunchOptions = chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {};

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  // Keep Playwright from importing Vitest's `*.test.mjs` integration suite.
  // Browser tests use the conventional `*.spec.ts` suffix.
  testMatch: '**/*.spec.ts',
  // These need the production preview build (service workers, route chunks)
  // and run through playwright.pwa.config.ts / playwright.public.config.ts.
  // tests/e2e/journeys need the full Docker stack and run through
  // playwright.stack.config.ts in the Full-stack E2E gate.
  testIgnore: ['**/pwa-offline.spec.ts', '**/public-route-deep-links.spec.ts', '**/e2e/**'],
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
  outputDir: 'test-results',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: browserTestBaseUrl,
    serviceWorkers: 'block',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...chromiumLaunchOptions },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'], ...chromiumLaunchOptions },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `npm --prefix web run dev -- --host 127.0.0.1 --port ${browserTestPort}`,
    url: browserTestBaseUrl,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
