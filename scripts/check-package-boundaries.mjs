import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const web = JSON.parse(await readFile(new URL('../web/package.json', import.meta.url), 'utf8'));
const rootPackages = new Set([
  ...Object.keys(root.dependencies || {}),
  ...Object.keys(root.devDependencies || {}),
]);
const webPackages = new Set([
  ...Object.keys(web.dependencies || {}),
  ...Object.keys(web.devDependencies || {}),
]);

const frontendOwned = [
  'react', 'react-dom', 'react-router-dom', '@sentry/react', '@tanstack/react-query',
  '@vitejs/plugin-react', 'vite', 'tailwindcss', 'postcss', 'autoprefixer',
  'tailwindcss-animate', 'lucide-react', 'dompurify', 'clsx', 'tailwind-merge',
];

const misplaced = frontendOwned.filter((name) => rootPackages.has(name));
const missing = frontendOwned.filter((name) => !webPackages.has(name));
const obsoleteRootConfigs = ['../vite.config.js', '../postcss.config.js', '../tailwind.config.js'];
const existingRootConfigs = [];

for (const relative of obsoleteRootConfigs) {
  try {
    await access(new URL(relative, import.meta.url), constants.F_OK);
    existingRootConfigs.push(relative.replace('../', ''));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const errors = [
  ...misplaced.map((name) => `${name} must be owned only by web/package.json`),
  ...missing.map((name) => `${name} is missing from web/package.json`),
  ...existingRootConfigs.map((name) => `${name} conflicts with the authoritative web configuration`),
];

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('Package boundary: PASS (backend root and frontend web ownership are unambiguous)');
