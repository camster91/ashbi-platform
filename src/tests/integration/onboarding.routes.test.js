import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import onboardingRoutes, { tasksForRole } from '../../routes/onboarding.routes.js';

function createStore() {
  const progress = new Map();
  const facts = new Map();
  const pages = [];
  const factsFor = userId => facts.get(userId) || {};

  return {
    progress,
    facts,
    pages,
    prismaFor(user) {
      const model = {
        findFirst: async ({ where }) => progress.get(where.userId) || null,
        create: async ({ data }) => {
          const record = {
            id: `progress-${data.userId}`,
            organizationId: user.organizationId,
            startedAt: null,
            dismissedAt: null,
            completedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          progress.set(data.userId, record);
          return record;
        },
        update: async ({ where, data }) => {
          const current = progress.get(where.userId);
          const record = { ...current, ...data, updatedAt: new Date() };
          progress.set(where.userId, record);
          return record;
        },
      };
      return {
        onboardingProgress: model,
        user: { findFirst: async () => factsFor(user.id).inactive ? null : ({ ...user, isActive: true }) },
        client: { count: async () => factsFor(user.id).clients || 0 },
        project: { count: async () => factsFor(user.id).projects || 0 },
        proposal: { count: async () => factsFor(user.id).proposals || 0 },
        task: { count: async () => factsFor(user.id).tasks || 0 },
        timeEntry: { count: async () => factsFor(user.id).timeEntries || 0 },
        note: { findMany: async () => Array.from({ length: factsFor(user.id).notes || 0 }, (_, index) => ({ id: 'onboarding-note-' + index, projectId: 'project', authorId: user.id, parentId: null, accessMode: 'TEAM', accessGrants: [], deletedAt: null })) },
        workspacePage: { findMany: async ({ where, take }) => pages.filter(page =>
          page.organizationId === where.organizationId
          && (!where.authorId || page.authorId === where.authorId)
          && (!Object.hasOwn(where, 'archivedAt') || page.archivedAt === where.archivedAt)
          && (!where.id?.in || where.id.in.includes(page.id))
          && (!where.id?.gt || page.id > where.id.gt)
        ).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(page => ({
          ...page, grants: (page.grants || []).filter(grant => grant.userId === user.id),
        })) },
      };
    },
  };
}

async function buildApp(store) {
  const users = {
    adminA: { id: 'admin-a', organizationId: 'org-a', role: 'ADMIN' },
    adminB: { id: 'admin-b', organizationId: 'org-a', role: 'ADMIN' },
    adminAasTeam: { id: 'admin-a', organizationId: 'org-a', role: 'TEAM' },
    teamA: { id: 'team-a', organizationId: 'org-a', role: 'TEAM' },
    clientA: { id: 'client-a', organizationId: 'org-a', role: 'CLIENT' },
  };
  const app = Fastify();
  app.decorate('authenticate', async request => {
    request.user = users[request.headers['x-test-user'] || 'adminA'];
  });
  app.addHook('preHandler', async request => {
    if (request.user) request.prisma = store.prismaFor(request.user);
  });
  await app.register(onboardingRoutes, { prefix: '/api/onboarding' });
  return app;
}

test('onboarding progress is role-specific, account-scoped, resumable, and success-derived', async () => {
  const store = createStore();
  const app = await buildApp(store);
  try {
    const eligible = await app.inject({ method: 'GET', url: '/api/onboarding/progress' });
    assert.equal(eligible.statusCode, 200);
    assert.equal(eligible.json().state, 'eligible');
    assert.deepEqual(eligible.json().tasks.map(task => task.id), tasksForRole('ADMIN').map(task => task.id));

    const started = await app.inject({ method: 'POST', url: '/api/onboarding/progress/start' });
    assert.equal(started.json().state, 'in_progress');

    const skipped = await app.inject({
      method: 'POST',
      url: '/api/onboarding/progress/tasks/skip',
      payload: { taskId: 'add-client' },
    });
    assert.equal(skipped.json().completedCount, 1);
    assert.equal(skipped.json().tasks.find(task => task.id === 'add-client').skipped, true);

    const otherAccount = await app.inject({
      method: 'GET', url: '/api/onboarding/progress', headers: { 'x-test-user': 'adminB' },
    });
    assert.equal(otherAccount.json().state, 'eligible');
    assert.equal(otherAccount.json().completedCount, 0);

    const changedRole = await app.inject({
      method: 'GET', url: '/api/onboarding/progress', headers: { 'x-test-user': 'adminAasTeam' },
    });
    assert.equal(changedRole.json().role, 'TEAM');
    assert.equal(changedRole.json().state, 'eligible');
    assert.equal(changedRole.json().tasks.some(task => task.skipped), false);

    // Restore the current role for the remainder of this account's journey.
    await app.inject({ method: 'GET', url: '/api/onboarding/progress' });

    store.facts.set('admin-a', { clients: 1, projects: 1, proposals: 1 });
    const completed = await app.inject({ method: 'GET', url: '/api/onboarding/progress' });
    assert.equal(completed.json().state, 'completed');
    assert.ok(completed.json().completedAt);

    const restarted = await app.inject({ method: 'POST', url: '/api/onboarding/progress/restart' });
    assert.equal(restarted.json().state, 'eligible');
    assert.equal(restarted.json().tasks.find(task => task.id === 'add-client').skipped, false);
    assert.equal(restarted.json().completedAt, null);
  } finally {
    await app.close();
  }
});

test('team members never receive admin tasks and client onboarding is explicitly deferred', async () => {
  const store = createStore();
  store.facts.set('team-a', { tasks: 1, timeEntries: 1, notes: 1 });
  const app = await buildApp(store);
  try {
    const team = await app.inject({
      method: 'GET', url: '/api/onboarding/progress', headers: { 'x-test-user': 'teamA' },
    });
    assert.equal(team.json().role, 'TEAM');
    assert.deepEqual(team.json().tasks.map(task => task.id), ['complete-task', 'log-time', 'create-document']);
    assert.equal(team.json().state, 'completed');

    const client = await app.inject({
      method: 'GET', url: '/api/onboarding/progress', headers: { 'x-test-user': 'clientA' },
    });
    assert.equal(client.json().supported, false);
    assert.equal(client.json().state, 'deferred');
    assert.match(client.json().reason, /#286/);

    const clientStart = await app.inject({
      method: 'POST', url: '/api/onboarding/progress/start', headers: { 'x-test-user': 'clientA' },
    });
    assert.equal(clientStart.statusCode, 409);
  } finally {
    await app.close();
  }
});

test('invalid or cross-role task skips fail closed', async () => {
  const store = createStore();
  const app = await buildApp(store);
  try {
    const wrongRole = await app.inject({
      method: 'POST',
      url: '/api/onboarding/progress/tasks/skip',
      headers: { 'x-test-user': 'teamA' },
      payload: { taskId: 'add-client' },
    });
    assert.equal(wrongRole.statusCode, 404);

    const malformed = await app.inject({
      method: 'POST', url: '/api/onboarding/progress/tasks/skip', payload: { taskId: '../admin' },
    });
    assert.equal(malformed.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('team document onboarding accepts a currently readable authored wiki page without notes', async () => {
  const store = createStore();
  store.pages.push({ id: 'wiki-a', organizationId: 'org-a', authorId: 'team-a', parentId: null, accessMode: 'TEAM', archivedAt: null });
  const app = await buildApp(store);
  try {
    const response = await app.inject({ method: 'GET', url: '/api/onboarding/progress', headers: { 'x-test-user': 'teamA' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().tasks.find(task => task.id === 'create-document').completed, true);
  } finally {
    await app.close();
  }
});

test('team document onboarding excludes foreign, archived, other-author and ancestor-hidden wiki pages', async () => {
  const store = createStore();
  store.pages.push(
    { id: 'foreign', organizationId: 'org-b', authorId: 'team-a', parentId: null, accessMode: 'TEAM', archivedAt: null },
    { id: 'archived', organizationId: 'org-a', authorId: 'team-a', parentId: null, accessMode: 'TEAM', archivedAt: new Date() },
    { id: 'other-author', organizationId: 'org-a', authorId: 'admin-a', parentId: null, accessMode: 'TEAM', archivedAt: null },
    { id: 'private-parent', organizationId: 'org-a', authorId: 'admin-a', parentId: null, accessMode: 'RESTRICTED', archivedAt: null },
    { id: 'hidden-child', organizationId: 'org-a', authorId: 'team-a', parentId: 'private-parent', accessMode: 'TEAM', archivedAt: null },
  );
  const app = await buildApp(store);
  try {
    const response = await app.inject({ method: 'GET', url: '/api/onboarding/progress', headers: { 'x-test-user': 'teamA' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().tasks.find(task => task.id === 'create-document').completed, false);
    assert.equal(JSON.stringify(response.json()).includes('hidden-child'), false);
  } finally {
    await app.close();
  }
});

test('wiki onboarding follows current ancestor access grants and their revocation', async () => {
  const store = createStore();
  const parent = { id: 'parent', organizationId: 'org-a', authorId: 'admin-a', parentId: null, accessMode: 'RESTRICTED', archivedAt: null, grants: [{ userId: 'team-a', role: 'READ' }] };
  store.pages.push(parent, { id: 'child', organizationId: 'org-a', authorId: 'team-a', parentId: parent.id, accessMode: 'TEAM', archivedAt: null });
  const app = await buildApp(store);
  try {
    const readCompletion = async () => {
      const response = await app.inject({ method: 'GET', url: '/api/onboarding/progress', headers: { 'x-test-user': 'teamA' } });
      assert.equal(response.statusCode, 200);
      return response.json().tasks.find(task => task.id === 'create-document').completed;
    };
    assert.equal(await readCompletion(), true);
    parent.grants = [];
    assert.equal(await readCompletion(), false);
  } finally {
    await app.close();
  }
});

test('wiki onboarding reaches a visible authored page after a full batch of hidden children', async () => {
  const store = createStore();
  store.pages.push({ id: 'parent', organizationId: 'org-a', authorId: 'admin-a', parentId: null, accessMode: 'RESTRICTED', archivedAt: null });
  for (let index = 0; index < 100; index++) {
    store.pages.push({ id: `hidden-${String(index).padStart(3, '0')}`, organizationId: 'org-a', authorId: 'team-a', parentId: 'parent', accessMode: 'TEAM', archivedAt: null });
  }
  store.pages.push({ id: 'visible', organizationId: 'org-a', authorId: 'team-a', parentId: null, accessMode: 'TEAM', archivedAt: null });
  const app = await buildApp(store);
  try {
    const response = await app.inject({ method: 'GET', url: '/api/onboarding/progress', headers: { 'x-test-user': 'teamA' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().tasks.find(task => task.id === 'create-document').completed, true);
  } finally {
    await app.close();
  }
});

test('inactive staff cannot complete onboarding through an authored wiki page', async () => {
  const store = createStore();
  store.facts.set('team-a', { inactive: true });
  store.pages.push({ id: 'wiki-a', organizationId: 'org-a', authorId: 'team-a', parentId: null, accessMode: 'TEAM', archivedAt: null });
  const app = await buildApp(store);
  try {
    const response = await app.inject({ method: 'GET', url: '/api/onboarding/progress', headers: { 'x-test-user': 'teamA' } });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().tasks, undefined);
  } finally {
    await app.close();
  }
});
