import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';

// env.js reads these at import time.
process.env.ADMIN_INVITE_TOKEN = 'bootstrap-invite';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';
const { default: authRoutes } = await import('../../routes/auth.routes.js');

function fakeDatabase({ users = [], organizations = [] } = {}) {
  const db = { users: [...users], organizations: [...organizations], transactions: 0 };
  const organization = {
    findUnique: async ({ where }) => db.organizations.find((org) => org.slug === where.slug) ?? null,
    create: async ({ data }) => {
      const org = { id: `org-${db.organizations.length + 1}`, ...data };
      db.organizations.push(org);
      return org;
    },
  };
  const pick = (row, select) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key] ?? null]));
  const user = {
    count: async () => db.users.length,
    findUnique: async ({ where }) => db.users.find((row) => row.email === where.email) ?? null,
    create: async ({ data, select }) => {
      if (!data.organizationId) throw new Error('Argument `organization` is missing.');
      const row = { id: `user-${db.users.length + 1}`, ...data };
      db.users.push(row);
      return pick(row, select);
    },
  };
  db.client = {
    organization,
    user,
    $transaction: async (fn) => { db.transactions += 1; return fn({ organization, user }); },
  };
  return db;
}

async function buildApp(t, db) {
  const app = Fastify();
  await app.register(fastifyJwt, { secret: 'unit-test-secret' });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', db.client);
  app.addHook('onRequest', async (request) => { request.prisma = db.client; });
  await app.register(authRoutes);
  t.after(() => app.close());
  return app;
}

const ADMIN = { email: 'founder@agency.test', password: 'Bootstrap-Passw0rd!', name: 'Robin Founder', adminInviteToken: 'bootstrap-invite' };

test('the first registration creates the admin together with their organization', async (t) => {
  const db = fakeDatabase();
  const app = await buildApp(t, db);

  const response = await app.inject({ method: 'POST', url: '/register', payload: { ...ADMIN, organizationName: 'Northwind Studio' } });

  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  assert.equal(body.role, 'ADMIN');
  assert.equal(body.password, undefined);
  assert.equal(db.transactions, 1);
  assert.equal(db.organizations.length, 1);
  assert.deepEqual(
    { name: db.organizations[0].name, slug: db.organizations[0].slug },
    { name: 'Northwind Studio', slug: 'northwind-studio' },
  );
  assert.equal(body.organizationId, db.organizations[0].id);
});

test('without a workspace name the bootstrap organization is named after the admin', async (t) => {
  const db = fakeDatabase({ organizations: [{ id: 'taken', name: 'x', slug: 'robin-founder-s-workspace' }] });
  const app = await buildApp(t, db);

  const response = await app.inject({ method: 'POST', url: '/register', payload: ADMIN });

  assert.equal(response.statusCode, 201, response.body);
  const created = db.organizations.at(-1);
  assert.equal(created.name, "Robin Founder's workspace");
  assert.match(created.slug, /^robin-founder-s-workspace-[0-9a-f]{6}$/, 'a taken slug gets a random suffix');
});

test('the bootstrap still requires the admin invite token', async (t) => {
  const db = fakeDatabase();
  const app = await buildApp(t, db);

  const response = await app.inject({ method: 'POST', url: '/register', payload: { ...ADMIN, adminInviteToken: 'wrong' } });

  assert.equal(response.statusCode, 403);
  assert.equal(db.organizations.length, 0);
  assert.equal(db.users.length, 0);
});
