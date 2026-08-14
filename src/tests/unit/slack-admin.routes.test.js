import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import slackAdminRoutes from '../../routes/slack.routes.js';

async function buildApp(prisma, options = {}) {
  const app = Fastify();
  await app.register(jwt, { secret: 'test-jwt-secret' });
  app.decorate('prisma', prisma);
  app.decorate('authenticate', async (request) => { request.user = { id: 'admin-1', role: 'ADMIN', organizationId: 'org-1' }; });
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

test('starts OAuth with signed short-lived tenant state and least-privilege bot scopes', async (t) => {
  const app = await buildApp({}, {
    slackClientId: 'client-1', slackClientSecret: 'client-secret', slackRedirectUri: 'https://hub.example/api/slack/oauth/callback',
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/oauth/start' });
  const url = new URL(response.headers.location);

  assert.equal(response.statusCode, 302);
  assert.equal(url.origin, 'https://slack.com');
  assert.equal(url.searchParams.get('scope'), 'channels:history,chat:write');
  const state = app.jwt.verify(url.searchParams.get('state'));
  assert.equal(state.type, 'slack_oauth');
  assert.equal(state.organizationId, 'org-1');
  assert.equal(state.userId, 'admin-1');
  assert.equal(typeof state.iat, 'number');
  assert.equal(typeof state.exp, 'number');
});

test('exchanges a valid OAuth callback code, stores an encrypted bot token, and returns to Settings', async (t) => {
  let stored;
  const app = await buildApp({
    slackInstallation: { findFirst: async () => null, create: async ({ data }) => { stored = data; return { id: 'installation-1', ...data }; } },
  }, {
    slackClientId: 'client-1', slackClientSecret: 'client-secret', slackRedirectUri: 'https://hub.example/api/slack/oauth/callback',
    encryptSecret: (value) => `encrypted:${value}`,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, access_token: 'xoxb-sensitive', bot_user_id: 'U1', scope: 'channels:history,chat:write', team: { id: 'T1', name: 'Acme' } }) }),
  });
  t.after(() => app.close());
  const state = app.jwt.sign({ type: 'slack_oauth', organizationId: 'org-1', userId: 'admin-1' }, { expiresIn: '10m' });

  const response = await app.inject({ method: 'GET', url: `/oauth/callback?code=code-1&state=${encodeURIComponent(state)}` });

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/settings?slack=connected');
  assert.equal(stored.organizationId, 'org-1');
  assert.equal(stored.botTokenEncrypted, 'encrypted:xoxb-sensitive');
  assert.deepEqual(JSON.parse(stored.scopes), ['channels:history', 'chat:write']);
});

test('lists safe parsed scope names without returning the encrypted Slack token', async (t) => {
  const app = await buildApp({
    slackInstallation: {
      findMany: async () => [{ id: 'installation-1', teamId: 'T1', scopes: '["channels:history","chat:write"]', botTokenEncrypted: 'ciphertext', channelMappings: [] }],
    },
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().installations[0].scopes, ['channels:history', 'chat:write']);
  assert.equal(response.json().installations[0].botTokenEncrypted, undefined);
});
