import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import aiBridgeRoutes from '../../routes/ai-bridge.routes.js';

async function buildApp(prisma) {
  const app = Fastify();
  app.decorate('prisma', prisma);
  app.decorate('authenticateWithApiKey', async (request) => {
    request.user = { id: 'user-1', organizationId: 'org-1', role: 'TEAM' };
  });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(aiBridgeRoutes);
  return app;
}

test('prepares a task action without creating the task', async (t) => {
  let created;
  const app = await buildApp({
    project: { findFirst: async () => ({ id: 'project-1', name: 'Website' }) },
    aiBridgeAction: {
      findFirst: async () => null,
      create: async ({ data }) => { created = data; return { id: 'action-1', ...data }; },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST', url: '/v1/actions/prepare',
    payload: { action: 'create_task', idempotencyKey: 'task-website-homepage-1', input: { projectId: 'project-1', title: 'Draft homepage copy', priority: 'HIGH' } },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(created.status, 'PENDING_CONFIRMATION');
  assert.equal(created.userId, 'user-1');
  assert.equal(created.organizationId, 'org-1');
  assert.equal(created.action, 'create_task');
  assert.equal(created.input.title, 'Draft homepage copy');
  assert.equal(response.json().action.status, 'PENDING_CONFIRMATION');
});

test('confirms a prepared task exactly once and stores its result', async (t) => {
  let taskCreated;
  let actionUpdated;
  const pendingAction = {
    id: 'action-1', userId: 'user-1', status: 'PENDING_CONFIRMATION', action: 'create_task',
    input: { projectId: 'project-1', title: 'Draft homepage copy', priority: 'HIGH' }, expiresAt: new Date(Date.now() + 60_000),
  };
  const prisma = {
    $transaction: async (work) => work(prisma),
    aiBridgeAction: {
      findFirst: async () => pendingAction,
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => { actionUpdated = data; return { ...pendingAction, ...data }; },
    },
    project: { findFirst: async () => ({ id: 'project-1', name: 'Website' }) },
    task: { create: async ({ data }) => { taskCreated = data; return { id: 'task-1', ...data }; } },
  };
  const app = await buildApp(prisma);
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/v1/actions/action-1/confirm', payload: { confirm: true } });

  assert.equal(response.statusCode, 200);
  assert.equal(taskCreated.title, 'Draft homepage copy');
  assert.equal(taskCreated.projectId, 'project-1');
  assert.equal(actionUpdated.status, 'EXECUTED');
  assert.deepEqual(actionUpdated.result, { taskId: 'task-1', projectId: 'project-1' });
  assert.equal(response.json().action.result.taskId, 'task-1');
});

test('records a failed action when its confirmed target is unavailable', async (t) => {
  let failure;
  const pendingAction = {
    id: 'action-1', userId: 'user-1', status: 'PENDING_CONFIRMATION', action: 'create_task',
    input: { projectId: 'project-1', title: 'Draft homepage copy' }, expiresAt: new Date(Date.now() + 60_000),
  };
  const app = await buildApp({
    $transaction: async () => { throw new Error('ACTION_TARGET_UNAVAILABLE'); },
    aiBridgeAction: {
      findFirst: async () => pendingAction,
      update: async ({ data }) => { failure = data; return { ...pendingAction, ...data }; },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/v1/actions/action-1/confirm', payload: { confirm: true } });
  assert.equal(response.statusCode, 409);
  assert.equal(failure.status, 'FAILED');
  assert.equal(failure.errorCode, 'ACTION_TARGET_UNAVAILABLE');
  assert.equal(response.json().error.type, 'action_failed');
});
