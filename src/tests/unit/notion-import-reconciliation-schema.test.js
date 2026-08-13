import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Notion import records are tenant scoped and unique per project source', async () => {
  const [schema, tenantProxy] = await Promise.all([
    readFile(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8'),
    readFile(new URL('../../utils/prisma-tenant-proxy.js', import.meta.url), 'utf8'),
  ]);
  assert.match(schema, /model NotionImportRecord \{/);
  assert.match(schema, /sourceKey\s+String/);
  assert.match(schema, /contentSha256\s+String/);
  assert.match(schema, /@@unique\(\[projectId, sourceKey\]\)/);
  assert.match(schema, /@@map\("notion_import_records"\)/);
  assert.match(tenantProxy, /'notionimportrecord'/);
});
