import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotionMarkdownImportPlan } from '../../services/notion-markdown-import.service.js';

test('plans parent pages before children and preserves a stable source key', () => {
  const plan = buildNotionMarkdownImportPlan([
    'Client Brief abcdefabcdefabcdefabcdefabcdefab/Discovery Notes 12345678901234567890123456789012.md',
    'Client Brief abcdefabcdefabcdefabcdefabcdefab.md',
    'About 12345678901234567890123456789012.md',
  ]);

  assert.deepEqual(plan, [
    {
      relativePath: 'About 12345678901234567890123456789012.md',
      sourceKey: 'notion-markdown:About 12345678901234567890123456789012.md',
      parentSourceKey: null,
    },
    {
      relativePath: 'Client Brief abcdefabcdefabcdefabcdefabcdefab.md',
      sourceKey: 'notion-markdown:Client Brief abcdefabcdefabcdefabcdefabcdefab.md',
      parentSourceKey: null,
    },
    {
      relativePath: 'Client Brief abcdefabcdefabcdefabcdefabcdefab/Discovery Notes 12345678901234567890123456789012.md',
      sourceKey: 'notion-markdown:Client Brief abcdefabcdefabcdefabcdefabcdefab/Discovery Notes 12345678901234567890123456789012.md',
      parentSourceKey: 'notion-markdown:Client Brief abcdefabcdefabcdefabcdefabcdefab.md',
    },
  ]);
});

test('rejects paths outside the export root', () => {
  assert.throws(() => buildNotionMarkdownImportPlan(['../outside.md']), /relative export path/);
});
