import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTaskStagesSchema } from '../../validators/schemas.js';
import { saveTaskStages, resolveTaskStage, withStageTransaction } from '../../services/task-stages.service.js';
import taskRoutes from '../../routes/task.routes.js';

const stages = [{ key: 'review', name: 'Design review', status: 'REVIEW' }, { key: 'done', name: 'Delivered', status: 'COMPLETED' }];
function db({ revision = 0, occupied = 0, project = true } = {}) {
  const writes = [];
  const prisma = {
    project: {
      findFirst: async () => project ? { id: 'p1', boardRevision: revision, taskStages: stages } : null,
      update: async args => { writes.push(args); return args.data; },
    },
    task: { count: async () => occupied, findFirst: async () => ({ projectId: 'p1' }),
      update: async args => { writes.push(args); return args.data; }, create: async args => { writes.push(args); return args.data; } },
    $transaction: async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(prisma); },
  };
  return { prisma, writes };
}
async function taskHandlers() {
  const routes = {};
  const record = method => (path, options, handler) => { routes[`${method} ${path}`] = handler; };
  await taskRoutes({ authenticate: async () => {}, get: record('GET'), post: record('POST'), put: record('PUT'), patch: record('PATCH'), delete: record('DELETE') });
  return routes;
}

test('stage settings reject duplicate keys/names, empty workflows, unsupported status and unsafe keys', () => {
  assert.equal(projectTaskStagesSchema.safeParse({ revision: 0, stages }).success, true);
  for (const bad of [[], [stages[0], stages[0]], [{ ...stages[0], key: '../x' }], [{ ...stages[0], status: 'CUSTOM_STATUS' }], [{ ...stages[0], name: ' ' }]]) {
    assert.equal(projectTaskStagesSchema.safeParse({ revision: 0, stages: bad }).success, false);
  }
});

test('stage config saves ordered keys with a revision and does not rewrite task lifecycle', async () => {
  const { prisma, writes } = db();
  await saveTaskStages(prisma, 'p1', { revision: 0, stages: [...stages].reverse() });
  assert.deepEqual(writes[0].data, { taskStages: [...stages].reverse(), boardRevision: { increment: 1 } });
  assert.equal(writes.length, 1);
});

test('stale config, occupied removed stages and foreign/missing project refuse writes', async () => {
  for (const [options, statusCode] of [[{ revision: 2 }, 409], [{ occupied: 1 }, 409], [{ project: false }, 404]]) {
    const { prisma, writes } = db(options);
    await assert.rejects(saveTaskStages(prisma, 'p1', { revision: 0, stages }), { statusCode });
    assert.equal(writes.length, 0);
  }
  await assert.rejects(resolveTaskStage(db().prisma, 'p1', 'foreign-key'), { statusCode: 400 });
});

test('serialization failure becomes a reloadable conflict rather than an automatic overwrite', async () => {
  await assert.rejects(withStageTransaction({ $transaction: async () => { throw { code: 'P2034' }; } }, () => {}), { statusCode: 409 });
});

test('move into stage resolves project-local lifecycle, completion date and rejection without mutation', async () => {
  const routes = await taskHandlers();
  const { prisma, writes } = db();
  const moved = await routes['POST /:id/move']({ prisma, params: { id: 't1' }, body: { status: 'PENDING', stageKey: 'done' } });
  assert.equal(moved.status, 'COMPLETED');
  assert.equal(moved.stageKey, 'done');
  assert.ok(moved.completedAt instanceof Date);
  await assert.rejects(routes['POST /:id/move']({ prisma, params: { id: 't1' }, body: { status: 'PENDING', stageKey: 'other-project-stage' } }), { statusCode: 400 });
  assert.equal(writes.length, 1);
  prisma.task.findFirst = async () => null;
  await assert.rejects(routes['POST /:id/move']({ prisma, params: { id: 'foreign-task' }, body: { status: 'PENDING', stageKey: 'done' } }), { statusCode: 404 });
});

test('quick create in a stage uses its lifecycle and completion timestamp', async () => {
  const routes = await taskHandlers();
  const { prisma } = db();
  const task = await routes['POST /:projectId/quick']({ prisma, params: { projectId: 'p1' }, body: { title: 'Deliver assets', stageKey: 'done' } });
  assert.equal(task.projectId, 'p1');
  assert.equal(task.stageKey, 'done');
  assert.equal(task.status, 'COMPLETED');
  assert.ok(task.completedAt instanceof Date);
});

test('legacy board moves clear stage assignment; boards include tasks beyond the scoped 100-row cap', async () => {
  const routes = await taskHandlers();
  const { prisma } = db();
  const moved = await routes['POST /:id/move']({ prisma, params: { id: 't1' }, body: { status: 'PENDING' } });
  assert.equal(moved.stageKey, null);
  const rows = Array.from({ length: 101 }, (_, i) => ({ id: `task-${i}`, status: 'PENDING' }));
  prisma.task.findMany = async ({ skip, take }) => rows.slice(skip, skip + take);
  const board = await routes['GET /kanban/:projectId']({ prisma, params: { projectId: 'p1' } });
  assert.equal(board.PENDING.length, 101);
});
