import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KB = 1024;
export const BUDGETS = Object.freeze({
  entryJs: 120 * KB,
  initialJs: 480 * KB,
  entryCss: 95 * KB,
  anyJsChunk: 200 * KB,
  publicRouteChunk: 60 * KB,
});

export const PUBLIC_ROUTES = Object.freeze([
  'Login', 'ForgotPassword', 'ResetPassword', 'Portal', 'PortalProposal',
  'PortalContract', 'PortalInvoice', 'PortalBooking', 'PortalIntakeForm',
  'PortalEstimate', 'ClientPortal',
]);

function bytes(dist, file) {
  return fs.statSync(path.join(dist, file)).size;
}

function collectStaticImports(manifest, key, seen = new Set()) {
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const dependency of manifest[key]?.imports ?? []) collectStaticImports(manifest, dependency, seen);
  return seen;
}

export function validateFrontendBudgets(dist) {
  const manifestPath = path.join(dist, '.vite', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return ['Vite manifest is missing; run the production build first'];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entryPair = Object.entries(manifest).find(([, value]) => value.isEntry);
  if (!entryPair) return ['Vite manifest has no application entry'];
  const [entryKey, entry] = entryPair;
  const failures = [];
  const check = (actual, limit, label) => {
    if (actual > limit) failures.push(`${label} is ${(actual / KB).toFixed(2)} KB; budget is ${(limit / KB).toFixed(2)} KB`);
  };

  check(bytes(dist, entry.file), BUDGETS.entryJs, 'entry JavaScript');
  const initialKeys = collectStaticImports(manifest, entryKey);
  const initialBytes = [...initialKeys]
    .map((key) => manifest[key]?.file)
    .filter((file) => file?.endsWith('.js'))
    .reduce((total, file) => total + bytes(dist, file), 0);
  check(initialBytes, BUDGETS.initialJs, 'initial JavaScript graph');
  for (const file of entry.css ?? []) check(bytes(dist, file), BUDGETS.entryCss, `entry CSS ${file}`);

  for (const value of Object.values(manifest)) {
    if (value.file?.endsWith('.js')) check(bytes(dist, value.file), BUDGETS.anyJsChunk, `JavaScript chunk ${value.file}`);
  }

  const dynamicImports = new Set(entry.dynamicImports ?? []);
  for (const route of PUBLIC_ROUTES) {
    const key = `src/pages/${route}.jsx`;
    if (!dynamicImports.has(key) || !manifest[key]) {
      failures.push(`${route} is not an independent dynamic public-route chunk`);
      continue;
    }
    check(bytes(dist, manifest[key].file), BUDGETS.publicRouteChunk, `${route} route chunk`);
  }
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const distFlag = process.argv.indexOf('--dist');
  const dist = path.resolve(distFlag >= 0 ? process.argv[distFlag + 1] : 'web/dist');
  const failures = validateFrontendBudgets(dist);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Frontend performance budgets: PASS');
  }
}
