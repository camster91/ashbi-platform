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

function operatingWorkspaceExport() {
  const evidence = workspaceExport();
  evidence.version = 3;
  evidence.records.users = [{ id: 'user-1', name: 'Cameron Ashley' }];
  evidence.records.timeEntries = [{
    id: 'time-1', projectId: 'project-1', userId: 'user-1', taskId: null,
    description: 'Build', duration: 60, date: '2026-08-01T00:00:00.000Z',
    billable: true, hourlyRate: '100', source: 'BONSAI_IMPORT', invoiced: false,
  }];
  evidence.records.expenses = [{
    id: 'expense-1', organizationId: 'org-1', clientId: 'client-1', projectId: 'project-1',
    description: 'Figma', amount: '20', currency: 'CAD', category: 'SOFTWARE',
    date: '2026-08-02T00:00:00.000Z', billable: false, invoiced: false,
  }];
  evidence.manifest = buildWorkspaceExportManifest(evidence.records, { version: 3 });
  return evidence;
}

function operatingSourceInput(workspace = operatingWorkspaceExport()) {
  return {
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiClientsSha256: 'a'.repeat(64), bonsaiProjectsSha256: 'b'.repeat(64),
    bonsaiTimeEntriesSha256: 'd'.repeat(64), bonsaiExpensesSha256: 'e'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64),
    bonsaiClientRows: [{ Client: 'Acme', 'Contact Email': 'owner@acme.ca' }],
    bonsaiProjectRows: [{ project_id: '123', title: 'Acme Website', client_or_company_name: 'Acme', status: 'active' }],
    bonsaiTimeEntryRows: [{
      client_name: 'Acme', project_title: 'Acme Website', owner_name: 'Cameron',
      date: '2026-08-01T00:00:00.000Z', formatted_time: '01:00:00', rate: '100',
      billing_status: 'billed', notes: 'Build',
    }],
    bonsaiExpenseRows: [{
      name: 'Figma', amount_after_tax: '20.00', currency: 'CAD', tags: 'software',
      date: '2026-08-02T00:00:00.000Z', billable: 'false', client: 'Acme', project: 'Acme Website',
    }],
    workspaceExport: workspace,
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
    bonsaiTimeEntriesSha256: 'd'.repeat(64), bonsaiExpensesSha256: 'e'.repeat(64),
    workspaceArtifactSha256: 'c'.repeat(64), bonsaiClientRows: [{ Client: 'Acme' }],
    bonsaiProjectRows: [{ project_id: '123', title: 'Acme Website', client_or_company_name: 'Acme', status: 'active' }],
    bonsaiTimeEntryRows: [], bonsaiExpenseRows: [],
    workspaceExport: evidence,
  });

  assert.deepEqual(Object.keys(report.workspaceEvidence.collectionCounts), [
    'clients', 'contacts', 'projects', 'tasks', 'notes', 'milestones', 'users', 'timeEntries', 'expenses',
  ]);
});

test('Bonsai operations reconciliation matches version 3 time and expense source evidence', () => {
  const report = reconciliation.reconcileBonsaiOperations(operatingSourceInput());

  assert.equal(report.version, 2);
  assert.equal(report.complete, true);
  assert.deepEqual(report.findings, []);
  assert.equal(report.summary.sourceTimeEntries, 1);
  assert.equal(report.summary.matchedTimeEntries, 1);
  assert.equal(report.summary.sourceExpenses, 1);
  assert.equal(report.summary.matchedExpenses, 1);
  assert.equal(report.sourceEvidence.timeEntriesSha256, 'd'.repeat(64));
  assert.equal(report.sourceEvidence.timeEntryRows, 1);
  assert.equal(report.sourceEvidence.expensesSha256, 'e'.repeat(64));
  assert.equal(report.sourceEvidence.expenseRows, 1);
});

test('Bonsai operations reconciliation reports a time field difference without claiming its source is missing', () => {
  const workspace = operatingWorkspaceExport();
  workspace.records.timeEntries[0].description = 'Different description';
  workspace.manifest = buildWorkspaceExportManifest(workspace.records, { version: 3 });

  const report = reconciliation.reconcileBonsaiOperations(operatingSourceInput(workspace));

  assert.deepEqual(report.findings, [{
    code: 'TIME_ENTRY_FIELD_MISMATCH', hubTimeEntryId: 'time-1', fields: ['description'],
  }]);
});

