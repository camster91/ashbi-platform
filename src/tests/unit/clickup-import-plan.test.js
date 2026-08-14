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
