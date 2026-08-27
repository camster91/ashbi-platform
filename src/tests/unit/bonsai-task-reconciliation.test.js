import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { reconcileBonsaiTasks } from '../../services/bonsaiTaskReconciliation.service.js';
import { buildWorkspaceExportManifest, WORKSPACE_EXPORT_V3_COLLECTIONS } from '../../services/workspace-export-integrity.service.js';

function workspaceExport(overrides = {}) {
  const records = Object.fromEntries(WORKSPACE_EXPORT_V3_COLLECTIONS.map(collection => [collection, []]));
  records.clients = [{ id: 'client-1', name: 'Acme' }];
  records.projects = [{ id: 'project-1', bonsaiProjectId: '123', clientId: 'client-1', name: 'Acme Website' }];
  records.users = [{ id: 'user-1', name: 'Cameron Ashley' }];
  records.tasks = [{
    id: 'task-1', projectId: 'project-1', parentId: null, assigneeId: 'user-1',
    title: 'Build homepage', status: 'IN_PROGRESS', priority: 'HIGH',
    properties: JSON.stringify({ bonsaiTaskId: 'task-source-1' }),
    dueDate: '2026-08-30T00:00:00.000Z', startDate: null, completedAt: null,
  }];
  Object.assign(records, overrides);
  return {
    format: 'ashbi-workspace-export', version: 3, exportedAt: '2026-08-20T12:00:00.000Z',
    organization: { id: 'org-1', name: 'Ashbi', slug: 'ashbi' }, records,
    manifest: buildWorkspaceExportManifest(records, { version: 3 }),
  };
}

function taskSnapshot(tasks = null) {
  return {
    format: 'bonsai-task-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-20T12:30:00.000Z',
    tasks: tasks ?? [{
      uuid: 'task-source-1', title: 'Build homepage', project_id: 123,
      project_title: 'Acme Website', assignee_member_name: 'Cameron Ashley',
      due_date: '2026-08-30', start_date: null, completed_at: null, archived_at: null,
      priority: 'high', task_status: { status: 'In Progress', state: 'active' },
    }],
  };
}

function input(snapshot = taskSnapshot(), workspace = workspaceExport()) {
  return {
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiTasksSha256: 'a'.repeat(64), workspaceArtifactSha256: 'b'.repeat(64),
    bonsaiTaskSnapshot: snapshot, workspaceExport: workspace,
  };
}

test('task reconciliation binds exact task, project, owner, schedule, status, and priority evidence', () => {
  const report = reconcileBonsaiTasks(input());
  assert.equal(report.complete, true);
  assert.equal(report.version, 1);
  assert.deepEqual(report.summary, { sourceTasks: 1, hubBonsaiTasks: 1, matchedTasks: 1 });
  assert.deepEqual(report.findings, []);
  assert.equal(report.sourceEvidence.tasksSha256, 'a'.repeat(64));
  assert.equal(report.workspaceEvidence.collectionCounts.tasks, 1);
});

test('task reconciliation version 2 binds and verifies native historical task evidence', () => {
  const workspace = workspaceExport();
  workspace.records.projects.push({ id: 'project-history', bonsaiProjectId: 'LEG-0001', clientId: 'client-1', name: 'Legacy Website' });
  workspace.records.tasks.push({
    id: 'task-history', projectId: 'project-history', parentId: null, assigneeId: 'user-1',
    title: 'Legacy design', status: 'COMPLETED', priority: 'NORMAL', estimatedTime: '60',
    properties: JSON.stringify({
      bonsaiLegacyTaskId: 'task_001', bonsaiSource: 'native-task-export', taskList: null,
      progress: null, estimate: '60', timeTracked: null, timeRemaining: null,
      billing: null, service: null, tags: null, taskType: 'task',
    }),
    dueDate: null, startDate: null, completedAt: null, createdAt: '2025-01-01T10:00:00.000Z',
  });
  workspace.manifest = buildWorkspaceExportManifest(workspace.records, { version: 3 });
  const report = reconcileBonsaiTasks({
    ...input(taskSnapshot(), workspace),
    bonsaiHistoricalTasksSha256: 'c'.repeat(64),
    bonsaiProjectsSha256: 'd'.repeat(64),
    bonsaiHistoricalTaskRows: [{
      'Task Name': 'Legacy design', Project: 'Legacy Website', Company: 'Acme',
      Assignee: 'Cameron Ashley', Priority: '', 'Start Date': '', 'Due Date': '',
      Estimate: '60', Status: 'Done', 'Task ID': 'task_001',
      Created: '2025-01-01 10:00:00', 'Task Type': 'task', 'Parent Task ID': '',
    }],
    bonsaiProjectRows: [{ project_id: 'LEG-0001', title: 'Legacy Website', client_or_company_name: 'Acme' }],
  });
  assert.equal(report.complete, true);
  assert.equal(report.version, 2);
  assert.equal(report.summary.matchedHistoricalTasks, 1);
  assert.equal(report.sourceEvidence.historicalTasksSha256, 'c'.repeat(64));
  assert.equal(report.sourceEvidence.historicalProjectsSha256, 'd'.repeat(64));
});

