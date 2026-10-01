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
  const $executeRaw = async (strings) => { db.locks.push(strings.join('?')); return 1; };
  db.locks = [];
  db.client = {
    organization,
    user,
    $transaction: async (fn) => { db.transactions += 1; return fn({ organization, user, $executeRaw }); },
  };
  return db;
}

async function buildApp(t, db) {
  const app = Fastify();
  await app.register(fastifyJwt, { secret: 'unit-test-secret' });
  app.decorate('signFor', (payload) => app.jwt.sign(payload));
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

test('the bootstrap takes an advisory lock and refuses a second concurrent first admin', async (t) => {
  const db = fakeDatabase();
  const app = await buildApp(t, db);
  // Simulate a racing request that committed its admin after our count() but
  // before we acquired the lock.
  const originalCount = db.client.user.count;
  let calls = 0;
  db.client.user.count = async () => (calls++ === 0 ? 0 : 1);
  t.after(() => { db.client.user.count = originalCount; });

  const response = await app.inject({ method: 'POST', url: '/register', payload: ADMIN });

  assert.equal(response.statusCode, 409, response.body);
  assert.equal(db.locks.length, 1);
  assert.match(db.locks[0], /pg_advisory_xact_lock/);
  assert.equal(db.organizations.length, 0);
});

test('an admin registering a later user places them in the admin organization', async (t) => {
  const db = fakeDatabase({
    users: [{ id: 'admin-1', email: 'founder@agency.test', role: 'ADMIN', organizationId: 'org-a', sessionVersion: 0, isActive: true }],
    organizations: [{ id: 'org-a', name: 'Agency', slug: 'agency' }],
  });
  db.client.user.findUnique = async ({ where }) => db.users.find((row) => (where.id ? row.id === where.id : row.email === where.email)) ?? null;
  const app = await buildApp(t, db);
  const token = app.signFor({ typ: 'session', id: 'admin-1', role: 'ADMIN', organizationId: 'org-a', sessionVersion: 0 });

  const response = await app.inject({
    method: 'POST',
    url: '/register',
    headers: { authorization: `Bearer ${token}` },
    payload: { email: 'designer@agency.test', password: 'Designer-Passw0rd!', name: 'Dana Designer', role: 'TEAM' },
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().organizationId, 'org-a');
  assert.equal(db.organizations.length, 1, 'no new organization for later users');
});

// F1 (#416 follow-up): /api/auth is exempt from the global session hook, so
// POST /register identifies its caller in its own onRequest guard. The
// organization MFA requirement (a global preHandler in src/index.js) must see
// the admin whatever case of the `Bearer` scheme @fastify/jwt accepts.
test('the register guard identifies the admin before any preHandler, whatever the bearer case', async (t) => {
  const db = fakeDatabase({
    users: [{ id: 'admin-1', email: 'founder@agency.test', role: 'ADMIN', organizationId: 'org-a', sessionVersion: 0, isActive: true }],
    organizations: [{ id: 'org-a', name: 'Agency', slug: 'agency' }],
  });
  db.client.user.findUnique = async ({ where }) => db.users.find((row) => (where.id ? row.id === where.id : row.email === where.email)) ?? null;
  const app = Fastify();
  await app.register(fastifyJwt, { secret: 'unit-test-secret' });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', db.client);
  app.addHook('onRequest', async (request) => { request.prisma = db.client; });
  const seen = [];
  app.addHook('preHandler', async (request) => { seen.push(request.user?.id ?? null); });
  await app.register(authRoutes);
  t.after(() => app.close());
  const token = app.jwt.sign({ typ: 'session', id: 'admin-1', role: 'ADMIN', organizationId: 'org-a', sessionVersion: 0 });

  for (const [index, scheme] of ['Bearer', 'bearer', 'BEARER', 'BeArEr'].entries()) {
    seen.length = 0;
    const response = await app.inject({
      method: 'POST',
      url: '/register',
      headers: { authorization: `${scheme} ${token}` },
      payload: { email: `member-${index}@agency.test`, password: 'Member-Passw0rd!', name: 'Member', role: 'TEAM' },
    });
    assert.equal(response.statusCode, 201, `${scheme}: ${response.body}`);
    assert.deepEqual(seen, ['admin-1'], scheme);
  }

  // A stale session (wrong version) leaves the request anonymous: the guard
  // never answers by itself, and the handler refuses it.
  seen.length = 0;
  const stale = app.jwt.sign({ typ: 'session', id: 'admin-1', role: 'ADMIN', organizationId: 'org-a', sessionVersion: 9 });
  const refused = await app.inject({
    method: 'POST',
    url: '/register',
    headers: { authorization: `bearer ${stale}` },
    payload: { email: 'late@agency.test', password: 'Member-Passw0rd!', name: 'Late', role: 'TEAM' },
  });
  assert.equal(refused.statusCode, 401, refused.body);
  assert.deepEqual(seen, [null]);
});

test('the register guard leaves first-admin bootstrap anonymous', async (t) => {
  const db = fakeDatabase();
  const app = Fastify();
  await app.register(fastifyJwt, { secret: 'unit-test-secret' });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', db.client);
  app.addHook('onRequest', async (request) => { request.prisma = db.client; });
  const seen = [];
  app.addHook('preHandler', async (request) => { seen.push(request.user?.id ?? null); });
  await app.register(authRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/register', payload: ADMIN });
  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(seen, [null]);
});
