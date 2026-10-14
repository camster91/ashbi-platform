import assert from 'node:assert/strict';
import test from 'node:test';
import projectRoutes from '../../routes/project.routes.js';
import taskRoutes from '../../routes/task.routes.js';
import { createProjectSchema, updateProjectSchema } from '../../validators/schemas.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

async function routesFor(register, prisma = {}) {
  const routes = {};
  const capture = method => (path, options, handler) => { routes[`${method} ${path}`] = handler; };
  await register({ authenticate: async () => {}, prisma,
    get: capture('GET'), post: capture('POST'), put: capture('PUT'), patch: capture('PATCH'), delete: capture('DELETE') });
  return routes;
}
const reply = () => ({ code: 200, status(code) { this.code = code; return this; }, send(body) { this.body = body; return this; } });

test('portfolio writes accept explicit classification and clearing, and reject invented values', () => {
  for (const portfolio of ['ASHBI_DESIGN', 'FREELANCE', null]) {
    assert.equal(createProjectSchema.safeParse({ name: 'Website', clientId: 'client-1', portfolio }).success, true);
    assert.equal(updateProjectSchema.safeParse({ portfolio }).success, true);
  }
  assert.equal(updateProjectSchema.safeParse({ portfolio: 'All work' }).success, false);
});

test('project create and update persist portfolio without changing organization or client ownership', async () => {
  let created, updated;
  const prisma = {
    client: { findFirst: async () => ({ id: 'client-1' }) },
    project: { create: async ({ data }) => { created = data; return data; }, update: async ({ data }) => { updated = data; return data; } },
  };
  const routes = await routesFor(projectRoutes, prisma);
  await routes['POST /']({ prisma, user: { id: 'user-1' }, body: { name: 'Website', clientId: 'client-1', portfolio: 'FREELANCE' } }, reply());
  assert.equal(created.portfolio, 'FREELANCE');
  assert.equal(created.clientId, 'client-1');
  await routes['PUT /:id']({ params: { id: 'project-1' }, user: { id: 'user-1' }, body: { portfolio: null } }, reply());
  assert.deepEqual(updated, { portfolio: null });
});

test('project lists apply portfolio before pagination and count; invalid input never queries', async () => {
  const queries = [];
  const prisma = { project: {
    findMany: async args => { queries.push(args.where); return []; },
    count: async args => { queries.push(args.where); return 0; },
  }, task: { groupBy: async () => [] } };
  const routes = await routesFor(projectRoutes);
  for (const [portfolio, expected] of [['FREELANCE', { portfolio: 'FREELANCE' }], ['UNCLASSIFIED', { portfolio: null }], [undefined, {}]]) {
    queries.length = 0;
    await routes['GET /']({ prisma, query: { portfolio } }, reply());
    assert.deepEqual(queries, [{ ...expected, deletedAt: null }, { ...expected, deletedAt: null }]);
  }
  queries.length = 0;
  const r = reply();
  await routes['GET /']({ prisma, query: { portfolio: 'OTHER' } }, r);
  assert.equal(r.code, 400);
  assert.equal(queries.length, 0);
});

test('task portfolio filters retain explicit participation restrictions for team users', async () => {
  let counted;
  const routes = await routesFor(taskRoutes);
  await routes['GET /']({ query: { portfolio: 'ASHBI_DESIGN' }, user: { role: 'TEAM', id: 'member-1' },
    prisma: { task: { count: async ({ where }) => { if (where.AND?.length === 1) counted = where; return 0; }, findMany: async () => [] } } }, reply());
  assert.deepEqual(counted, { project: { portfolio: 'ASHBI_DESIGN' }, AND: [{ OR: [{ assigneeId: 'member-1' }, { collaborators: { some: { userId: 'member-1' } } }] }] });
});

test('workspace project and task reads keep tenant filters alongside portfolio and reject invalid values', async () => {
  const service = createWorkspaceTools();
  for (const [name, model, expected] of [
    ['list_projects', 'project', { organizationId: 'org-a', portfolio: 'FREELANCE' }],
    ['list_tasks', 'task', { project: { organizationId: 'org-a', portfolio: 'FREELANCE' } }],
  ]) {
    let query;
    const context = { user: { id: 'user-a', organizationId: 'org-a', role: 'TEAM' }, scopes: ['workspace:read'],
      prisma: { [model]: { findMany: async args => { query = args; return []; } } } };
    await service.call(context, name, { portfolio: 'FREELANCE' });
    assert.deepEqual(query.where, expected);
    await assert.rejects(service.call(context, name, { portfolio: 'BAD' }), { code: 'INVALID_INPUT' });
  }
});
