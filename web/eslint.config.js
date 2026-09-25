// ESLint flat config for ashbi-platform/web.
//
// The app is JavaScript/JSX. The previous config only matched .ts/.tsx files
// (there are none) and used a top-level `parserOptions` key flat config does
// not accept, so `eslint . --ext js` linted .js files with no rules and never
// parsed .jsx at all. This config parses every source file and enforces the
// React hooks rules plus no-undef, which catch real runtime bugs (no-undef
// found a Schedule sidebar that referenced another component's variables and
// crashed the page); stylistic rules stay off.

import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['dist', 'node_modules', 'dev-dist', 'coverage', 'public'],
  },
  {
    files: ['**/*.{js,jsx,mjs}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
