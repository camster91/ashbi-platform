import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildWorkspaceExportManifest } from '../../services/workspace-export-integrity.service.js';

const reconciliation = await import('../../services/bonsaiOperationsReconciliation.service.js').catch(() => ({}));

function workspaceExport() {
  const records = {
    clients: [{ id: 'client-1', bonsaiClientId: null, name: 'Acme', email: null }],
    contacts: [{ id: 'contact-1', clientId: 'client-1', email: 'owner@acme.ca', isPrimary: true }],
    projects: [{ id: 'project-1', bonsaiProjectId: '123', clientId: 'client-1', name: 'Acme Website', status: 'DESIGN_DEV' }],
    tasks: [], notes: [], milestones: [],
  };
  return {
    format: 'ashbi-workspace-export', version: 2, exportedAt: '2026-08-20T12:00:00.000Z',
    organization: { id: 'org-1', name: 'Ashbi', slug: 'ashbi' }, records,
    manifest: buildWorkspaceExportManifest(records),
  };
}

test('Bonsai operations reconciliation binds exact client and project matches to Hub workspace evidence', () => {
  assert.equal(typeof reconciliation.reconcileBonsaiOperations, 'function');
  const hubEvidence = workspaceExport();
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1',
    completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64),
    bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64),
    bonsaiClientRows: [{ Client: 'Acme', 'Contact Email': 'owner@acme.ca' }],
    bonsaiProjectRows: [{ project_id: '123', title: 'Acme Website', client_or_company_name: 'Acme', status: 'active' }],
    workspaceExport: hubEvidence,
  });

  assert.equal(report.format, 'ashbi-bonsai-operations-reconciliation');
  assert.equal(report.complete, true);
  assert.equal(report.organizationId, 'org-1');
  assert.equal(report.unresolvedFindings, 0);
  assert.deepEqual(report.summary, {
    sourceClients: 1, matchedClients: 1, sourceProjects: 1, hubBonsaiProjects: 1, matchedProjects: 1,
  });
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.sourceEvidence, {
    clientsSha256: 'a'.repeat(64), clientRows: 1,
    projectsSha256: 'b'.repeat(64), projectRows: 1,
  });
  assert.equal(report.workspaceEvidence.artifactSha256, 'c'.repeat(64));
  assert.equal(report.workspaceEvidence.recordsSha256, hubEvidence.manifest.recordsSha256);
  assert.deepEqual(report.workspaceEvidence.collectionCounts, {
    clients: 1, contacts: 1, projects: 1, tasks: 0, notes: 0, milestones: 0,
  });
});

test('Bonsai operations reconciliation reports a source client missing from Hub', () => {
  const evidence = workspaceExport();
  evidence.records.projects = [];
  evidence.manifest = buildWorkspaceExportManifest(evidence.records);
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64),
    bonsaiClientRows: [{ Client: 'Different Client', 'Contact Email': 'owner@example.ca' }],
    bonsaiProjectRows: [], workspaceExport: evidence,
  });

  assert.deepEqual(report.findings, [{
    code: 'BONSAI_CLIENT_MISSING_IN_HUB', clientName: 'Different Client',
  }]);
  assert.equal(report.complete, false);
});

test('Bonsai operations reconciliation preserves project name client and status differences', () => {
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), bonsaiClientRows: [],
    bonsaiProjectRows: [{ project_id: '123', title: 'New Name', client_or_company_name: 'Other Client', status: 'completed' }],
    workspaceExport: workspaceExport(),
  });

  assert.deepEqual(report.findings, [
    { code: 'BONSAI_CLIENT_MISSING_IN_HUB', clientName: 'Other Client' },
    { code: 'PROJECT_NAME_MISMATCH', sourceId: '123', bonsai: 'New Name', hub: 'Acme Website' },
    { code: 'PROJECT_CLIENT_MISMATCH', sourceId: '123', bonsai: 'Other Client', hub: 'Acme' },
    { code: 'PROJECT_STATUS_MISMATCH', sourceId: '123', bonsai: 'LAUNCHED', hub: 'DESIGN_DEV' },
  ]);
  assert.equal(report.summary.matchedProjects, 0);
});

