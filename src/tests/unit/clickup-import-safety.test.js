import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ClickUp CSV importer remains dry-run-only and preserves evidence', async () => {
  const source = await readFile(new URL('../../../scripts/import-clickup-tasks.js', import.meta.url), 'utf8');
  assert.match(source, /process\.argv\.includes\('--confirm'\)/);
  assert.match(source, /dry-run only/);
  assert.match(source, /flag: 'wx', mode: 0o600/);
  assert.match(source, /buildClickUpTaskImportPlan/);
  assert.doesNotMatch(source, /PrismaClient|\.create\(/);
});
