import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/pwa-offline.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4190',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm --prefix web run preview -- --host 127.0.0.1 --port 4190',
    url: 'http://127.0.0.1:4190',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