test('Bonsai operations reconciliation reports missing projects on either side', () => {
  const evidence = workspaceExport();
  evidence.records.projects[0].bonsaiProjectId = 'hub-only';
  evidence.manifest = buildWorkspaceExportManifest(evidence.records);
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), bonsaiClientRows: [],
    bonsaiProjectRows: [{ project_id: 'source-only', title: 'Source Project', client_or_company_name: 'Acme', status: 'active' }],
    workspaceExport: evidence,
  });

  assert.deepEqual(report.findings, [
    { code: 'BONSAI_PROJECT_MISSING_IN_HUB', sourceId: 'source-only', projectName: 'Source Project' },
    { code: 'HUB_BONSAI_PROJECT_MISSING_IN_SOURCE', sourceId: 'hub-only', projectName: 'Acme Website', hubProjectId: 'project-1' },
  ]);
});

test('Bonsai operations reconciliation refuses duplicate project identities', () => {
  const evidence = workspaceExport();
  evidence.records.projects.push({
    id: 'project-2', bonsaiProjectId: '123', clientId: 'client-1', name: 'Duplicate', status: 'DESIGN_DEV',
  });
  evidence.manifest = buildWorkspaceExportManifest(evidence.records);
  const sourceRow = { project_id: '123', title: 'Acme Website', client_or_company_name: 'Acme', status: 'active' };
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), bonsaiClientRows: [],
    bonsaiProjectRows: [sourceRow, { ...sourceRow }], workspaceExport: evidence,
  });

  assert.deepEqual(report.findings, [
    { code: 'DUPLICATE_BONSAI_PROJECT_ID', sourceId: '123', rows: 2 },
    { code: 'DUPLICATE_HUB_BONSAI_PROJECT_ID', sourceId: '123', hubProjectIds: ['project-1', 'project-2'] },
  ]);
});

test('Bonsai operations reconciliation preserves a client contact email difference', () => {
  const evidence = workspaceExport();
  evidence.records.projects = [];
  evidence.manifest = buildWorkspaceExportManifest(evidence.records);
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), bonsaiProjectRows: [],
    bonsaiClientRows: [{ Client: 'Acme', 'Contact Email': 'different@acme.ca' }], workspaceExport: evidence,
  });

  assert.deepEqual(report.findings, [{
    code: 'CLIENT_EMAIL_MISMATCH', clientName: 'Acme', bonsai: 'different@acme.ca', hub: 'owner@acme.ca',
  }]);
});

test('Bonsai operations reconciliation excludes the importer test and internal client scope', () => {
  const evidence = workspaceExport();
  evidence.records.projects = [];
  evidence.manifest = buildWorkspaceExportManifest(evidence.records);
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), workspaceExport: evidence,
    bonsaiClientRows: [{ Client: 'Ashbi Design' }, { Client: 'Test Client' }],
    bonsaiProjectRows: [{ project_id: 'internal', title: 'Internal', client_or_company_name: 'Ashbi Design', status: 'active' }],
  });

  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.summary, {
    sourceClients: 0, matchedClients: 0, sourceProjects: 0, hubBonsaiProjects: 0, matchedProjects: 0,
  });
  assert.deepEqual(report.sourceEvidence, {
    clientsSha256: 'a'.repeat(64), clientRows: 2,
    projectsSha256: 'b'.repeat(64), projectRows: 1,
  });
});

test('Bonsai operations reconciliation keeps unsupported project source evidence unresolved', () => {
  const evidence = workspaceExport();
  evidence.records.projects = [];
  evidence.manifest = buildWorkspaceExportManifest(evidence.records);
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), bonsaiClientRows: [], workspaceExport: evidence,
    bonsaiProjectRows: [{ project_id: '', title: 'Project', client_or_company_name: 'Acme', status: 'mystery' }],
  });

  assert.deepEqual(report.findings, [{
    code: 'BONSAI_PROJECT_SOURCE_INVALID', sourceId: '', projectName: 'Project', fields: ['project_id', 'status'],
  }]);
});

