import test from 'node:test';
import assert from 'node:assert/strict';
import noteRoutes from '../../routes/note.routes.js';
import timeRoutes from '../../routes/time.routes.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { withSoftDelete } from '../../services/soft-delete.service.js';

async function handlers(registrar, db) {
  const routes = {};
  const register = method => (path, _options, fn) => { routes[`${method} ${path}`] = fn; };
  await registrar({ authenticate: () => {}, prisma: db, get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });
  return routes;
}
const reply = { status(code) { this.code = code; return this; }, send(body) { return { status: this.code, ...body }; } };
test('document pagination filters before counting and combines search/type/project/portfolio', async () => {
  let query, counted;
  const db = { user: { findFirst: async () => ({ id: 'member', role: 'ADMIN', organizationId: 'org-a' }) }, note: { findMany: async args => { query = args; return [{ id: 'n1', title: 'Brief', tags: '[]', mentions: '[]' }]; }, count: async ({ where }) => { counted = where; return 150; } } };
  const routes = await handlers(noteRoutes, db);
  const result = await routes['GET /notes']({ user: { id: 'member', role: 'ADMIN', organizationId: 'org-a' }, query: { paginated: 'true', page: '2', limit: '100', search: 'brief', type: 'DOC', projectId: 'p1', portfolio: 'FREELANCE' }, prisma: db }, reply);
  assert.equal(query.skip, 100); assert.equal(query.take, 100);
  assert.deepEqual(query.where.project, { portfolio: 'FREELANCE' });
  assert.equal(query.where.projectId, 'p1'); assert.equal(query.where.OR.length, 2);
  assert.deepEqual(counted, query.where);
  assert.deepEqual(result.pagination, { page: 2, limit: 100, total: 150, pages: 2 });
});
test('legacy notes stay arrays; invalid filters/pages refuse reads', async () => {
  let calls = 0;
  const db = { user: { findFirst: async () => ({ id: 'member', role: 'ADMIN', organizationId: 'org-a' }) }, note: { findMany: async () => { calls++; return []; } } };
  const routes = await handlers(noteRoutes, db);
  assert.deepEqual(await routes['GET /notes']({ user: { id: 'member', role: 'ADMIN', organizationId: 'org-a' }, query: {}, prisma: db }, reply), []);
  const beforeInvalid = calls;
  for (const query of [{ portfolio: 'PRIVATE' }, { paginated: 'true', limit: '101' }, { paginated: 'true', page: '-1' }]) {
    assert.equal((await routes['GET /notes']({ query, prisma: db }, reply)).status, 400);
  }
  assert.equal(calls, beforeInvalid);
});
test('weekly and summary time filters preserve ownership and dates; unclassified stays null', async () => {
  let query;
  const db = { timeEntry: { findMany: async args => { query = args; return []; }, groupBy: async args => { query = args; return []; } } };
  const routes = await handlers(timeRoutes, db);
  const request = { query: { weekStart: '2026-10-12T00:00:00Z', portfolio: 'UNCLASSIFIED' }, user: { id: 'member', role: 'TEAM' }, prisma: db };
  await routes['GET /timesheets/weekly'](request, reply);
  assert.equal(query.where.userId, 'member'); assert.deepEqual(query.where.project, { portfolio: null });
  assert.equal(query.where.date.gte.toISOString(), new Date(request.query.weekStart).toISOString());
  await routes['GET /time-entries/summary']({ ...request, query: { portfolio: 'ASHBI_DESIGN' } }, reply);
  assert.equal(query.where.userId, 'member'); assert.deepEqual(query.where.project, { portfolio: 'ASHBI_DESIGN' });
  assert.equal((await routes['GET /timesheets/weekly']({ ...request, query: { portfolio: 'PRIVATE' } }, reply)).status, 400);
});
test('MCP notes/time reads explicitly scope tenant, portfolio and team-owned time', async () => {
  const queries = {};
  const ctx = { user: { id: 'member', role: 'TEAM', organizationId: 'org-a' }, scopes: ['workspace:read'], prisma: {
    user: { findFirst: async () => ({ id: 'member', role: 'TEAM', organizationId: 'org-a' }) },
    note: { findMany: async query => { if (query.select?.accessMode) queries.note = query; return []; } }, timeEntry: { findMany: async query => { queries.time = query; return []; } },
  } };
  const tools = createWorkspaceTools();
  await tools.call(ctx, 'list_notes', { portfolio: 'FREELANCE' });
  await tools.call(ctx, 'list_time_entries', { portfolio: 'UNCLASSIFIED' });
  assert.deepEqual(queries.note.where.AND[0].project, { organizationId: 'org-a', portfolio: 'FREELANCE' });
  assert.deepEqual(queries.time.where, { project: { organizationId: 'org-a', portfolio: null }, userId: 'member' });
  await tools.call({ ...ctx, user: { ...ctx.user, role: 'ADMIN' } }, 'list_time_entries', {});
  assert.equal(queries.time.where.userId, undefined);
});

test('time summary aggregates beyond the read cap without loading time history', async () => {
  const calls = [];
  const db = { timeEntry: {
    findMany: async () => assert.fail('Summary must never load raw time rows'),
    groupBy: async args => { calls.push(args); return [{ projectId: 'p', userId: 'u', _sum: { duration: 3030 }, _count: { _all: 101 } }]; },
  }, project: { findMany: async () => [{ id: 'p', name: 'Project' }] }, user: { findMany: async () => [{ id: 'u', name: 'Teammate' }] } };
  const routes = await handlers(timeRoutes, db);
  const result = await routes['GET /time-entries/summary']({ query: { portfolio: 'FREELANCE' }, user: { id: 'admin', role: 'ADMIN' }, prisma: db }, reply);
  assert.equal(result.totalMinutes, 3030);
  assert.equal(result.byProject[0].entries, 101);
  assert.equal(result.byUser[0].totalMinutes, 3030);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.where.project.portfolio === 'FREELANCE'));
});

test('historical summaries retain archived project labels without disabling soft-delete filtering', async () => {
  const raw = { timeEntry: { groupBy: async ({ by }) => by[0] === 'projectId' ? [{ projectId: 'archived', _sum: { duration: 60 }, _count: { _all: 1 } }] : [] },
    project: { findMany: async ({ where }) => where.deletedAt?.not === null ? [{ id: 'archived', name: 'Archived client project' }] : [] },
    user: { findMany: async () => [] } };
  const db = withSoftDelete(raw);
  const routes = await handlers(timeRoutes, db);
  const result = await routes['GET /time-entries/summary']({ query: {}, user: { id: 'member', role: 'TEAM' }, prisma: db }, reply);
  assert.equal(result.byProject[0].project.name, 'Archived client project');
  assert.equal(result.totalMinutes, 60);
  assert.deepEqual(await db.project.findMany({}), [], 'ordinary reads still exclude archived projects');
});
