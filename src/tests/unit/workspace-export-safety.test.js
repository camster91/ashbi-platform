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
  assert.match(source, /buildWorkspaceExportManifest/);
  assert.match(source, /version: 3/);
  assert.match(source, /bonsaiClientId: true/);
  assert.match(source, /bonsaiProjectId: true/);
  assert.match(source, /prisma\.user\.findMany/);
  assert.match(source, /prisma\.timeEntry\.findMany/);
  assert.match(source, /prisma\.expense\.findMany/);
  const userExport = source.slice(source.indexOf('prisma.user.findMany'), source.indexOf('const payload'));
  assert.doesNotMatch(userExport, /password: true|email: true|role: true/);
  const expenseStart = source.indexOf('prisma.expense.findMany');
  const expenseExport = source.slice(expenseStart, source.indexOf(']);', expenseStart));
  assert.ok(expenseExport.length > 0);
  assert.doesNotMatch(expenseExport, /receiptUrl: true|notes: true/);
  assert.doesNotMatch(source, /prisma\.credential/);
  assert.doesNotMatch(source, /prisma\.message/);
  assert.doesNotMatch(source, /prisma\.invoice/);
});
