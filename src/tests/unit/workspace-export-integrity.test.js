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

test('workspace export manifest verifies after dates and JSON values are serialized', () => {
  const datedRecords = {
    ...records,
    clients: [{ ...records.clients[0], createdAt: new Date('2026-10-14T12:34:56.789Z'), ignored: undefined }],
    projects: [{ ...records.projects[0], budget: { toJSON: () => '123.45' }, completedAt: null }],
    tasks: [{ ...records.tasks[0], properties: { nested: [new Date('2026-10-14T00:00:00.000Z'), undefined] } }],
  };
  const payload = JSON.parse(JSON.stringify({
    format: 'ashbi-workspace-export', version: 2,
    records: datedRecords, manifest: buildWorkspaceExportManifest(datedRecords),
  }));

  assert.deepEqual(buildWorkspaceExportManifest(datedRecords), buildWorkspaceExportManifest(payload.records));
  assert.equal(verifyWorkspaceExport(payload).valid, true);
  payload.records.clients[0].createdAt = '2026-10-15T12:34:56.789Z';
  assert.deepEqual(verifyWorkspaceExport(payload).findings, [{ code: 'MANIFEST_MISMATCH', collection: 'clients' }]);
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
