// Organization MFA requirement guard (src/auth/mfa-enforcement.js). The
// real-database, real-application proof is
// src/tests/integration/org-mfa-enforcement.database.test.js.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const {
  createMfaEnforcementHook,
  isMfaEnrollmentAllowedRoute,
  isMfaEnrollmentRequired,
  MFA_ENROLLMENT_ALLOWED_ROUTES,
  MFA_ENROLLMENT_REQUIRED_CODE,
  mustEnrollMfa,
  requestPrincipalId,
} = await import('../../auth/mfa-enforcement.js');
const { signUserSession } = await import('../../auth/session.js');

const REQUIRED_ORG = { mfaRequired: true };
const OPTIONAL_ORG = { mfaRequired: false };

function user(overrides = {}) {
  return {
    id: 'staff-1', email: 's@x.test', name: 'Staff', role: 'STAFF', clientId: null,
    organizationId: 'org-1', isActive: true, sessionVersion: 0,
    mfaEnabled: false, mfaSecret: null, organization: REQUIRED_ORG,
    ...overrides,
  };
}

function fakePrisma(users) {
  const calls = [];
  return {
    calls,
    users,
    user: {
      findUnique: async ({ where, select }) => {
        calls.push({ where, select });
        const row = users.find((u) => u.id === where.id);
        return row ? structuredClone(row) : null;
      },
    },
  };
}

describe('mustEnrollMfa', () => {
  it('applies only to eligible staff without two-factor in an organization that requires it', () => {
    assert.equal(mustEnrollMfa(user()), true);
    for (const role of ['ADMIN', 'TEAM', 'STAFF']) assert.equal(mustEnrollMfa(user({ role })), true, role);
    assert.equal(mustEnrollMfa(user({ mfaEnabled: true, mfaSecret: 'enc' })), false, 'enrolled');
    assert.equal(mustEnrollMfa(user({ organization: OPTIONAL_ORG })), false, 'not required');
    assert.equal(mustEnrollMfa(user({ organization: null })), false, 'no organization');
    assert.equal(mustEnrollMfa(user({ role: 'CLIENT' })), false, 'client portal users are out of scope');
    assert.equal(mustEnrollMfa(user({ role: 'BOT' })), false, 'bots are out of scope');
    assert.equal(mustEnrollMfa(null), false);
  });

  it('treats a half-enrolled account (flag without secret, or pending secret) as not enrolled', () => {
    assert.equal(mustEnrollMfa(user({ mfaEnabled: true, mfaSecret: null })), true);
    assert.equal(mustEnrollMfa(user({ mfaEnabled: false, mfaSecret: 'pending' })), true);
  });
});

describe('isMfaEnrollmentAllowedRoute', () => {
  it('allows only enrollment, identity, sign-out and credential exchange', () => {
    for (const entry of MFA_ENROLLMENT_ALLOWED_ROUTES) {
      const [method, url] = entry.split(' ');
      assert.equal(isMfaEnrollmentAllowedRoute(method, url), true, entry);
    }
    assert.equal(isMfaEnrollmentAllowedRoute('HEAD', '/api/auth/me'), true);
    assert.equal(isMfaEnrollmentAllowedRoute('get', '/api/auth/mfa'), true);
    for (const [method, url] of [
      ['PUT', '/api/auth/me'],
      ['POST', '/api/auth/mfa/disable'],
      ['POST', '/api/auth/mfa/admin/users/:userId/reset'],
      ['POST', '/api/auth/reauth'],
      ['POST', '/api/auth/impersonation'],
      ['POST', '/api/auth/register'],
      ['POST', '/api/auth/change-password'],
      ['GET', '/api/clients'],
      ['GET', '/api/settings/mfa-requirement'],
      ['PUT', '/api/settings/mfa-requirement'],
      ['GET', '/api/api-keys'],
    ]) {
      assert.equal(isMfaEnrollmentAllowedRoute(method, url), false, `${method} ${url}`);
    }
  });
});

describe('isMfaEnrollmentRequired', () => {
  it('reads the user with the organization joined, never trusting the token', async () => {
    const prisma = fakePrisma([user()]);
    assert.equal(await isMfaEnrollmentRequired(prisma, 'staff-1'), true);
    assert.deepEqual(prisma.calls[0].select.organization, { select: { mfaRequired: true } });
    assert.equal(await isMfaEnrollmentRequired(prisma, 'missing'), false);
    assert.equal(await isMfaEnrollmentRequired(prisma, null), false);
  });
});

