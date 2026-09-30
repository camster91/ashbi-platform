import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClickUpTaskImportPlan } from '../../services/clickup-import-plan.service.js';

test('ClickUp planner maps supported task fields without writing', () => {
  const plan = buildClickUpTaskImportPlan([{ id: 'parent', name: 'Build', status: 'In Progress', priority: 'Urgent' }, { id: 'child', name: 'Review', 'Parent Task ID': 'parent', status: 'Closed' }]);
  assert.equal(plan.complete, true);
  assert.deepEqual(plan.tasks.map(({ sourceId, status, priority, parentSourceId }) => ({ sourceId, status, priority, parentSourceId })), [{ sourceId: 'parent', status: 'IN_PROGRESS', priority: 'CRITICAL', parentSourceId: null }, { sourceId: 'child', status: 'COMPLETED', priority: 'NORMAL', parentSourceId: 'parent' }]);
});

test('ClickUp planner fails reconciliation for unsafe rows', () => {
  const plan = buildClickUpTaskImportPlan([{ id: 'one', name: '' }, { id: 'one', name: 'Duplicate', parent: 'missing' }]);
  assert.equal(plan.complete, false);
  assert.equal(plan.errors.length, 3);
});

test('ClickUp planner reports custom statuses and unknown priorities as coded warnings', () => {
  const plan = buildClickUpTaskImportPlan([
    { id: 'a', name: 'Custom', status: 'Client Review', priority: 'P0' },
    { id: 'b', name: 'Blank fields fall back quietly', status: '', priority: '' },
    { id: 'c', name: 'Known', status: 'Doing', priority: 'low' },
  ]);
  assert.equal(plan.complete, true, 'a fallback is a warning, not a blocking finding');
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.warnings, [
    { row: 2, sourceId: 'a', code: 'STATUS_FALLBACK', value: 'Client Review', mappedTo: 'PENDING' },
    { row: 2, sourceId: 'a', code: 'PRIORITY_FALLBACK', value: 'P0', mappedTo: 'NORMAL' },
  ]);
  assert.deepEqual(plan.tasks.map((task) => [task.status, task.priority]), [['PENDING', 'NORMAL'], ['PENDING', 'NORMAL'], ['IN_PROGRESS', 'LOW']]);
});

test('ClickUp planner detects self-parents and parent cycles', () => {
  const plan = buildClickUpTaskImportPlan([
    { id: 'self', name: 'Own parent', parent: 'self' },
    { id: 'a', name: 'A', parent: 'c' },
    { id: 'b', name: 'B', parent: 'a' },
    { id: 'c', name: 'C', parent: 'b' },
    { id: 'leaf', name: 'Below the cycle', parent: 'a' },
    { id: 'root', name: 'Root' },
    { id: 'child', name: 'Child', parent: 'root' },
  ]);
  assert.equal(plan.complete, false);
  assert.deepEqual(plan.errors, [
    { sourceId: 'self', code: 'PARENT_SELF' },
    { sourceIds: ['a', 'c', 'b'], code: 'PARENT_CYCLE' },
  ]);
});
