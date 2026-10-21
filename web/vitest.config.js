import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Two projects (docs/frontend-tests.md):
// - contracts: tests that only read source files or call plain modules. They
//   run in Node with shared module state, which skips a jsdom start per file.
// - dom: everything that renders or touches browser APIs, in jsdom on
//   vmThreads (one worker VM context per file instead of a fresh process).
// - dom-forks: the few tests that replace browser objects jsdom keeps
//   unforgeable under vmThreads (window.location, performance methods), or
//   navigate a BrowserRouter. They keep the default forks pool.
const FORKS_TESTS = [
  'src/tests/BreakGlass.test.jsx',
  'src/tests/ClientInvite.test.jsx',
  'src/tests/ErrorBoundary.test.jsx',
  'src/tests/WorkspaceConnectionGuide.test.jsx',
  'src/tests/api-impersonation-ended.test.js',
  'src/tests/after-first-paint.test.js',
  'src/tests/useAuth.test.jsx',
];
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    css: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'contracts',
          environment: 'node',
          isolate: false,
          include: ['src/tests/contracts/**/*.test.{js,jsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          pool: 'vmThreads',
          vmMemoryLimit: '512MB',
          setupFiles: ['./src/tests/setup.js'],
          include: ['src/tests/**/*.{test,spec}.{js,jsx}'],
          exclude: ['src/tests/contracts/**', ...FORKS_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom-forks',
          environment: 'jsdom',
          setupFiles: ['./src/tests/setup.js'],
          include: FORKS_TESTS,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@shared': path.resolve(import.meta.dirname, '../src/shared'),
    },
  },
});