test('task reconciliation refuses incomplete or active-only source snapshots', () => {
  const snapshot = taskSnapshot();
  snapshot.scope = 'active';
  assert.throws(() => reconcileBonsaiTasks(input(snapshot)), /complete all-scope/);
});

test('task reconciliation preserves projectless and unresolvable owners as findings', () => {
  const snapshot = taskSnapshot([{ ...taskSnapshot().tasks[0], project_id: null, assignee_member_name: 'Unknown Person' }]);
  const workspace = workspaceExport({ tasks: [] });
  const report = reconcileBonsaiTasks(input(snapshot, workspace));
  assert.deepEqual(report.findings, [{
    code: 'BONSAI_TASK_SOURCE_INVALID', sourceId: 'task-source-1', taskTitle: 'Build homepage',
    fields: ['project_id', 'project_identity', 'owner_identity'],
  }]);
});

test('task reconciliation reports missing tasks on either side', () => {
  const snapshot = taskSnapshot([{ ...taskSnapshot().tasks[0], uuid: 'source-only' }]);
  const report = reconcileBonsaiTasks(input(snapshot));
  assert.deepEqual(report.findings, [{
    code: 'BONSAI_TASK_MISSING_IN_HUB', sourceId: 'source-only', taskTitle: 'Build homepage',
  }, {
    code: 'HUB_BONSAI_TASK_MISSING_IN_SOURCE', sourceId: 'task-source-1', hubTaskId: 'task-1', taskTitle: 'Build homepage',
  }]);
});

test('task reconciliation reports every material field difference', () => {
  const workspace = workspaceExport();
  Object.assign(workspace.records.tasks[0], {
    title: 'Different', projectId: 'wrong-project', status: 'PENDING', priority: 'LOW', assigneeId: null,
    dueDate: null, startDate: '2026-08-01T00:00:00.000Z', completedAt: '2026-08-02T00:00:00.000Z',
  });
  workspace.records.projects.push({ id: 'wrong-project', bonsaiProjectId: '456', clientId: 'client-1', name: 'Other' });
  workspace.manifest = buildWorkspaceExportManifest(workspace.records, { version: 3 });
  const report = reconcileBonsaiTasks(input(taskSnapshot(), workspace));
  assert.deepEqual(report.findings, [{
    code: 'TASK_FIELD_MISMATCH', sourceId: 'task-source-1', hubTaskId: 'task-1',
    fields: ['title', 'project', 'status', 'priority', 'assignee', 'dueDate', 'startDate', 'completedAt'],
  }]);
});

test('task reconciliation refuses duplicate source and Hub task identities', () => {
  const snapshot = taskSnapshot([taskSnapshot().tasks[0], taskSnapshot().tasks[0]]);
  const workspace = workspaceExport();
  workspace.records.tasks.push({ ...workspace.records.tasks[0], id: 'task-2' });
  workspace.manifest = buildWorkspaceExportManifest(workspace.records, { version: 3 });
  const report = reconcileBonsaiTasks(input(snapshot, workspace));
  assert.deepEqual(report.findings, [{
    code: 'DUPLICATE_BONSAI_TASK_ID', sourceId: 'task-source-1', rows: 2,
  }, {
    code: 'DUPLICATE_HUB_BONSAI_TASK_ID', sourceId: 'task-source-1', hubTaskIds: ['task-1', 'task-2'],
  }]);
});

test('task reconciliation command creates an immutable owner-only report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-bonsai-tasks-'));
  try {
    const tasksPath = path.join(directory, 'tasks.json');
    const workspacePath = path.join(directory, 'workspace.json');
    const historicalTasksPath = path.join(directory, 'task-history.csv');
    const projectsPath = path.join(directory, 'projects.csv');
    const outputPath = path.join(directory, 'report.json');
    const tasksContent = Buffer.from(JSON.stringify(taskSnapshot()));
    const workspaceContent = Buffer.from(JSON.stringify(workspaceExport()));
    fs.writeFileSync(tasksPath, tasksContent);
    fs.writeFileSync(workspacePath, workspaceContent);
    fs.writeFileSync(historicalTasksPath, 'Task Name,Project,Company,Assignee,Status,Task ID,Created,Task Type,Parent Task ID\n');
    fs.writeFileSync(projectsPath, 'project_id,title,client_or_company_name\n');
    const result = spawnSync(process.execPath, [
      'scripts/reconcile-bonsai-tasks.js', '--organization-id', 'org-1',
      '--bonsai-tasks', tasksPath, '--bonsai-task-history', historicalTasksPath,
      '--bonsai-projects', projectsPath, '--workspace-export', workspacePath,
      '--completed-at', '2026-08-20T13:00:00.000Z', '--output', outputPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(report.complete, true);
    assert.equal(report.version, 2);
    assert.equal(report.sourceEvidence.tasksSha256, crypto.createHash('sha256').update(tasksContent).digest('hex'));
    assert.match(result.stdout, /passed with zero findings/);
    const overwrite = spawnSync(process.execPath, [
      'scripts/reconcile-bonsai-tasks.js', '--organization-id', 'org-1',
      '--bonsai-tasks', tasksPath, '--bonsai-task-history', historicalTasksPath,
      '--bonsai-projects', projectsPath, '--workspace-export', workspacePath,
      '--completed-at', '2026-08-20T13:00:00.000Z', '--output', outputPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(overwrite.status, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