test('Bonsai operations reconciliation rejects a malformed expense amount instead of guessing', () => {
  const input = operatingSourceInput();
  input.bonsaiExpenseRows[0].amount_after_tax = '1,2,3.00';

  const report = reconciliation.reconcileBonsaiOperations(input);

  assert.deepEqual(report.findings, [{
    code: 'BONSAI_EXPENSE_SOURCE_INVALID', description: 'Figma', fields: ['amount'],
  }]);
});

test('Bonsai operations reconciliation rejects a malformed time-entry rate instead of guessing', () => {
  const input = operatingSourceInput();
  input.bonsaiTimeEntryRows[0].rate = '1,2,3.00';

  const report = reconciliation.reconcileBonsaiOperations(input);

  assert.deepEqual(report.findings, [{
    code: 'BONSAI_TIME_ENTRY_SOURCE_INVALID', projectName: 'Acme Website', ownerName: 'Cameron', fields: ['rate'],
  }, {
    code: 'HUB_BONSAI_TIME_ENTRY_MISSING_IN_SOURCE', hubTimeEntryId: 'time-1',
  }]);
});

test('Bonsai operations reconciliation preserves explicit expense exclusions and permits native Hub ledger rows', () => {
  const input = operatingSourceInput();
  input.bonsaiExpenseRows.push({
    name: 'Personal purchase', amount_after_tax: '10.00', currency: 'CAD', tags: 'personal',
    date: '2026-08-03T00:00:00.000Z', billable: 'false', client: '', project: '',
  });
  input.workspaceExport.records.expenses.push({
    id: 'expense-native', organizationId: 'org-1', clientId: null, projectId: null,
    description: 'Hub-native expense', amount: '5', currency: 'CAD', category: 'OTHER',
    date: '2026-08-04T00:00:00.000Z', billable: false, invoiced: false,
  });
  input.workspaceExport.manifest = buildWorkspaceExportManifest(input.workspaceExport.records, { version: 3 });

  const report = reconciliation.reconcileBonsaiOperations(input);

  assert.equal(report.complete, true);
  assert.equal(report.summary.sourceExpenses, 1);
  assert.equal(report.sourceEvidence.expenseRows, 2);
});

test('Bonsai operations reconciliation CLI binds version 3 time and expense files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-bonsai-ledger-'));
  try {
    const clientsPath = path.join(directory, 'clients.csv');
    const projectsPath = path.join(directory, 'projects.csv');
    const timeEntriesPath = path.join(directory, 'time-entries.csv');
    const expensesPath = path.join(directory, 'expenses.csv');
    const workspacePath = path.join(directory, 'workspace.json');
    const outputPath = path.join(directory, 'operations.json');
    fs.writeFileSync(clientsPath, 'Client,Contact Email\nAcme,owner@acme.ca\n');
    fs.writeFileSync(projectsPath, 'project_id,title,client_or_company_name,status\n123,Acme Website,Acme,active\n');
    fs.writeFileSync(timeEntriesPath, 'client_name,project_title,owner_name,date,formatted_time,rate,billing_status,notes\nAcme,Acme Website,Cameron,2026-08-01T00:00:00.000Z,01:00:00,100,billed,Build\n');
    fs.writeFileSync(expensesPath, 'name,amount_after_tax,currency,tags,date,billable,client,project\nFigma,20.00,CAD,software,2026-08-02T00:00:00.000Z,false,Acme,Acme Website\n');
    fs.writeFileSync(workspacePath, JSON.stringify(operatingWorkspaceExport()));

    const result = spawnSync(process.execPath, [
      'scripts/reconcile-bonsai-operations.js',
      '--organization-id', 'org-1', '--bonsai-clients', clientsPath,
      '--bonsai-projects', projectsPath, '--bonsai-time-entries', timeEntriesPath,
      '--bonsai-expenses', expensesPath, '--workspace-export', workspacePath,
      '--completed-at', '2026-08-20T13:00:00.000Z', '--output', outputPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(report.version, 2);
    assert.equal(report.summary.matchedTimeEntries, 1);
    assert.equal(report.summary.matchedExpenses, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
