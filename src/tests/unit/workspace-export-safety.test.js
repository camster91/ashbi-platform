import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('workspace export CLI is tenant-scoped, explicit, and never writes over existing output', async () => {
  const source = await readFile(new URL('../../../scripts/export-workspace.js', import.meta.url), 'utf8');
  assert.match(source, /--organization-id/);
  assert.match(source, /--output-dir/);
  // Legacy single-file mode keeps its explicit confirmation and write flags.
  assert.match(source, /--confirm/);
  assert.match(source, /flag: 'wx'/);
  assert.match(source, /mode: 0o600/);
  assert.match(source, /organizationId/);
  assert.match(source, /sha256/);
  assert.match(source, /buildWorkspaceExportManifest/);
  assert.match(source, /version: 2/);
  // It uses a raw client with explicit filters, never the capped soft-delete wrapper.
  assert.doesNotMatch(source, /src\/config\/db\.js/);
  assert.doesNotMatch(source, /prisma\.credential/);
  assert.doesNotMatch(source, /prisma\.apiKey/);
});

test('directory export writes new files only, owner-readable, and never reads secret-bearing models', async () => {
  const source = await readFile(new URL('../../services/workspace-export.service.js', import.meta.url), 'utf8');
  assert.match(source, /flags: 'wx', mode: FILE_MODE/);
  assert.match(source, /flag: 'wx', mode: FILE_MODE/);
  assert.match(source, /const FILE_MODE = 0o600/);
  assert.match(source, /Refusing to write into non-empty directory/);
  for (const delegate of ['credential', 'apiKey', 'integration', 'aiProviderConnection', 'googleCalendarConnection', 'slackInstallation', 'breakGlassGrant']) {
    assert.doesNotMatch(source, new RegExp(`prisma\\.${delegate}\\b`));
  }
});
