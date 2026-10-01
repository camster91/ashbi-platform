import { defineConfig, devices } from '@playwright/test';

// Visual-regression baselines (#322). See docs/visual-baselines.md.
//
// Runs the built SPA (like playwright.public.config.ts) against the hermetic
// API fixtures in tests/fixtures, on Chromium only, with every rendering input
// pinned: device scale factor, locale, timezone, colour scheme (per test),
// reduced motion and disabled animations. The build sets VITE_ENABLE_UI_LAB so
// the dev-only /ui-lab gallery is available; it goes to web/dist-visual so the
// production web/dist is never touched.
const port = Number(process.env.PLAYWRIGHT_VISUAL_PORT || 4191);
const baseURL = `http://127.0.0.1:${port}`;
// Optional override for sandboxes that ship their own Chromium build. Baselines
// are only comparable against the same Chromium revision; see the docs.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.spec.ts',
  // One committed PNG per screen/theme/width, suffixed with the project and
  // platform so a Linux baseline is never compared against a macOS render.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/visual' }]] : 'list',
  outputDir: 'test-results/visual',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      // Anti-aliasing noise only; a real layout or colour change moves far
      // more than 1% of the pixels in a viewport-sized capture.
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  use: {
    baseURL,
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'America/Toronto',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Full Chromium (new headless), never the headless shell: the shell
        // renders some faces and the push prompt differently from the build
        // the baselines were made with (docs/visual-baselines.md).
        channel: 'chromium',
        deviceScaleFactor: 1,
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: `cd web && npx vite build --outDir dist-visual --emptyOutDir --logLevel warn && npx vite preview --outDir dist-visual --host 127.0.0.1 --port ${port} --strictPort`,
    env: { VITE_ENABLE_UI_LAB: 'true' },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
