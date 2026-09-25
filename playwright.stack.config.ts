import { defineConfig, devices } from '@playwright/test';

/**
 * Full-stack browser journeys for the required "Full-stack E2E smoke" gate.
 *
 * Runs against the hub booted by `npm run test:e2e:setup`
 * (tests/e2e/docker-compose.test.yml), which serves the built SPA and the real
 * API from one origin over a fresh Postgres. No request is mocked. The
 * journeys share that database and build on each other's state, so they run
 * serially in one worker and assert on deltas rather than absolute totals.
 */
const hubBase = process.env.HUB_BASE || 'http://localhost:3001';
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/e2e/journeys',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/stack' }]]
    : [['list']],
  outputDir: 'test-results/stack',
  use: {
    baseURL: hubBase,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
  ],
});
