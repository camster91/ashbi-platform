import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTaskViewsSchema } from '../../validators/schemas.js';
import { readTaskViews, saveTaskViews } from '../../services/task-views.service.js';
import taskRoutes from '../../routes/task.routes.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const view = { key: 'review', name: 'Review queue', layout: 'TABLE', sort: 'DUE_DATE', filters: { status: 'REVIEW', search: 'artwork' } };
function db(project = { id: 'p1', name: 'Project', taskViews: null, taskViewsRevision: 0, taskStages: [{ key: 'review' }] }) {
  const writes = [];
  const prisma = { project: { findFirst: async () => project, update: async args => { writes.push(args); Object.assign(project, { taskViews: args.data.taskViews, taskViewsRevision: project.taskViewsRevision + 1 }); return project; } },
    $transaction: async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(prisma); } };
  return { prisma, writes };
}
test('view metadata rejects unsupported layouts, duplicate keys/names and unbounded searches', () => {
  assert.equal(projectTaskViewsSchema.safeParse({ revision: 0, views: [view] }).success, true);
  assert.equal(projectTaskViewsSchema.safeParse({ revision: 0, views: [{ ...view, layout: 'CALENDAR' }] }).success, true);
  assert.equal(projectTaskViewsSchema.safeParse({ revision: 0, views: [] }).success, true);
  for (const views of [[view, { ...view, key: 'other', name: 'review queue' }], [{ ...view, layout: 'SCRIPT' }], [{ ...view, filters: { search: 'x'.repeat(201) } }]]) {
    assert.equal(projectTaskViewsSchema.safeParse({ revision: 0, views }).success, false);
  }
});
test('saving shared views advances only metadata revision and empty views do not delete tasks', async () => {
  const { prisma, writes } = db();
  assert.deepEqual((await readTaskViews(prisma, 'p1')).views, []);
  const saved = await saveTaskViews(prisma, 'p1', { revision: 0, views: [view] });
  assert.equal(saved.revision, 1);
  assert.deepEqual(writes[0].data, { taskViews: [view], taskViewsRevision: { increment: 1 } });
  await saveTaskViews(prisma, 'p1', { revision: 1, views: [] });
  assert.deepEqual(writes[1].data.taskViews, []);
});
test('foreign/missing project, stale edits and unavailable stages refuse metadata writes', async () => {
  await assert.rejects(readTaskViews(db(null).prisma, 'foreign'), { statusCode: 404 });
  const { prisma, writes } = db();
  await assert.rejects(saveTaskViews(prisma, 'p1', { revision: 1, views: [view] }), { statusCode: 409 });
  await assert.rejects(saveTaskViews(prisma, 'p1', { revision: 0, views: [{ ...view, filters: { stageKey: 'foreign-stage' } }] }), { statusCode: 400 });
  assert.equal(writes.length, 0);
});
test('task search/stage filters combine with project, priority and existing assignment restrictions', async () => {
  let handler, counted;
  const noop = () => {};
  await taskRoutes({ authenticate: noop, get: (path, options, run) => { if (path === '/') handler = run; }, post: noop, put: noop, patch: noop, delete: noop });
  await handler({ query: { projectId: 'p1', stageKey: 'review', search: ' art ', priority: 'HIGH' }, user: { id: 'member', role: 'TEAM' },
    prisma: { task: { count: async ({ where }) => { if (!where.AND) counted = where; return 0; } } } });
  assert.deepEqual(counted, { projectId: 'p1', stageKey: 'review', priority: 'HIGH', assigneeId: 'member',
    OR: [{ title: { contains: 'art', mode: 'insensitive' } }, { description: { contains: 'art', mode: 'insensitive' } }] });
});
test('workspace view filters preserve explicit tenant scope and pagination bounds', async () => {
  let query;
  const ctx = { user: { id: 'u1', role: 'TEAM', organizationId: 'org-a' }, scopes: ['workspace:read'],
    prisma: { task: { findMany: async args => { query = args; return []; } } } };
  await createWorkspaceTools().call(ctx, 'list_tasks', { projectId: 'p1', search: 'art', stageKey: 'review', priority: 'HIGH' });
  assert.equal(query.where.project.organizationId, 'org-a');
  assert.equal(query.where.projectId, 'p1');
  assert.equal(query.where.stageKey, 'review');
  assert.equal(query.where.priority, 'HIGH');
  assert.equal(query.take, 26);
});
