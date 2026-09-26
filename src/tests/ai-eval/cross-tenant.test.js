// Adversarial evaluation: cross-tenant retrieval (docs/ai-evaluation.md).
// List tools return only the caller's organization, another organization's
// pending actions cannot be approved or rejected, and resolvers refuse
// foreign records through the real tenant proxy too.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvalHarness } from './harness.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

test('list tools return only the caller\'s organization, even on an unscoped client', async () => {
  const harness = createEvalHarness();
  const projects = await harness.executor.invoke(harness.ctx('team-a'), { tool: 'list_projects', input: {} });
  assert.deepEqual(projects.output.map((row) => row.id), ['project-a']);
  const tasks = await harness.executor.invoke(harness.ctx('team-a'), { tool: 'list_my_tasks', input: {} });
  assert.deepEqual(tasks.output.map((row) => row.id), ['task-a']);
  // A task assigned to the caller but in another organization's project.
  harness.db.tables.task.push({ id: 'task-b-planted', projectId: 'project-b', title: 'planted', status: 'PENDING', assigneeId: 'team-a', updatedAt: new Date() });
  const again = await harness.executor.invoke(harness.ctx('team-a'), { tool: 'list_my_tasks', input: {} });
  assert.deepEqual(again.output.map((row) => row.id), ['task-a']);
});

test('another organization\'s pending action cannot be approved or rejected', async () => {
  const harness = createEvalHarness();
  const { action } = await harness.executor.invoke(harness.ctx('team-b'), {
    tool: 'create_task', input: { projectId: 'project-b', title: 'Org B task' }, idempotencyKey: 'org-b-task-0001',
  });
  // In production the request-scoped client is the tenant proxy.
  const scopedA = { ...harness.ctx('admin-a'), prisma: createScopedPrisma(harness.db, 'org-a') };
  await assert.rejects(harness.executor.approve(scopedA, action.id), { code: 'NOT_FOUND', statusCode: 404 });
  await assert.rejects(harness.executor.reject(scopedA, action.id), { code: 'NOT_FOUND' });
  assert.equal(harness.db.tables.aiBridgeAction[0].status, 'PENDING_CONFIRMATION');
  assert.equal(harness.db.tables.task.length, 2);
});

test('through the real tenant proxy, a foreign project id is still not found', async () => {
  const harness = createEvalHarness();
  const scoped = { ...harness.ctx('admin-a'), prisma: createScopedPrisma(harness.db, 'org-a') };
  await assert.rejects(
    harness.executor.invoke(scoped, { tool: 'get_project_summary', input: { projectId: 'project-b' } }),
    { code: 'RECORD_NOT_FOUND' },
  );
  const own = await harness.executor.invoke(scoped, { tool: 'list_projects', input: {} });
  assert.deepEqual(own.output.map((row) => row.id), ['project-a']);
});
