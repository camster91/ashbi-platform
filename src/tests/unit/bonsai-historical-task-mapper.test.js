import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBonsaiHistoricalTasks } from '../../services/bonsaiHistoricalTaskMapper.service.js';

const projects = [{ project_id: 'project-1', title: 'Website', client_or_company_name: 'Acme' }];

function row(overrides = {}) {
  return {
    'Task Name': 'Design homepage', Project: 'Website', Company: 'Acme', Assignee: 'Cameron Ashley',
    Priority: '', 'Start Date': '2025-01-01', 'Due Date': '2025-01-02', Status: 'Done',
    'Task ID': 'task_001', Created: '2024-12-31 10:00:00', 'Task Type': 'task', 'Parent Task ID': '',
    ...overrides,
  };
}

test('historical task mapper preserves identity, dates, evidence, and exact project mapping', () => {
  const result = mapBonsaiHistoricalTasks({ taskRows: [row({ Tags: 'design' })], projectRows: projects });
  assert.deepEqual(result.summary, { sourceTasks: 1, mappedTasks: 1, parentTasks: 0, findings: 0 });
  assert.equal(result.tasks[0].sourceId, 'task_001');
  assert.equal(result.tasks[0].projectSourceId, 'project-1');
  assert.equal(result.tasks[0].status, 'COMPLETED');
  assert.equal(result.tasks[0].priority, 'NORMAL');
  assert.equal(result.tasks[0].createdAt, '2024-12-31T10:00:00.000Z');
  assert.equal(result.tasks[0].evidence.tags, 'design');
});

test('historical task mapper preserves valid parent relationships', () => {
  const result = mapBonsaiHistoricalTasks({
    taskRows: [row(), row({ 'Task ID': 'task_002', 'Task Name': 'Mobile', 'Task Type': 'subtask', 'Parent Task ID': 'task_001' })],
    projectRows: projects,
  });
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[1].parentSourceId, 'task_001');
  assert.equal(result.summary.parentTasks, 1);
});

test('historical task mapper blocks projectless and ambiguous project identities', () => {
  const result = mapBonsaiHistoricalTasks({
    taskRows: [row({ Project: '', Company: '' }), row({ 'Task ID': 'task_002' })],
    projectRows: [...projects, { ...projects[0], project_id: 'project-2' }],
  });
  assert.equal(result.tasks.length, 0);
  assert.equal(result.findings.every(finding => finding.code === 'BONSAI_HISTORICAL_TASK_SOURCE_INVALID'), true);
});

test('historical task mapper blocks unresolved overlap with the current API source', () => {
  const result = mapBonsaiHistoricalTasks({
    taskRows: [row()], projectRows: projects,
    currentTasks: [{ uuid: 'current-1', title: 'Design homepage', project_id: '1234567', project_title: 'Website' }],
  });
  assert.equal(result.tasks.length, 0);
  assert.equal(result.findings[0].code, 'BONSAI_TASK_SOURCE_OVERLAP_UNRESOLVED');
});

test('historical task mapper blocks orphan parent references', () => {
  const result = mapBonsaiHistoricalTasks({
    taskRows: [row({ 'Parent Task ID': 'task_missing' })], projectRows: projects,
  });
  assert.equal(result.tasks.length, 0);
  assert.equal(result.findings[0].code, 'BONSAI_HISTORICAL_TASK_PARENT_UNAVAILABLE');
});

test('historical task mapper blocks every member of a parent cycle', () => {
  const result = mapBonsaiHistoricalTasks({
    taskRows: [
      row({ 'Task ID': 'task_001', 'Parent Task ID': 'task_002' }),
      row({ 'Task ID': 'task_002', 'Task Name': 'Second', 'Parent Task ID': 'task_001' }),
    ],
    projectRows: projects,
  });
  assert.equal(result.tasks.length, 0);
  assert.equal(result.findings.some(finding => finding.code === 'BONSAI_HISTORICAL_TASK_PARENT_CYCLE'), true);
});
