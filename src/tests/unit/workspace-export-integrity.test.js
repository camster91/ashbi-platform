import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceExportManifest, verifyWorkspaceExport } from '../../services/workspace-export-integrity.service.js';

const records = {
  clients: [{ id: 'client-1', name: 'Acme' }],
  contacts: [{ id: 'contact-1', clientId: 'client-1' }],
  projects: [{ id: 'project-1', clientId: 'client-1' }],
  tasks: [{ id: 'task-1', projectId: 'project-1', parentId: null }],
  notes: [{ id: 'note-1', projectId: 'project-1', parentId: null }],
  milestones: [{ id: 'milestone-1', projectId: 'project-1' }],
};

test('workspace export manifest is stable when record object keys are reordered', () => {
  const reordered = {
    ...records,
    clients: [{ name: 'Acme', id: 'client-1' }],
  };

  assert.deepEqual(buildWorkspaceExportManifest(records), buildWorkspaceExportManifest(reordered));
});

test('workspace export verification rejects an invalid project client reference', () => {
  const manifest = buildWorkspaceExportManifest(records);
  const result = verifyWorkspaceExport({
    format: 'ashbi-workspace-export', version: 2, records: {
      ...records,
      projects: [{ id: 'project-1', clientId: 'missing-client' }],
    }, manifest,
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    { code: 'MANIFEST_MISMATCH', collection: 'projects' },
    { code: 'PROJECT_CLIENT_MISSING', id: 'project-1', clientId: 'missing-client' },
  ]);
});

test('workspace export verification rejects duplicate record identifiers', () => {
  const duplicateRecords = {
    ...records,
    projects: [
      { id: 'project-1', clientId: 'client-1' },
      { id: 'project-1', clientId: 'client-1' },
    ],
  };
  const result = verifyWorkspaceExport({
    format: 'ashbi-workspace-export', version: 2, records: duplicateRecords,
    manifest: buildWorkspaceExportManifest(duplicateRecords),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [{ code: 'DUPLICATE_RECORD_ID', collection: 'projects', id: 'project-1' }]);
});

test('workspace export version 3 verifies bounded staff time and expense relationships', () => {
  const version3Records = {
    ...records,
    users: [{ id: 'user-1', name: 'Cameron' }],
    timeEntries: [{ id: 'time-1', projectId: 'project-1', userId: 'user-1', taskId: 'task-1' }],
    expenses: [{ id: 'expense-1', organizationId: 'org-1', clientId: 'client-1', projectId: 'project-1' }],
  };
  const payload = {
    format: 'ashbi-workspace-export', version: 3, organization: { id: 'org-1' }, records: version3Records,
    manifest: buildWorkspaceExportManifest(version3Records, { version: 3 }),
  };

  const result = verifyWorkspaceExport(payload);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.collections.users.count, 1);
  assert.equal(result.manifest.collections.timeEntries.count, 1);
  assert.equal(result.manifest.collections.expenses.count, 1);
});

test('workspace export version 3 rejects cross-project time and expense relationships', () => {
  const version3Records = {
    ...records,
    clients: [...records.clients, { id: 'client-2', name: 'Other' }],
    projects: [...records.projects, { id: 'project-2', clientId: 'client-2' }],
    tasks: [...records.tasks, { id: 'task-2', projectId: 'project-2', parentId: null }],
    users: [{ id: 'user-1', name: 'Cameron' }],
    timeEntries: [{ id: 'time-1', projectId: 'project-1', userId: 'user-1', taskId: 'task-2' }],
    expenses: [{ id: 'expense-1', organizationId: 'org-1', clientId: 'client-1', projectId: 'project-2' }],
  };
  const result = verifyWorkspaceExport({
    format: 'ashbi-workspace-export', version: 3, organization: { id: 'org-1' }, records: version3Records,
    manifest: buildWorkspaceExportManifest(version3Records, { version: 3 }),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    { code: 'TIME_ENTRY_TASK_PROJECT_MISMATCH', id: 'time-1', taskId: 'task-2', projectId: 'project-1' },
    { code: 'EXPENSE_PROJECT_CLIENT_MISMATCH', id: 'expense-1', projectId: 'project-2', clientId: 'client-1' },
  ]);
});
