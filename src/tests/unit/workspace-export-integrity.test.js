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
