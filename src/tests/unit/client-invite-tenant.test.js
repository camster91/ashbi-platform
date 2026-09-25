import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { default: authRoutes } = await import('../../routes/auth.routes.js');

const clients = [
  { id: 'client-a', organizationId: 'org-a', name: 'Org A client' },
  { id: 'client-b', organizationId: 'org-b', name: 'Org B client' },
];

async function buildApp(t, user) {
  const invitations = [];
  // /api/auth is tenancy-exempt, so the handler receives an unscoped client
  // that can see every organization's clients.
  const prisma = {
    client: {
      findUnique: async ({ where }) => clients.find((c) => c.id === where.id) ?? null,
      findFirst: async ({ where }) => clients.find((c) => Object.entries(where).every(([k, v]) => c[k] === v)) ?? null,
    },
    clientInvitation: {
      findFirst: async () => null,
      create: async ({ data }) => { invitations.push(data); return { id: `invite-${invitations.length}`, ...data }; },
    },
  };
  const app = Fastify();
  await app.register(fastifyCookie);
  await app.register(rateLimit, { global: false });
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET });
  app.decorate('prisma', prisma);
  app.decorate('authenticate', async (request) => { request.user = user; });
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(authRoutes);
  t.after(() => app.close());
  return { app, invitations };
}

describe('client invitations stay inside the admin\'s organization', () => {
  const admin = { id: 'admin-b', role: 'ADMIN', organizationId: 'org-b' };

  it('refuses to invite to another organization\'s client', async (t) => {
    const { app, invitations } = await buildApp(t, admin);
    const res = await app.inject({ method: 'POST', url: '/admin/clients/client-a/invite', payload: { email: 'attacker@example.com' } });
    assert.equal(res.statusCode, 404);
    assert.equal(invitations.length, 0);
  });

  it('invites to the admin\'s own client', async (t) => {
    const { app, invitations } = await buildApp(t, admin);
    const res = await app.inject({ method: 'POST', url: '/admin/clients/client-b/invite', payload: { email: 'contact@example.com' } });
    assert.ok(res.statusCode < 300, res.body);
    assert.equal(invitations.length, 1);
    assert.equal(invitations[0].clientId, 'client-b');
  });
});
