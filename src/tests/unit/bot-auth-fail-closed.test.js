import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';

const { default: botRoutes } = await import('../../routes/bot.routes.js');
const { default: env } = await import('../../config/env.js');

async function buildApp({ botSecret, botOrganizationId }) {
  const previous = { botSecret: env.botSecret, botOrganizationId: env.botOrganizationId };
  env.botSecret = botSecret;
  env.botOrganizationId = botOrganizationId;
  const app = Fastify();
  await app.register(fastifyJwt, { secret: 'unit-test-secret-at-least-32-characters' });
  app.decorate('prisma', {});
  app.addHook('onRequest', async (request) => { request.prisma = {}; });
  try {
    await app.register(botRoutes, { prefix: '/api/bot' });
    await app.ready();
  } finally {
    Object.assign(env, previous);
  }
  return app;
}

describe('bot bearer auth fails closed without BOT_SECRET', () => {
  it('does not issue a bot token for "Bearer undefined"', async () => {
    const app = await buildApp({ botSecret: undefined, botOrganizationId: 'org-bot' });
    const res = await app.inject({ method: 'POST', url: '/api/bot/auth', headers: { authorization: 'Bearer undefined' } });
    await app.close();
    assert.equal(res.statusCode, 401);
  });

  it('refuses guarded bot routes for "Bearer undefined"', async () => {
    const app = await buildApp({ botSecret: undefined, botOrganizationId: 'org-bot' });
    const res = await app.inject({ method: 'GET', url: '/api/bot/sync', headers: { authorization: 'Bearer undefined' } });
    await app.close();
    assert.equal(res.statusCode, 401);
  });

  it('still issues a token for the configured secret', async () => {
    const app = await buildApp({ botSecret: 'configured-bot-secret', botOrganizationId: 'org-bot' });
    const res = await app.inject({ method: 'POST', url: '/api/bot/auth', headers: { authorization: 'Bearer configured-bot-secret' } });
    await app.close();
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().token);
  });
});
