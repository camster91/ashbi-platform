// What the client-facing project views may expose: no internal health
// rating, AI summary or pinned staff notes; a task board column for every
// task status (including "Waiting on you"); client-safe task fields only; and
// only project files shared with the client in Documents.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';

const { default: portalRoutes } = await import('../../routes/portal.routes.js');
const {
  CLIENT_TASK_COLUMN_STATUSES,
  CLIENT_VISIBLE_ATTACHMENT_WHERE,
  groupClientTaskColumns,
} = await import('../../routes/client-portal.routes.js');
const { TASK_STATUS_VALUES } = await import('../../validators/schemas.js');

const INTERNAL_FIELDS = ['health', 'aiSummary', 'notes', 'pinnedNotes'];

test('every task status maps to exactly one client board column', () => {
  const mapped = Object.values(CLIENT_TASK_COLUMN_STATUSES).flat();
  assert.deepEqual([...mapped].sort(), [...TASK_STATUS_VALUES].sort(), 'each status once, none missing');
  assert.deepEqual(CLIENT_TASK_COLUMN_STATUSES.WAITING_CLIENT, ['WAITING_CLIENT']);

  const tasks = TASK_STATUS_VALUES.map((status) => ({ id: status, status }));
  const columns = groupClientTaskColumns([...tasks, { id: 'legacy', status: 'SOMETHING_OLD' }]);
  assert.equal(Object.values(columns).flat().length, tasks.length + 1, 'no task disappears from the board');
  assert.deepEqual(columns.WAITING_CLIENT.map((task) => task.id), ['WAITING_CLIENT']);
  assert.ok(columns.TODO.some((task) => task.id === 'legacy'), 'an unknown status lands in To Do');
  for (const status of ['WAITING_US', 'TODO', 'REVIEW']) {
    assert.ok(Object.values(columns).some((column) => column.some((task) => task.id === status)), `${status} is shown`);
  }
});

test('portal Documents lists only files shared with the client', () => {
  assert.deepEqual(CLIENT_VISIBLE_ATTACHMENT_WHERE, {
    OR: [{ clientVisible: true }, { reviewSessions: { some: { sharedWithClient: true } } }],
  });
});

test('the public project link selects no notes, health or AI summary', async (t) => {
  let query;
  const project = {
    name: 'Website', description: 'A new site', status: 'DESIGN_DEV', updatedAt: new Date(),
    id: 'project-1', client: { name: 'Acme' }, revisionRounds: [], milestones: [], tasks: [],
  };
  const waiting = [{ id: 't1', title: 'Copy', status: 'WAITING_CLIENT', priority: 'NORMAL', category: 'UPCOMING', dueDate: null }];
  const prisma = {
    project: { findFirst: async (args) => { query = args; return project; } },
    task: { findMany: async () => waiting },
  };
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(portalRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/view-token-1' });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(query.include, undefined, 'an explicit select, so no internal column is even loaded');
  for (const field of INTERNAL_FIELDS) {
    assert.equal(field in query.select, false, `${field} is not selected`);
    assert.equal(field in response.json(), false, `${field} is not returned`);
  }
  assert.equal(response.json().activeTasks[0].status, 'WAITING_CLIENT');
  assert.equal('id' in response.json(), false, 'the project id is not returned');
  assert.equal('id' in response.json().activeTasks[0], false, 'task ids are not returned');
  // Trashed or cancelled projects are not served; revision rounds carry
  // client-facing fields only.
  assert.deepEqual(query.where, { viewToken: 'view-token-1', deletedAt: null, status: { not: 'CANCELLED' } });
  assert.equal('projectId' in query.select.revisionRounds.select, false);
  assert.equal(query.select.revisionRounds.select.notes, true);
});

test('the public project link always includes tasks waiting on the client, beyond the open-task cap', async (t) => {
  let projectQuery;
  let waitingQuery;
  const open = Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, title: `Open ${i}`, status: 'IN_PROGRESS', priority: 'HIGH', category: 'UPCOMING', dueDate: null }));
  const waiting = [{ id: 'w1', title: 'Approve the logo', status: 'WAITING_CLIENT', priority: 'LOW', category: 'WAITING_CLIENT', dueDate: null }];
  const prisma = {
    project: {
      findFirst: async (args) => {
        projectQuery = args;
        return { id: 'project-1', name: 'Website', description: null, status: 'DESIGN_DEV', updatedAt: new Date(), client: { name: 'Acme' }, revisionRounds: [], milestones: [], tasks: open };
      },
    },
    task: { findMany: async (args) => { waitingQuery = args; return waiting; } },
  };
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(portalRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/view-token-1' });
  assert.equal(response.statusCode, 200, response.body);
  // The capped list leaves waiting tasks out; they come from their own query.
  assert.deepEqual(projectQuery.select.tasks.where, { status: { notIn: ['COMPLETED', 'WAITING_CLIENT'] } });
  assert.equal(projectQuery.select.tasks.take, 20);
  assert.deepEqual(waitingQuery.where, { projectId: 'project-1', status: 'WAITING_CLIENT' });
  assert.deepEqual(waitingQuery.select, projectQuery.select.tasks.select, 'the same client-safe fields');
  const tasks = response.json().activeTasks;
  assert.equal(tasks.length, 21);
  assert.equal(tasks.filter((task) => task.status === 'WAITING_CLIENT').length, 1);
  assert.equal(tasks[0].title, 'Approve the logo');
});

