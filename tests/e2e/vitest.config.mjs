// tests/e2e/vitest.config.mjs
//
// Vitest config for the magic-login end-to-end smoke. Single worker
// because the 14 steps mutate shared Postgres + wp-env state.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.mjs'],
    // 14 steps share state (wp_sites row, JWT, magic-login token,
    // active transient). Parallel workers would race on the same rows.
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