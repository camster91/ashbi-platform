// tests/e2e/vitest.config.mjs
//
// Vitest config for the full-stack smoke. Single worker because the
// steps share one seeded database and admin session.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.mjs'],
    fileParallelism: false,
    pool: 'forks',
    isolate: false,
    sequence: { shuffle: false },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    reporters: process.env.CI
      ? ['default', ['github-actions', { silent: false }]]
      : ['verbose'],
    outputFile: process.env.CI ? undefined : './tests/e2e/.vitest-output.json'
  }
});