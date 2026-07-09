import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    // SECURITY/FIXTURE: lint config previously only matched `**/*.{ts,tsx}`,
    // which meant the new `.js` route files (ESM, since `package.json`
    // declares `"type": "module"`) were linted with no config block applied.
    // ESLint's default Espree parser then treated every `import` keyword as
    // a CommonJS syntax error — failing `npm run lint` before any test
    // could run, blocking every PR (incl. all 9 dependabot bumps).
    //
    // Match both .ts and .js files with the same config so the project's
    // two surface files share a single rule set.
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
])
