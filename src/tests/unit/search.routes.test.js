import assert from 'node:assert/strict';
import test from 'node:test';
import searchRoutes from '../../routes/search.routes.js';

async function globalSearchHandler() {
  let handler;
  const fastify = {
    authenticate: async () => {},
    get(path, options, routeHandler) {
      if (path === '/') handler = routeHandler;
    },
    post() {},
  };
  await searchRoutes(fastify);
  return handler;
}

test('global search includes scoped task results and total count', async () => {
  const handler = await globalSearchHandler();
  const calls = [];
  const task = {
    id: 'task-one',
    title: 'Launch homepage',
    project: { id: 'project-one', name: 'Website', client: { id: 'client-one', name: 'Client' } },
  };
  const findMany = (entity, rows) => async (args) => {
    calls.push({ entity, args });
    return rows;
  };

  const response = await handler({
    query: { q: 'launch', limit: '10' },
    prisma: {
      thread: { findMany: findMany('thread', []) },
      client: { findMany: findMany('client', []) },
      project: { findMany: findMany('project', []) },
      task: { findMany: findMany('task', [task]) },
      message: { findMany: findMany('message', []) },
    },
  });

  assert.deepEqual(response.results.tasks, [task]);
  assert.equal(response.totalResults, 1);
  const taskCall = calls.find(({ entity }) => entity === 'task');
  assert.equal(taskCall.args.where.deletedAt, null);
  assert.equal(taskCall.args.take, 10);
  assert.deepEqual(taskCall.args.include.project.select.client.select, { id: true, name: true });
});

test('tasks filter queries only tasks', async () => {
  const handler = await globalSearchHandler();
  let taskCalls = 0;
  const shouldNotRun = async () => assert.fail('unselected entity was queried');

  const response = await handler({
    query: { q: 'launch', type: 'tasks' },
    prisma: {
      thread: { findMany: shouldNotRun },
      client: { findMany: shouldNotRun },
      project: { findMany: shouldNotRun },
      task: { findMany: async () => { taskCalls += 1; return []; } },
      message: { findMany: shouldNotRun },
    },
  });

  assert.equal(taskCalls, 1);
  assert.equal(response.totalResults, 0);
});
