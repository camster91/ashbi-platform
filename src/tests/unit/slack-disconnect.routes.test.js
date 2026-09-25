import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import slackAdminRoutes from '../../routes/slack.routes.js';

async function buildApp(prisma, options = {}) {
  const logs = [];
  const stream = new Writable({ write(chunk, _encoding, done) { logs.push(chunk.toString()); done(); } });
  const app = Fastify({ logger: { level: 'warn', stream } });
  await app.register(jwt, { secret: 'test-jwt-secret' });
  app.decorate('prisma', prisma);
  app.decorate('authenticate', async (request) => { request.user = { id: 'admin-1', role: 'ADMIN', organizationId: 'org-1' }; });
  app.decorate('adminOnly', async () => {});
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(slackAdminRoutes, options);
  return { app, logs };
}

function installationStore(initial) {
  const state = { ...initial };
  return {
    state,
    prisma: {
      slackInstallation: {
        findFirst: async () => ({ ...state }),
        update: async ({ data }) => { Object.assign(state, data); return { ...state }; },
      },
    },
  };
}

test('disconnect revokes the bot token with Slack before clearing it locally', async (t) => {
  const store = installationStore({ id: 'installation-1', status: 'ACTIVE', botTokenEncrypted: 'ciphertext' });
  let revokedToken;
  const { app } = await buildApp(store.prisma, {
    decryptSecret: (value) => (value === 'ciphertext' ? 'xoxb-sensitive' : null),
    revokeSlackToken: async ({ botToken }) => { revokedToken = botToken; return { revoked: true }; },
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/installations/installation-1/disconnect' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, tokenRevoked: true });
  assert.equal(revokedToken, 'xoxb-sensitive');
  assert.equal(store.state.status, 'DISCONNECTED');
  assert.equal(store.state.botTokenEncrypted, null);
});

test('disconnect still completes locally when Slack revocation fails, without logging the token', async (t) => {
  const store = installationStore({ id: 'installation-1', status: 'ACTIVE', botTokenEncrypted: 'ciphertext' });
  const { app, logs } = await buildApp(store.prisma, {
    decryptSecret: () => 'xoxb-sensitive',
    revokeSlackToken: async ({ botToken }) => { throw new Error(`network down for ${botToken}`); },
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/installations/installation-1/disconnect' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, tokenRevoked: false });
  assert.equal(store.state.status, 'DISCONNECTED');
  assert.equal(store.state.botTokenEncrypted, null);
  assert.ok(logs.some((line) => line.includes('SLACK_REVOKE_FAILED')));
  assert.ok(logs.every((line) => !line.includes('xoxb-sensitive')));
});

test('disconnecting an already-disconnected installation does not call Slack', async (t) => {
  const store = installationStore({ id: 'installation-1', status: 'DISCONNECTED', botTokenEncrypted: null });
  let called = false;
  const { app } = await buildApp(store.prisma, { revokeSlackToken: async () => { called = true; } });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/installations/installation-1/disconnect' });

  assert.equal(response.statusCode, 200);
  assert.equal(called, false);
});