describe('requestPrincipalId', () => {
  const verify = () => { throw new Error('should not verify'); };
  it('prefers the support-view actor, then the guarded user', () => {
    assert.equal(requestPrincipalId({ impersonation: { actorUserId: 'admin-1' }, user: { id: 'staff-1' } }, verify), 'admin-1');
    assert.equal(requestPrincipalId({ user: { id: 'staff-1' } }, verify), 'staff-1');
  });

  it('falls back to a verifiable session token for handler-verified routes', () => {
    const session = { typ: 'session', id: 'staff-2', role: 'STAFF', sessionVersion: 0 };
    assert.equal(requestPrincipalId({ cookies: { token: 't' }, headers: {} }, () => session), 'staff-2');
    assert.equal(requestPrincipalId({ headers: { authorization: 'Bearer t' } }, () => session), 'staff-2');
    // Not a session (a magic link or any other token type), or unverifiable.
    assert.equal(requestPrincipalId({ cookies: { token: 't' }, headers: {} }, () => ({ typ: 'client_magic_link', id: 'x' })), null);
    assert.equal(requestPrincipalId({ cookies: { token: 't' }, headers: {} }, () => { throw new Error('bad'); }), null);
    assert.equal(requestPrincipalId({ headers: {} }, verify), null);
  });
});

async function buildApp(t, prisma, { lookupFails = false } = {}) {
  const app = Fastify();
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  // Stand-in for the real guards: the header names the signed-in user; the
  // x-view-actor header simulates an active support view.
  const authenticate = async (request, reply) => {
    const id = request.headers['x-user'];
    if (!id) return reply.status(401).send({ error: 'Unauthorized' });
    request.user = { id };
    if (request.headers['x-view-actor']) request.impersonation = { actorUserId: request.headers['x-view-actor'] };
    return undefined;
  };
  const db = lookupFails
    ? { user: { findUnique: async () => { throw new Error('database down'); } } }
    : prisma;
  app.addHook('preHandler', createMfaEnforcementHook({
    prisma: db,
    verifySessionToken: (token) => app.jwt.verify(token),
    logger: { error() {} },
  }));
  const ok = async () => ({ ok: true });
  app.get('/api/auth/me', { onRequest: [authenticate] }, ok);
  app.put('/api/auth/me', { onRequest: [authenticate] }, ok);
  app.get('/api/auth/mfa', { onRequest: [authenticate] }, ok);
  app.post('/api/auth/mfa/enroll', { onRequest: [authenticate] }, ok);
  app.post('/api/auth/mfa/confirm', { onRequest: [authenticate] }, ok);
  app.post('/api/auth/logout', ok);
  app.post('/api/auth/login', ok);
  app.post('/api/auth/reauth', { onRequest: [authenticate] }, ok);
  // Verifies the session inside the handler, like POST /api/auth/register.
  app.post('/api/auth/register', ok);
  app.get('/api/clients', { onRequest: [authenticate] }, ok);
  app.get('/api/public/thing', ok);
  app.get('/not-api', { onRequest: [authenticate] }, ok);
  t.after(() => app.close());
  return app;
}

