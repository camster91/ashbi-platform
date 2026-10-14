import test from 'node:test';
import assert from 'node:assert/strict';
import { taskRelationLabels } from '../../services/task-relation-labels.service.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const actor = { id: 'staff', role: 'TEAM', organizationId: 'org-a' };
const field = { key: 'related', type: 'RELATION', target: 'CLIENT' };
test('relation labels batch more than 100 ids and omit unavailable targets without changing values', async () => {
  const tasks = Array.from({ length: 101 }, (_, i) => ({ id: `t${i}`, projectId: 'project', fieldValues: { related: `c${i}` } }));
  const batches = [];
  const prisma = { project: { findFirst: async ({ where }) => { assert.equal(where.organizationId, 'org-a'); return { taskFields: [field] }; } }, client: { findMany: async ({ where, take }) => { assert.equal(where.organizationId, 'org-a'); assert.equal(where.deletedAt, null); assert.equal(take, 100); batches.push(where.id.in.length); return where.id.in.filter(id => id !== 'c100').map(id => ({ id, name: `Client ${id}` })); } } };
  const result = await taskRelationLabels(prisma, 'project', 'related', tasks, actor);
  assert.deepEqual(batches, [100, 1]);
  assert.deepEqual(result[0].fieldRelations.related, { id: 'c0', name: 'Client c0' });
  assert.equal(result[100].fieldRelations.related, null);
  assert.deepEqual(result.map(task => task.fieldValues), tasks.map(task => task.fieldValues));
});
test('MCP relation reads scope both definitions and named target queries on a raw client', async () => {
  const tasks = [{ id: 'task', projectId: 'project', fieldValues: { related: 'client' } }];
  const prisma = { task: { findMany: async ({ where }) => { assert.equal(where.project.organizationId, 'org-a'); return tasks; } }, project: { findFirst: async ({ where }) => { assert.equal(where.organizationId, 'org-a'); return { taskFields: [field] }; } }, client: { findMany: async ({ where }) => { assert.equal(where.organizationId, 'org-a'); return [{ id: 'client', name: 'Named client' }]; } } };
  const result = await createWorkspaceTools().call({ prisma, user: actor, scopes: ['workspace:read'] }, 'list_tasks', { projectId: 'project', relationField: 'related' });
  assert.equal(result.output.items[0].fieldRelations.related.name, 'Named client');
  await assert.rejects(taskRelationLabels(prisma, null, 'related', tasks, actor), { statusCode: 400 });
  await assert.rejects(taskRelationLabels(prisma, 'project', 'related', tasks, { ...actor, role: 'CLIENT' }), { statusCode: 403 });
  await assert.rejects(taskRelationLabels(prisma, 'project', 'missing', tasks, actor), { statusCode: 400 });
  await assert.rejects(taskRelationLabels(prisma, 'project', 'related', [{ ...tasks[0], projectId: 'foreign' }], actor), { statusCode: 403 });
});
