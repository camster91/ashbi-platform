import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('workspace export is tenant-scoped, explicit, and excludes secret-bearing models', async () => {
  const source = await readFile(new URL('../../../scripts/export-workspace.js', import.meta.url), 'utf8');
  assert.match(source, /--organization-id/);
  assert.match(source, /--confirm/);
  assert.match(source, /flag: 'wx'/);
  assert.match(source, /mode: 0o600/);
  assert.match(source, /organizationId/);
  assert.match(source, /sha256/);
  assert.doesNotMatch(source, /prisma\.credential/);
  assert.doesNotMatch(source, /prisma\.message/);
  assert.doesNotMatch(source, /prisma\.invoice/);
});
