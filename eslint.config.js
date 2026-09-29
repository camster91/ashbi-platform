import js from '@eslint/js'
import globals from 'globals'
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
    ],
    languageOptions: {
      sourceType: 'module',
      // The backend (`src/`) runs on Node.js, not in a browser. Declaring the
      // Node globals lets `no-undef` catch identifiers that were never
      // imported or passed in (e.g. a missing `PDFDocument` import or
      // `request` handler parameter), which otherwise only surface as a
      // ReferenceError at request time.
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      // Ratchet: unused variables are warnings so the existing backlog stays
      // visible without blocking CI. Prefix intentionally unused names with
      // `_` to silence them. Do not raise the warning count.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        args: 'none',
        caughtErrors: 'none',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      'no-empty': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