test('the public project link answers 404 for a trashed or cancelled project', async (t) => {
  const prisma = { project: { findFirst: async () => null } };
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(portalRoutes);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/view-token-1' });
  assert.equal(response.statusCode, 404);
});

/** A client-portal app whose principal resolves to client-1's contact. */
async function clientPortalApp(t, prisma) {
  const { default: clientPortalRoutes } = await import('../../routes/client-portal.routes.js');
  const { signUserSession } = await import('../../auth/session.js');
  const user = { id: 'client-user-1', role: 'CLIENT', clientId: 'client-1', organizationId: 'org-1', sessionVersion: 0, isActive: true, email: 'c@example.com', name: 'C' };
  Object.assign(prisma, {
    user: { findUnique: async () => user, findFirst: async () => user },
    contact: { findFirst: async () => ({ id: 'contact-1', clientId: 'client-1', email: 'c@example.com', client: { id: 'client-1', organizationId: 'org-1', status: 'ACTIVE', deletedAt: null } }), findUnique: async () => ({ id: 'contact-1', clientId: 'client-1', email: 'c@example.com', client: { id: 'client-1', organizationId: 'org-1', status: 'ACTIVE', deletedAt: null } }) },
    client: { findUnique: async () => ({ id: 'client-1', organizationId: 'org-1', status: 'ACTIVE', deletedAt: null }), findFirst: async () => ({ id: 'client-1', organizationId: 'org-1', status: 'ACTIVE', deletedAt: null }) },
  });
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(jwt, { secret: 'client-portal-exposure', cookie: { cookieName: 'token', signed: false } });
  app.decorate('io', { to: () => ({ emit: () => {} }) });
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
  await app.ready();
  t.after(() => app.close());
  const token = signUserSession(app.jwt, user, { contactId: 'contact-1' });
  return (url) => app.inject({ method: 'GET', url: `/api/client-portal${url}`, headers: { authorization: `Bearer ${token}` } });
}

test('signed-in client portal project views never select health or the AI summary', async (t) => {
  const selects = [];
  const prisma = {
    project: {
      findMany: async ({ select }) => { selects.push(select); return [{ id: 'p-1', name: 'Website', _count: { tasks: 0 } }]; },
      findFirst: async ({ select }) => { selects.push(select); return { id: 'p-1', name: 'Website', _count: { tasks: 0 } }; },
    },
    task: { groupBy: async () => [], count: async () => 0 },
  };
  const get = await clientPortalApp(t, prisma);
  const list = await get('/projects');
  const detail = await get('/projects/p-1');
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(selects.length, 2);
  for (const select of selects) {
    assert.equal('health' in select, false);
    assert.equal('aiSummary' in select, false);
  }
});

test('the client task board selects client-safe fields only', async (t) => {
  let taskQuery;
  const prisma = {
    project: { findFirst: async () => ({ id: 'p-1', clientId: 'client-1' }) },
    task: { findMany: async (args) => { taskQuery = args; return [{ id: 't-1', title: 'Approve copy', status: 'WAITING_CLIENT' }]; } },
  };
  const get = await clientPortalApp(t, prisma);
  const response = await get('/projects/p-1/tasks');
  assert.equal(response.statusCode, 200, response.body);
  for (const field of ['description', 'assigneeId', 'position', 'createdAt']) {
    assert.equal(field in taskQuery.select, false, `${field} is not selected`);
  }
  assert.deepEqual(taskQuery.select.assignee, { select: { name: true } }, 'the assignee name only, never the account id');
  assert.deepEqual(response.json().columns.WAITING_CLIENT.map((task) => task.id), ['t-1']);
});
