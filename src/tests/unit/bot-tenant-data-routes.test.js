import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import botRoutes from '../../routes/bot.routes.js';
import env from '../../config/env.js';
import { prisma as basePrisma } from '../../config/db.js';
import { enterRequestContext, getRequestPrisma } from '../../utils/request-context.js';

async function botApp(t) {
  const previousClient = globalThis.ashbiRawPrisma;
  const previousEnv = { botSecret: env.botSecret, botOrganizationId: env.botOrganizationId };
  const writes = [];
  const reads = [];
  const ownProject = ({ where }) => where.id === 'project-a' && where.organizationId === 'org-a'
    ? { id: 'project-a', organizationId: 'org-a' } : null;
  globalThis.ashbiRawPrisma = {
    project: {
      findUnique: async (args) => ownProject(args),
      findFirst: async (args) => ownProject(args),
      findMany: async (args) => { reads.push(['project', args]); return []; },
    },
    client: { findMany: async (args) => { reads.push(['client', args]); return []; } },
    task: { findMany: async (args) => { reads.push(['task', args]); return []; } },
    user: { findFirst: async () => null },
    approval: { create: async ({ data }) => { writes.push(data); return { id: 'approval-a', ...data }; } },
  };
  env.botSecret = 'bot-tenant-regression-secret';
  env.botOrganizationId = 'org-a';
  const app = Fastify();
  // Match production's context-resolving decoration, not a plain mock object.
  app.decorate('prisma', new Proxy({}, { get(_target, prop) {
    const client = getRequestPrisma();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  } }));
  app.addHook('onRequest', async () => { enterRequestContext({ prisma: basePrisma, organizationId: null }); });
  await app.register(botRoutes, { prefix: '/api/bot' });
  await app.ready();
  Object.assign(env, previousEnv);
  t.after(async () => { await app.close(); globalThis.ashbiRawPrisma = previousClient; });
  const inject = (request) => app.inject({ ...request, headers: { authorization: 'Bearer bot-tenant-regression-secret' } });
  return { inject, writes, reads };
}

test('authenticated bot data reads work with production Prisma decoration and remain tenant-scoped', async (t) => {
  const { inject, reads } = await botApp(t);
  const response = await inject({ method: 'GET', url: '/api/bot/sync' });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(reads.length, 3);
  for (const [model, args] of reads) {
    if (model === 'task') assert.equal(args.where.AND[1].project.client.organizationId, 'org-a');
    else assert.equal(args.where.organizationId, 'org-a');
  }
});

const draft = { type: 'EMAIL', title: 'Review draft', content: 'Example', createdBy: 'agent' };

test('bot approval requires a project and creates no ownerless record', async (t) => {
  const { inject, writes } = await botApp(t);
  for (const projectId of [undefined, null, '', '   ', 42]) {
    const response = await inject({ method: 'POST', url: '/api/bot/approvals', payload: { ...draft, projectId } });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(writes.length, 0);
});

test('bot approval refuses a foreign or missing project without a write', async (t) => {
  const { inject, writes } = await botApp(t);
  const response = await inject({ method: 'POST', url: '/api/bot/approvals', payload: { ...draft, projectId: 'foreign-project' } });
  assert.equal(response.statusCode, 404, response.body);
  assert.equal(writes.length, 0);
});

test('bot approval for its organization project persists and returns its reference', async (t) => {
  const { inject, writes } = await botApp(t);
  const response = await inject({ method: 'POST', url: '/api/bot/approvals', payload: { ...draft, projectId: 'project-a' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().id, 'approval-a');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].projectId, 'project-a');
});
