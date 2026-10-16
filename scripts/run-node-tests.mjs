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
  if (stat.isFile()) return absolute.endsWith('.test.js') || absolute.endsWith('.test.mjs') ? [absolute] : [];
  return fs.readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => collectTests(path.join(absolute, entry.name)));
}

export function testArguments(files, cwd = process.cwd()) {
  const targets = files.map(file => path.relative(cwd, file));
  // Integration files share the same disposable PostgreSQL database. Even
  // disjoint UUID rows can conflict through Serializable predicate locks.
  // File scheduling does not change concurrency explicitly tested inside a file.
  const integrationRoot = path.resolve(import.meta.dirname, '..', 'src', 'tests', 'integration');
  const sharedDatabase = files.some(file => {
    const relative = path.relative(integrationRoot, path.resolve(file));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
  return ['--import', stdoutGuard, '--test', ...(sharedDatabase ? ['--test-concurrency=1'] : []), ...targets];
}

function main() {
  const files = process.argv.slice(2).flatMap(collectTests).sort();
  if (files.length === 0) {
    console.error('No Node test files found');
    process.exitCode = 1;
  } else {
    // Relative paths keep the Windows command line below its length limit as the
    // suite grows, without splitting tests into separate runs or changing coverage.
    const result = spawnSync(process.execPath, testArguments(files), {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test', CI: process.env.CI || '1' },
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