describe('the enforcement hook', () => {
  it('limits an unenrolled staff session to the enrollment endpoints', async (t) => {
    const prisma = fakePrisma([user()]);
    const app = await buildApp(t, prisma);
    const headers = { 'x-user': 'staff-1' };

    for (const [method, url] of [['GET', '/api/clients'], ['PUT', '/api/auth/me'], ['POST', '/api/auth/reauth']]) {
      const response = await app.inject({ method, url, headers, payload: method === 'GET' ? undefined : {} });
      assert.equal(response.statusCode, 403, `${method} ${url}`);
      assert.equal(response.json().code, MFA_ENROLLMENT_REQUIRED_CODE, `${method} ${url}`);
    }
    for (const [method, url] of [
      ['GET', '/api/auth/me'], ['HEAD', '/api/auth/me'], ['GET', '/api/auth/mfa'],
      ['POST', '/api/auth/mfa/enroll'], ['POST', '/api/auth/mfa/confirm'], ['POST', '/api/auth/logout'], ['POST', '/api/auth/login'],
    ]) {
      const response = await app.inject({ method, url, headers, payload: method === 'POST' ? {} : undefined });
      assert.equal(response.statusCode, 200, `${method} ${url}: ${response.body}`);
    }
  });

  it('matches the route pattern, so an encoded or doubled path cannot pass as an allowed one', async (t) => {
    const app = await buildApp(t, fakePrisma([user()]));
    const encoded = await app.inject({ method: 'GET', url: '/api/%63lients', headers: { 'x-user': 'staff-1' } });
    assert.equal(encoded.statusCode, 403);
    assert.equal(encoded.json().code, MFA_ENROLLMENT_REQUIRED_CODE);
  });

  it('lets enrolled staff, optional organizations and non-staff through', async (t) => {
    const prisma = fakePrisma([
      user({ id: 'enrolled', mfaEnabled: true, mfaSecret: 'enc' }),
      user({ id: 'optional', organization: OPTIONAL_ORG }),
      user({ id: 'client', role: 'CLIENT' }),
    ]);
    const app = await buildApp(t, prisma);
    for (const id of ['enrolled', 'optional', 'client']) {
      const response = await app.inject({ method: 'GET', url: '/api/clients', headers: { 'x-user': id } });
      assert.equal(response.statusCode, 200, id);
    }
  });

  it('lifts the restriction as soon as the person enrolls, with the same session', async (t) => {
    const prisma = fakePrisma([user()]);
    const app = await buildApp(t, prisma);
    const headers = { 'x-user': 'staff-1' };
    assert.equal((await app.inject({ method: 'GET', url: '/api/clients', headers })).statusCode, 403);
    Object.assign(prisma.users[0], { mfaEnabled: true, mfaSecret: 'enc' });
    assert.equal((await app.inject({ method: 'GET', url: '/api/clients', headers })).statusCode, 200);
    // And applies again at once if two-factor is reset.
    Object.assign(prisma.users[0], { mfaEnabled: false, mfaSecret: null });
    assert.equal((await app.inject({ method: 'GET', url: '/api/clients', headers })).statusCode, 403);
  });

  it('checks the viewing admin during a support view, not the viewed person', async (t) => {
    const prisma = fakePrisma([
      user({ id: 'admin-unenrolled', role: 'ADMIN' }),
      user({ id: 'admin-enrolled', role: 'ADMIN', mfaEnabled: true, mfaSecret: 'enc' }),
      user({ id: 'staff-1' }),
    ]);
    const app = await buildApp(t, prisma);
    const restricted = await app.inject({ method: 'GET', url: '/api/clients', headers: { 'x-user': 'staff-1', 'x-view-actor': 'admin-unenrolled' } });
    assert.equal(restricted.statusCode, 403);
    assert.equal(restricted.json().code, MFA_ENROLLMENT_REQUIRED_CODE);
    const allowed = await app.inject({ method: 'GET', url: '/api/clients', headers: { 'x-user': 'staff-1', 'x-view-actor': 'admin-enrolled' } });
    assert.equal(allowed.statusCode, 200);
  });

  it('covers routes that verify the session in the handler', async (t) => {
    const prisma = fakePrisma([user({ id: 'admin-1', role: 'ADMIN' })]);
    const app = await buildApp(t, prisma);
    const token = signUserSession(app.jwt, { ...user({ id: 'admin-1', role: 'ADMIN' }) });
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', cookies: { token }, payload: {} });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, MFA_ENROLLMENT_REQUIRED_CODE);
    // Anonymous callers and non-/api routes are not its concern.
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', payload: {} })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/public/thing' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/not-api', headers: { 'x-user': 'admin-1' } })).statusCode, 200);
  });

  it('fails closed when the requirement cannot be read', async (t) => {
    const app = await buildApp(t, null, { lookupFails: true });
    const response = await app.inject({ method: 'GET', url: '/api/clients', headers: { 'x-user': 'staff-1' } });
    assert.equal(response.statusCode, 503);
    // Allowed routes never need the lookup.
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { 'x-user': 'staff-1' } })).statusCode, 200);
  });
});
