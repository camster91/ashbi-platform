import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import chatRoutes from '../../routes/chat.routes.js';

test('chat reply creation rejects a parent message from another project', async () => {
  let created = false;
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'c123456789012345678901234', name: 'Avery', organizationId: 'org-a', role: 'TEAM' };
  });
  app.decorate('notify', () => {});
  app.decorate('io', { to: () => ({ emit: () => {} }) });
  app.decorate('prisma', {
    project: { findFirst: async () => ({ id: 'c123456789012345678901235' }) },
    chatMessage: {
      findFirst: async ({ where }) => where.id === 'c123456789012345678901236' ? null : null,
      create: async () => { created = true; return {}; },
    },
    activity: { create: async () => ({}) },
    user: { findMany: async () => [] },
  });
  app.addHook('onRequest', async (request) => { request.prisma = app.prisma; });
  await app.register(chatRoutes, { prefix: '/api' });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/c123456789012345678901235/messages',
      payload: { content: 'Reply', parentId: 'c123456789012345678901236' },
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.match(response.json().error, /same project/i);
    assert.equal(created, false);
  } finally {
    await app.close();
  }
});

test('chat message reads scope included replies to the requested project', async () => {
  const calls = [];
  const raw = [];
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'c123456789012345678901234', name: 'Avery', organizationId: 'org-a', role: 'TEAM' };
  });
  app.decorate('prisma', {
    project: { findFirst: async ({ where }) => ({ id: where.id }) },
    // Thread activity comes from one grouped query scoped by project.
    $queryRaw: async (strings, ...values) => { raw.push(values); return [{ rootId: 'c123456789012345678901299' }]; },
    chatMessage: {
      findMany: async (args) => { calls.push(args); return []; },
    },
  });
  app.addHook('onRequest', async (request) => { request.prisma = app.prisma; });
  await app.register(chatRoutes, { prefix: '/api' });

  try {
    const projectId = 'c123456789012345678901235';
    const response = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/messages` });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(raw[0][0], projectId, 'thread activity is read within the project');
    assert.equal(calls[0].where.projectId, projectId);
    assert.deepEqual(calls[0].include.replies.where, { projectId });
  } finally {
    await app.close();
  }
});

test('chat message reads answer 404 for a project outside the tenant', async () => {
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'c123456789012345678901234', name: 'Avery', organizationId: 'org-a', role: 'TEAM' };
  });
  let rawCalled = false;
  app.decorate('prisma', {
    project: { findFirst: async () => null },
    $queryRaw: async () => { rawCalled = true; return []; },
    chatMessage: { findMany: async () => [] },
  });
  app.addHook('onRequest', async (request) => { request.prisma = app.prisma; });
  await app.register(chatRoutes, { prefix: '/api' });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/projects/c123456789012345678901235/messages' });
    assert.equal(response.statusCode, 404);
    assert.equal(rawCalled, false, 'no raw query before the tenant check');
  } finally {
    await app.close();
  }
});

test('chat message reads tolerate malformed legacy metadata', async () => {
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'c123456789012345678901234', name: 'Avery', organizationId: 'org-a', role: 'TEAM' };
  });
  app.decorate('prisma', {
    project: { findFirst: async ({ where }) => ({ id: where.id }) },
    $queryRaw: async () => [{ rootId: 'c123456789012345678901236' }],
    chatMessage: {
      findMany: async () => [{ id: 'c123456789012345678901236', content: 'Legacy message', metadata: '{not-json}' }],
    },
  });
  app.addHook('onRequest', async (request) => { request.prisma = app.prisma; });
  await app.register(chatRoutes, { prefix: '/api' });

  try {
    const response = await app.inject({ method: 'GET', url: '/api/projects/c123456789012345678901235/messages' });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json()[0].metadata, null);
  } finally {
    await app.close();
  }
});
