import assert from 'node:assert/strict';
import test from 'node:test';
import projectRoutes from '../../routes/project.routes.js';
import taskRoutes from '../../routes/task.routes.js';
import { createProjectSchema, taskCreateSchema, TASK_STATUS_VALUES } from '../../validators/schemas.js';

function capture(register, fastifyExtra = {}) {
  const routes = {};
  const record = (method) => (path, options, handler) => { routes[`${method} ${path}`] = { options, handler }; };
  const fastify = {
    authenticate: async () => {},
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    patch: record('PATCH'),
    delete: record('DELETE'),
    register: async () => {},
    ...fastifyExtra,
  };
  return register(fastify).then(() => ({ routes, fastify }));
}

function reply() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, send(p) { this.payload = p; return this; } };
}

async function runPreHandlers(options, request) {
  const handlers = [options.preHandler].flat().filter(Boolean);
  const r = reply();
  for (const h of handlers) await h(request, r);
  return r;
}

test('POST /projects persists status, health, budget and dates from the request', async () => {
  let created;
  const { routes } = await capture(projectRoutes, {
    prisma: { project: { create: async ({ data }) => { created = data; return { id: 'p1', ...data }; } } },
  });
  const route = routes['POST /'];
  const request = {
    user: { id: 'u1' },
    body: {
      name: 'Northwind Brand Refresh', clientId: 'client-1', status: 'DESIGN_DEV', health: 'NEEDS_ATTENTION',
      hourlyBudget: 120, startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-11-06T00:00:00.000Z',
    },
  };
  const pre = await runPreHandlers(route.options, request);
  assert.equal(pre.statusCode, 200, JSON.stringify(pre.payload));
  await route.handler(request, reply());
  assert.equal(created.status, 'DESIGN_DEV');
  assert.equal(created.health, 'NEEDS_ATTENTION');
  assert.equal(created.hourlyBudget, 120);
  assert.equal(created.endDate.toISOString(), '2026-11-06T00:00:00.000Z');
  assert.equal(created.startDate.toISOString(), '2026-09-01T00:00:00.000Z');
});

test('project create keeps DB defaults when optional fields are omitted and rejects unknown statuses', async () => {
  let created;
  const { routes } = await capture(projectRoutes, {
    prisma: { project: { create: async ({ data }) => { created = data; return { id: 'p1', ...data }; } } },
  });
  await routes['POST /'].handler({ user: { id: 'u1' }, body: { name: 'X', clientId: 'c1' } }, reply());
  assert.equal('status' in created, false);
  assert.equal('endDate' in created, false);
  for (const status of ['STARTING_UP', 'LAUNCHED', 'ACTIVE', 'COMPLETED']) {
    assert.equal(createProjectSchema.safeParse({ name: 'X', clientId: 'c1', status }).success, true, status);
  }
  assert.equal(createProjectSchema.safeParse({ name: 'X', clientId: 'c1', status: 'NONSENSE' }).success, false);
});

test('POST /projects/:id/tasks persists a valid task status', async () => {
  let created;
  const { routes } = await capture(projectRoutes, {
    prisma: { task: { create: async ({ data }) => { created = data; return { id: 't1', ...data }; } } },
  });
  const route = routes['POST /:id/tasks'];
  const request = { params: { id: 'p1' }, user: { id: 'u1' }, body: { title: 'Brand guidelines PDF', projectId: 'p1', status: 'WAITING_CLIENT' } };
  const pre = await runPreHandlers(route.options, request);
  assert.equal(pre.statusCode, 200, JSON.stringify(pre.payload));
  await route.handler(request, reply());
  assert.equal(created.status, 'WAITING_CLIENT');
  assert.equal(taskCreateSchema.safeParse({ title: 'x', projectId: 'p1', status: 'NOPE' }).success, false);
});

test('GET /tasks/kanban/:projectId returns every stored task status', async () => {
  const { routes } = await capture(taskRoutes);
  const tasks = TASK_STATUS_VALUES.map((status, i) => ({ id: `t${i}`, status }));
  const board = await routes['GET /kanban/:projectId'].handler({
    params: { projectId: 'p1' },
    prisma: { task: { findMany: async () => tasks } },
  });
  const shown = Object.values(board).flat().map((t) => t.id).sort();
  assert.deepEqual(shown, tasks.map((t) => t.id).sort());
  for (const key of ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED']) assert.ok(Array.isArray(board[key]));
});
