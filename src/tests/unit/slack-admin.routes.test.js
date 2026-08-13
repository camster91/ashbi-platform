import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import slackAdminRoutes from '../../routes/slack.routes.js';

async function buildApp(prisma, options = {}) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'admin-1', role: 'ADMIN' }; });
  app.decorate('adminOnly', async (request, reply) => {
    if (request.user?.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
  });
  app.addHook('preHandler', async (request) => {
    request.prisma = prisma;
  });
  await app.register(slackAdminRoutes, options);
  return app;
}

test('an organization administrator stores a Slack bot token encrypted', async (t) => {
  let created;
  const app = await buildApp({
    slackInstallation: {
      findFirst: async () => null,
      create: async ({ data }) => { created = data; return { id: 'installation-1', ...data }; },
    },
  }, { encryptSecret: (value) => `encrypted:${value}` });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST', url: '/install',
    payload: { teamId: 'T123', teamName: 'Acme', botToken: 'xoxb-plain-text-token', scopes: ['channels:history'] },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(created.teamId, 'T123');
  assert.notEqual(created.botTokenEncrypted, 'xoxb-plain-text-token');
  assert.deepEqual(JSON.parse(created.scopes), ['channels:history']);
  assert.equal(response.json().botTokenEncrypted, undefined);
});

test('an administrator can map only an in-tenant project to a Slack channel', async (t) => {
  let mapping;
  const app = await buildApp({
    slackInstallation: { findFirst: async () => ({ id: 'installation-1', status: 'ACTIVE' }) },
    project: { findFirst: async () => ({ id: 'project-1' }) },
    slackChannelMapping: {
      findFirst: async () => null,
      create: async ({ data }) => { mapping = data; return { id: 'mapping-1', ...data }; },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST', url: '/installations/installation-1/mappings',
    payload: { projectId: 'project-1', channelId: 'C123', channelName: 'project-acme' },
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(mapping, { installationId: 'installation-1', projectId: 'project-1', channelId: 'C123', channelName: 'project-acme', inboundEnabled: true, outboundEnabled: false });
});
