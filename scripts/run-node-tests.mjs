import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Keeps test children's stdout reserved for the runner's report frames; see
// scripts/test-stdout-guard.mjs.
const stdoutGuard = pathToFileURL(path.join(import.meta.dirname, 'test-stdout-guard.mjs')).href;

function collectTests(target) {
  const absolute = path.resolve(target);
  if (!fs.existsSync(absolute)) throw new Error(`Test path does not exist: ${target}`);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return absolute.endsWith('.test.js') ? [absolute] : [];
  return fs.readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => collectTests(path.join(absolute, entry.name)));
}

const files = process.argv.slice(2).flatMap(collectTests).sort();
if (files.length === 0) {
  console.error('No Node test files found');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ['--import', stdoutGuard, '--test', ...files], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', CI: process.env.CI || '1' },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
