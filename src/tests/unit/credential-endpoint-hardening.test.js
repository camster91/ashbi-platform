// M4 and L3 (security audit at 8687cf9):
// - credential endpoints relied on the global per-IP limit only: no per-route
//   limit on client login/signup, password reset or the portal link routes,
//   and no per-account throttle anywhere;
// - an unknown email skipped bcrypt, so login timing revealed which emails
//   were registered (staff and client login);
// - an account without an organization was silently attached to an upserted
//   shared `ashbi-agency` workspace on login;
// - legacy unsalted SHA-256 hashes: accepted once and rehashed with bcrypt.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcrypt';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import authRoutes from '../../routes/auth.routes.js';
import clientPortalRoutes from '../../routes/client-portal.routes.js';
import { LocalAuthProvider } from '../../auth/providers/local.provider.js';
import * as password from '../../auth/password.js';

const PASSWORD = 'Correct-Horse-9';

function fakeDb(users) {
  const organizations = [];
  const updates = [];
  const db = {
    users,
    organizations,
    updates,
    user: {
      findUnique: async ({ where }) => users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
      findFirst: async ({ where }) => users.find((u) => u.email === where.email && (!where.role || u.role === where.role)) ?? null,
      findMany: async () => [],
      update: async ({ where, data }) => {
        const user = users.find((u) => u.id === where.id);
        updates.push({ id: where.id, data });
        Object.assign(user, data);
        return user;
      },
    },
    organization: {
      upsert: async ({ create }) => { organizations.push(create); return { id: 'org-shared', ...create }; },
    },
    contact: { findFirst: async () => null },
    auditEvent: { create: async ({ data }) => data, findFirst: async () => null },
  };
  return db;
}

async function buildApp(t, db) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 1000, timeWindow: '1 minute' });
  await app.register(jwt, { secret: 'credential-hardening-secret-0123456789', cookie: { cookieName: 'token', signed: false } });
  app.decorate('authenticate', async () => {});
  app.decorate('auth', new LocalAuthProvider(db, app.jwt));
  app.addHook('onRequest', async (request) => { request.prisma = db; });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
  t.after(() => app.close());
  return app;
}

async function staffUser(overrides = {}) {
  return {
    id: 'user-a', email: 'staff@example.test', name: 'Staff', role: 'ADMIN', organizationId: 'org-a',
    isActive: true, sessionVersion: 0, mfaEnabled: false, password: await bcrypt.hash(PASSWORD, 4), ...overrides,
  };
}

test('credential endpoints carry per-route IP limits', async (t) => {
  const app = await buildApp(t, fakeDb([]));
  const routes = app.printRoutes({ includeHooks: false });
  assert.ok(routes);
  for (const [method, url] of [
    ['POST', '/api/auth/login'], ['POST', '/api/auth/client/login'], ['POST', '/api/auth/client/signup'],
    ['POST', '/api/auth/reset-password'], ['POST', '/api/client-portal/request-access'], ['POST', '/api/client-portal/verify-token'],
  ]) {
    const response = await app.inject({ method, url, payload: {} });
    assert.ok(response.headers['x-ratelimit-limit'], `${url} has a rate limit`);
    assert.ok(Number(response.headers['x-ratelimit-limit']) <= 20, `${url} limit is tighter than the global one (${response.headers['x-ratelimit-limit']})`);
  }
});

test('staff login is throttled per account across IP addresses', async (t) => {
  const app = await buildApp(t, fakeDb([await staffUser()]));
  const statuses = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: `10.0.${attempt}.1`,
      payload: { email: attempt % 2 ? 'STAFF@Example.test' : 'staff@example.test', password: 'wrong-password' },
    });
    statuses.push(response.statusCode);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.deepEqual(statuses.slice(10), [429, 429]);
  const other = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.9.9.9', payload: { email: 'other@example.test', password: 'x' } });
  assert.equal(other.statusCode, 401, 'another account is not affected');
});

test('client login and magic-link requests are throttled per account', async (t) => {
  const app = await buildApp(t, fakeDb([]));
  const client = [];
  for (let attempt = 0; attempt < 11; attempt += 1) {
    client.push((await app.inject({ method: 'POST', url: '/api/auth/client/login', remoteAddress: `10.1.${attempt}.1`, payload: { email: 'c@example.test', password: 'wrong-password' } })).statusCode);
  }
  assert.equal(client.at(-1), 429);
  const links = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    links.push((await app.inject({ method: 'POST', url: '/api/client-portal/request-access', remoteAddress: `10.2.${attempt}.1`, payload: { email: 'c@example.test' } })).statusCode);
  }
  assert.deepEqual(links, [200, 200, 200, 200, 200, 429]);
});

test('an unknown email still costs one bcrypt comparison (staff and client)', async (t) => {
  const calls = [];
  const original = bcrypt.compare;
  bcrypt.compare = async (...args) => { calls.push(args[1]); return original.apply(bcrypt, args); };
  t.after(() => { bcrypt.compare = original; });
  const app = await buildApp(t, fakeDb([]));
  const staff = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@example.test', password: 'whatever-1' } });
  assert.equal(staff.statusCode, 401);
  assert.equal(calls.length, 1, 'staff login compares against a dummy hash');
  const client = await app.inject({ method: 'POST', url: '/api/auth/client/login', payload: { email: 'nobody@example.test', password: 'whatever-1' } });
  assert.equal(client.statusCode, 401);
  assert.equal(calls.length, 2, 'client login compares against a dummy hash');
  assert.match(calls[0], /^\$2[aby]\$12\$/);
});

test('an account without an organization is refused, never attached to a shared workspace', async (t) => {
  const db = fakeDb([await staffUser({ organizationId: null })]);
  const app = await buildApp(t, db);
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'staff@example.test', password: PASSWORD } });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.json().code, 'ACCOUNT_WITHOUT_ORGANIZATION');
  assert.equal(response.headers['set-cookie'], undefined);
  assert.deepEqual(db.organizations, []);
  assert.equal(db.users[0].organizationId, null);
  const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'staff@example.test', password: 'wrong-password' } });
  assert.equal(wrong.statusCode, 401, 'a wrong password does not reveal the missing workspace');
});

test('a legacy SHA-256 hash is accepted once and replaced with bcrypt before the session', async (t) => {
  const legacy = crypto.createHash('sha256').update(PASSWORD).digest('hex');
  const db = fakeDb([await staffUser({ password: legacy })]);
  const app = await buildApp(t, db);
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'staff@example.test', password: PASSWORD } });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(db.users[0].password, /^\$2[aby]\$12\$/);
  assert.equal(await password.verifyPassword(PASSWORD, db.users[0].password), true);

  // A failed rehash refuses the sign-in instead of keeping the legacy hash.
  const failing = fakeDb([await staffUser({ password: legacy })]);
  failing.user.update = async () => { throw new Error('write failed'); };
  const failingApp = await buildApp(t, failing);
  const refused = await failingApp.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'staff@example.test', password: PASSWORD } });
  assert.equal(refused.statusCode, 401);
  assert.equal(refused.headers['set-cookie'], undefined);
});

test('the password module rejects malformed hashes and compares legacy hashes safely', async () => {
  assert.equal(await password.verifyPassword('x', 'not-a-hash'), false);
  assert.equal(await password.verifyPassword('x', ''), false);
  const legacy = crypto.createHash('sha256').update('x').digest('hex');
  assert.equal(await password.verifyPassword('x', legacy), true);
  assert.equal(await password.verifyPassword('y', legacy), false);
});
