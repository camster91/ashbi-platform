import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fullImporter = new URL('../../../scripts/import-bonsai-full.js', import.meta.url);
const legacyImporter = new URL('../../../scripts/import-bonsai.js', import.meta.url);

test('Bonsai full importer requires an explicit tenant and scopes imported records', async () => {
  const source = await readFile(fullImporter, 'utf8');
  assert.match(source, /--organization-id/);
  assert.match(source, /IMPORT_ORGANIZATION_ID/);
  assert.match(source, /organizationId: ORGANIZATION_ID/);
  assert.match(source, /Organization not found/);
  assert.doesNotMatch(source, /password:\s*'imported-no-login'/);
  assert.match(source, /mappedToImporter/);
});

test('legacy Bonsai importer fails closed instead of writing unscoped records', async () => {
  const source = await readFile(legacyImporter, 'utf8');
  assert.match(source, /legacy importer is disabled/);
  assert.match(source, /process\.exitCode = 2/);
  assert.match(source, /import-bonsai-full\.js/);
});
