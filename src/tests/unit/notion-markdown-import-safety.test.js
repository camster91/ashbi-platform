import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Notion Markdown importer is tenant-scoped and dry-run-first', async () => {
  const source = await readFile(new URL('../../../scripts/import-notion-markdown.js', import.meta.url), 'utf8');
  assert.match(source, /const dryRun = !process\.argv\.includes\('--confirm'\)/);
  assert.match(source, /where: \{ id: projectId, organizationId \}/);
  assert.match(source, /where: \{ organizationId \}/);
  assert.match(source, /if \(dryRun\) \{\s+await processPayloads\(prisma, false\)/);
  assert.match(source, /prisma\.\$transaction/);
  assert.match(source, /Live import cannot complete with unresolved reconciliation findings/);
  assert.match(source, /flag: 'wx', mode: 0o600/);
  assert.match(source, /type: 'DOC'/);
  assert.match(source, /buildNotionMarkdownImportPlan/);
  assert.match(source, /notionImportRecord/);
  assert.match(source, /createHash\('sha256'\)/);
});
