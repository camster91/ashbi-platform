// M5 (security audit at 8687cf9): POST /api/auth/register (role from the
// body) and POST /api/team could mint an ADMIN with just a session. Creating
// an administrator now requires step-up re-authentication and is audited.
import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';

const { withSession, reauthCookies } = await import('../helpers/reauth.js');
const { default: authRoutes } = await import('../../routes/auth.routes.js');
const { default: teamRoutes } = await import('../../routes/team.routes.js');
const { signUserSession } = await import('../../auth/session.js');

const ADMIN = { id: 'admin-1', email: 'founder@agency.test', name: 'Founder', role: 'ADMIN', organizationId: 'org-a', sessionVersion: 0, isActive: true };

function fakeDb() {
  const created = [];
  const audits = [];
  const users = [ADMIN];
  return {
    created,
    audits,
    user: {
      count: async () => users.length,
      findUnique: async ({ where }) => users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
      create: async ({ data }) => {
        const row = { id: `user-${created.length + 2}`, skills: '[]', capacity: 100, isActive: true, ...data };
        created.push(row);
        return row;
      },
    },
    auditEvent: { create: async ({ data }) => { audits.push(data); return data; } },
  };
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function registerApp(t, db) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(jwt, { secret: process.env.JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  app.decorate('authenticate', async () => {});
  app.addHook('onRequest', async (request) => { request.prisma = db; });
  await app.register(authRoutes);
  t.after(() => app.close());
  return app;
}

async function teamApp(t, db) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.decorate('adminOnly', async (request) => { request.user = withSession(ADMIN); });
  app.decorate('authenticate', async (request) => { request.user = withSession(ADMIN); });
  app.addHook('onRequest', async (request) => { request.prisma = db; });
  await app.register(teamRoutes);
  t.after(() => app.close());
  return app;
}

const NEW_MEMBER = { email: 'new@agency.test', password: 'New-Member-Passw0rd', name: 'New Member' };

test('register: an ADMIN needs step-up re-authentication; other roles do not', async (t) => {
  const db = fakeDb();
  const app = await registerApp(t, db);
  const session = signUserSession(app.jwt, ADMIN);
  const sessionPayload = app.jwt.verify(session);

  const denied = await app.inject({
    method: 'POST', url: '/register', headers: { cookie: `token=${session}` }, payload: { ...NEW_MEMBER, role: 'ADMIN' },
  });
  assert.equal(denied.statusCode, 403, denied.body);
  assert.equal(denied.json().code, 'REAUTH_REQUIRED');
  assert.deepEqual(db.created, []);

  const team = await app.inject({
    method: 'POST', url: '/register', headers: { cookie: `token=${session}` }, payload: { ...NEW_MEMBER, email: 'team@agency.test', role: 'TEAM' },
  });
  assert.equal(team.statusCode, 201, team.body);

  const allowed = await app.inject({
    method: 'POST', url: '/register',
    headers: { cookie: cookieHeader({ token: session, ...reauthCookies({ ...ADMIN, iat: sessionPayload.iat }) }) },
    payload: { ...NEW_MEMBER, role: 'ADMIN' },
  });
  assert.equal(allowed.statusCode, 201, allowed.body);
  assert.equal(allowed.json().role, 'ADMIN');
  assert.deepEqual(db.audits.map((a) => [a.action, a.metadata.role, a.metadata.via]), [
    ['user.created', 'TEAM', 'register'],
    ['user.created', 'ADMIN', 'register'],
  ]);
});

test('POST /api/team: an ADMIN needs step-up re-authentication and is audited', async (t) => {
  const db = fakeDb();
  const app = await teamApp(t, db);
  const denied = await app.inject({ method: 'POST', url: '/', payload: { ...NEW_MEMBER, role: 'ADMIN' } });
  assert.equal(denied.statusCode, 403, denied.body);
  assert.equal(denied.json().code, 'REAUTH_REQUIRED');
  assert.deepEqual(db.created, []);

  const allowed = await app.inject({
    method: 'POST', url: '/', headers: { cookie: cookieHeader(reauthCookies(ADMIN)) }, payload: { ...NEW_MEMBER, role: 'ADMIN' },
  });
  assert.equal(allowed.statusCode, 201, allowed.body);
  assert.equal(db.audits.at(-1).action, 'user.created');
  assert.equal(db.audits.at(-1).metadata.role, 'ADMIN');

  const team = await app.inject({ method: 'POST', url: '/', payload: { ...NEW_MEMBER, email: 'team@agency.test', role: 'STAFF' } });
  assert.equal(team.statusCode, 201, team.body);
});