test('Bonsai operations reconciliation refuses duplicate client identities', () => {
  const evidence = workspaceExport();
  evidence.records.projects = [];
  evidence.records.clients.push({ id: 'client-2', bonsaiClientId: null, name: 'ACME', email: null });
  evidence.manifest = buildWorkspaceExportManifest(evidence.records);
  const sourceRow = { Client: 'Acme', 'Contact Email': 'owner@acme.ca' };
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), bonsaiClientRows: [sourceRow, { ...sourceRow }],
    bonsaiProjectRows: [], workspaceExport: evidence,
  });

  assert.deepEqual(report.findings, [
    { code: 'DUPLICATE_BONSAI_CLIENT_IDENTITY', clientName: 'Acme', rows: 2 },
    { code: 'DUPLICATE_HUB_CLIENT_IDENTITY', clientName: 'acme', hubClientIds: ['client-1', 'client-2'] },
  ]);
});

test('Bonsai operations reconciliation includes clients found only in the project source', () => {
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), bonsaiClientRows: [],
    bonsaiProjectRows: [{ project_id: '123', title: 'Acme Website', client_or_company_name: 'Acme', status: 'active' }],
    workspaceExport: workspaceExport(),
  });

  assert.equal(report.summary.sourceClients, 1);
  assert.equal(report.summary.matchedClients, 1);
  assert.deepEqual(report.findings, []);
});

test('Bonsai operations reconciliation matches a source email to any Hub client contact', () => {
  const evidence = workspaceExport();
  evidence.records.projects = [];
  evidence.records.contacts[0].isPrimary = false;
  evidence.manifest = buildWorkspaceExportManifest(evidence.records);
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), bonsaiProjectRows: [],
    bonsaiClientRows: [{ Client: 'Acme', 'Contact Email': 'owner@acme.ca' }], workspaceExport: evidence,
  });

  assert.equal(report.summary.matchedClients, 1);
  assert.deepEqual(report.findings, []);
});

test('Bonsai operations reconciliation CLI creates a source-bound owner evidence report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-bonsai-operations-'));
  try {
    const clientsPath = path.join(directory, 'clients.csv');
    const projectsPath = path.join(directory, 'projects.csv');
    const workspacePath = path.join(directory, 'workspace.json');
    const outputPath = path.join(directory, 'operations.json');
    fs.writeFileSync(clientsPath, 'Client,Contact Email\nAcme,owner@acme.ca\n');
    fs.writeFileSync(projectsPath, 'project_id,title,client_or_company_name,status\n123,Acme Website,Acme,active\n');
    fs.writeFileSync(workspacePath, JSON.stringify(workspaceExport()));

    const result = spawnSync(process.execPath, [
      'scripts/reconcile-bonsai-operations.js',
      '--organization-id', 'org-1', '--bonsai-clients', clientsPath,
      '--bonsai-projects', projectsPath, '--workspace-export', workspacePath,
      '--completed-at', '2026-08-20T13:00:00.000Z', '--output', outputPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(report.complete, true);
    assert.equal(report.summary.matchedClients, 1);
    assert.equal(report.summary.matchedProjects, 1);
    assert.match(result.stdout, /Reconciliation passed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Bonsai operations reconciliation binds every version 3 workspace collection', () => {
  const evidence = workspaceExport();
  evidence.version = 3;
  evidence.records.users = [];
  evidence.records.timeEntries = [];
  evidence.records.expenses = [];
  evidence.manifest = buildWorkspaceExportManifest(evidence.records, { version: 3 });
  const report = reconciliation.reconcileBonsaiOperations({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), bonsaiClientRows: [{ Client: 'Acme' }],
    bonsaiProjectRows: [{ project_id: '123', title: 'Acme Website', client_or_company_name: 'Acme', status: 'active' }],
    workspaceExport: evidence,
  });

  assert.deepEqual(Object.keys(report.workspaceEvidence.collectionCounts), [
    'clients', 'contacts', 'projects', 'tasks', 'notes', 'milestones', 'users', 'timeEntries', 'expenses',
  ]);
});
