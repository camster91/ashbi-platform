import test from 'node:test';
import assert from 'node:assert/strict';
import { assertApprovedNotionDryRun, buildNotionMarkdownImportPlan, fingerprintNotionExport, fingerprintNotionPlan } from '../../services/notion-markdown-import.service.js';

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

test('fingerprints exact Notion export bytes independent of inventory order', () => {
  const files = [
    { relativePath: 'B.md', bytes: 2, sha256: 'bbb' },
    { relativePath: 'A.md', bytes: 1, sha256: 'aaa' },
  ];
  const first = fingerprintNotionExport(files);
  assert.equal(first, fingerprintNotionExport([...files].reverse()));
  assert.notEqual(first, fingerprintNotionExport([{ ...files[0], sha256: 'changed' }, files[1]]));
});

test('confirmed Notion import requires exact approved source, plan, tenant, and project', () => {
  const report = {
    format: 'ashbi-notion-markdown-import-report', mode: 'dry-run', complete: true,
    organization: { id: 'org-a' }, project: { id: 'project-a' },
    notes: { planned: 1, created: 0, unchanged: 0, conflicts: 0, skipped: 0 },
    hierarchy: { planned: [], unresolved: [] }, records: { existing: 0 }, errors: [],
  };
  const sourceFingerprint = 'source';
  const planFingerprint = fingerprintNotionPlan({ sourceFingerprint, report });
  const approved = { ...report, sourceFingerprint, planFingerprint };
  const current = { organizationId: 'org-a', projectId: 'project-a', sourceFingerprint, planFingerprint };
  assert.equal(assertApprovedNotionDryRun(approved, current), true);
  assert.throws(() => assertApprovedNotionDryRun(approved, { ...current, projectId: 'other' }), /destination/i);
  assert.throws(() => assertApprovedNotionDryRun(approved, { ...current, sourceFingerprint: 'changed' }), /export changed/i);
  assert.throws(() => assertApprovedNotionDryRun(approved, { ...current, planFingerprint: 'changed' }), /plan changed/i);
});
