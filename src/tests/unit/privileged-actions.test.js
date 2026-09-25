// Step-up re-authentication and scoped, expiring API keys (#416).
// Policy: docs/privileged-actions.md.
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import bcrypt from 'bcrypt';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import pino from 'pino';
import { Writable } from 'node:stream';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';
process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'unit-test-credentials-key';

const { default: mfaRoutes, REAUTH_PASSWORD_MAX_FAILURES, resetReauthPasswordFailures } = await import('../../routes/mfa.routes.js');
const { default: apiKeyRoutes, authenticateApiKey } = await import('../../routes/api-key.routes.js');
const { default: aiBridgeRoutes } = await import('../../routes/ai-bridge.routes.js');
const { isCurrentUserSession, signUserSession } = await import('../../auth/session.js');
const { generateTotpSecret, totp } = await import('../../auth/totp.js');
const { encryptMfaSecret, hashRecoveryCode } = await import('../../auth/mfa.js');
const {
  REAUTH_COOKIE,
  REAUTH_TTL_SECONDS,
  resetReauthFailureAuditThrottle,
  signReauthToken,
} = await import('../../auth/reauth.js');
const { API_KEY_MAX_EXPIRY_DAYS } = await import('../../auth/api-key-scopes.js');
const { LOG_REDACT_OPTIONS } = await import('../../utils/log-redaction.js');

const PASSWORD = 'Correct-Horse-9';
const PASSWORD_HASH = await bcrypt.hash(PASSWORD, 4);
const DAY_MS = 24 * 60 * 60 * 1000;

function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'admin@agency.test',
    name: 'Admin',
    role: 'ADMIN',
    clientId: null,
    organizationId: 'org-1',
    isActive: true,
    sessionVersion: 0,
    password: PASSWORD_HASH,
    mfaEnabled: false,
    mfaSecret: null,
    mfaEnabledAt: null,
    mfaLastUsedStep: null,
    mfaRecoveryCodes: [],
    mfaFailedAttempts: 0,
    mfaLockedUntil: null,
    ...overrides,
  };
}

function applyData(row, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) row[key] = (row[key] ?? 0) + value.increment;
    else if (value && typeof value === 'object' && 'set' in value) row[key] = [...value.set];
    else row[key] = Array.isArray(value) ? [...value] : value;
  }
}

function matches(row, where) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return condition.some((branch) => matches(row, branch));
    if (condition === null) return row[key] === null || row[key] === undefined;
    if (condition && typeof condition === 'object' && 'lt' in condition) return row[key] !== null && row[key] < condition.lt;
    if (condition && typeof condition === 'object' && 'lte' in condition) return row[key] !== null && row[key] <= condition.lte;
    if (condition && typeof condition === 'object' && 'has' in condition) return (row[key] || []).includes(condition.has);
    return row[key] === condition;
  });
}

function fakePrisma(users, apiKeys = []) {
  const db = { users, apiKeys, notifications: [], auditEvents: [] };
  db.client = {
    user: {
      findUnique: async ({ where }) => {
        const row = db.users.find((u) => u.id === where.id);
        return row ? structuredClone(row) : null;
      },
      update: async ({ where, data }) => {
        const row = db.users.find((u) => matches(u, where));
        if (!row) throw Object.assign(new Error('No record found'), { code: 'P2025' });
        applyData(row, data);
        return structuredClone(row);
      },
      updateMany: async ({ where, data }) => {
        const rows = db.users.filter((u) => matches(u, where));
        rows.forEach((row) => applyData(row, data));
        return { count: rows.length };
      },
    },
    apiKey: {
      count: async ({ where }) => db.apiKeys.filter((k) => k.userId === where.userId && k.isActive).length,
      findMany: async ({ where }) => db.apiKeys
        .filter((k) => k.userId === where.userId && k.isActive)
        .map(({ id, name, scopes, lastUsedAt, createdAt, expiresAt }) => ({ id, name, scopes, lastUsedAt, createdAt, expiresAt })),
      create: async ({ data }) => {
        const row = { id: `key-${db.apiKeys.length + 1}`, isActive: true, revokedAt: null, createdAt: new Date(), lastUsedAt: null, ...data };
        db.apiKeys.push(row);
        return { ...row };
      },
      findUnique: async ({ where, include }) => {
        const row = db.apiKeys.find((k) => (where.id ? k.id === where.id : k.key === where.key));
        if (!row) return null;
        return include?.user ? { ...row, user: db.users.find((u) => u.id === row.userId) } : { ...row };
      },
      update: async ({ where, data }) => {
        const row = db.apiKeys.find((k) => k.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
    },
    notification: { create: async ({ data }) => { db.notifications.push(data); return data; } },
    auditEvent: {
      create: async ({ data }) => { db.auditEvents.push(data); return data; },
      findFirst: async ({ where }) => db.auditEvents.find((e) => e.action === where.action && e.entityId === where.entityId) ?? null,
    },
  };
  return db;
}

async function buildApp(t, db) {
  const app = Fastify();
  await app.register(fastifyCookie);
  await app.register(rateLimit, { global: false });
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
  app.decorate('prisma', db.client);
  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
      if (!(await isCurrentUserSession(db.client, request.user))) throw new Error('revoked');
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
  app.decorate('authenticateWithApiKey', authenticateApiKey);
  app.addHook('onRequest', async (request) => { request.prisma = db.client; });
  await app.register(mfaRoutes, { prefix: '/api/auth' });
  await app.register(apiKeyRoutes, { prefix: '/api/api-keys' });
  await app.register(aiBridgeRoutes, { prefix: '/api/ai-bridge', chatClient: { chat: async () => 'ok' } });
  t.after(() => app.close());
  return app;
}

function sessionToken(app, user) {
  return signUserSession(app.jwt, user);
}

function cookieFrom(response, name) {
  return response.cookies.find((cookie) => cookie.name === name);
}

async function reauthWithPassword(app, token) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/reauth', cookies: { token }, payload: { password: PASSWORD } });
  assert.equal(response.statusCode, 200, response.body);
  return cookieFrom(response, REAUTH_COOKIE).value;
}

function createKey(app, cookies, payload = { name: 'CI', scopes: ['ai_bridge:read'] }) {
  return app.inject({ method: 'POST', url: '/api/api-keys', cookies, payload });
}

beforeEach(() => { resetReauthFailureAuditThrottle(); resetReauthPasswordFailures(); });

describe('POST /api/auth/reauth', () => {
  it('issues a short-lived, httpOnly, sameSite=strict reauth cookie and audits the method', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const token = sessionToken(app, db.users[0]);

    const response = await app.inject({ method: 'POST', url: '/api/auth/reauth', cookies: { token }, payload: { password: PASSWORD } });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().method, 'password');
    assert.equal(response.headers['cache-control'], 'no-store');
    const cookie = cookieFrom(response, REAUTH_COOKIE);
    assert.ok(cookie, 'reauth cookie set');
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Strict');
    assert.equal(cookie.maxAge, REAUTH_TTL_SECONDS);
    assert.equal(cookie.maxAge, 600);
    assert.equal(cookie.path, '/');
    assert.equal(cookieFrom(response, 'token'), undefined, 'the session is not replaced');
    assert.throws(() => app.jwt.verify(cookie.value), 'the reauth token is not a session token');

    const events = db.auditEvents.filter((event) => event.action === 'auth.reauthenticated');
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].metadata, { method: 'password' });
    assert.equal(events[0].actorUserId, 'user-1');
    assert.equal(events[0].organizationId, 'org-1');
    assert.ok(!JSON.stringify(db.auditEvents).includes(PASSWORD));
  });

  it('requires a session', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const response = await app.inject({ method: 'POST', url: '/api/auth/reauth', payload: { password: PASSWORD } });
    assert.equal(response.statusCode, 401);
  });

  it('rejects a wrong password with 400 and a throttled auth.reauth_failed event', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const token = sessionToken(app, db.users[0]);

    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/reauth', cookies: { token }, payload: { password: 'not-my-password' } });
      assert.equal(response.statusCode, 400, 'a wrong password must not look like an expired session');
      assert.equal(cookieFrom(response, REAUTH_COOKIE), undefined);
    }
    await new Promise((resolve) => setImmediate(resolve));
    const failures = db.auditEvents.filter((event) => event.action === 'auth.reauth_failed');
    assert.equal(failures.length, 1, 'one event per account per window');
    assert.deepEqual(failures[0].metadata, { reason: 'invalid_password' });
    assert.ok(!JSON.stringify(db.auditEvents).includes('not-my-password'));
  });

  it('rate-limits password attempts per IP like /login', async (t) => {
    // Spread over several accounts so only the per-IP limit can trip.
    const users = Array.from({ length: 3 }, (_, i) => makeUser({ id: `user-${i + 1}`, email: `u${i}@agency.test` }));
    const db = fakePrisma(users);
    const app = await buildApp(t, db);
    let last;
    for (let i = 0; i < 21; i += 1) {
      const token = sessionToken(app, users[i % users.length]);
      last = await app.inject({ method: 'POST', url: '/api/auth/reauth', cookies: { token }, payload: { password: 'wrong-password' } });
    }
    assert.equal(last.statusCode, 429);
    assert.notEqual(last.json().code, 'REAUTH_LOCKED');
  });

  it('caps password failures per account even across many IPs', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const token = sessionToken(app, db.users[0]);
    const attempt = (password, i) => app.inject({
      method: 'POST', url: '/api/auth/reauth', cookies: { token }, payload: { password }, remoteAddress: `198.51.100.${i}`,
    });
    for (let i = 0; i < REAUTH_PASSWORD_MAX_FAILURES; i += 1) {
      assert.equal((await attempt('wrong-password', i)).statusCode, 400);
    }
    const locked = await attempt(PASSWORD, 200);
    assert.equal(locked.statusCode, 429, 'even the right password is refused once the budget is spent');
    assert.equal(locked.json().code, 'REAUTH_LOCKED');
    assert.equal(cookieFrom(locked, REAUTH_COOKIE), undefined);
  });

  it('requires a TOTP or recovery code, not the password, when two-factor is on', async (t) => {
    const secret = generateTotpSecret();
    const recoveryCode = 'abcd-efgh-jkmn-pqrs';
    const db = fakePrisma([makeUser({
      mfaEnabled: true,
      mfaSecret: encryptMfaSecret(secret),
      mfaRecoveryCodes: [hashRecoveryCode(recoveryCode)],
    })]);
    const app = await buildApp(t, db);
    const token = sessionToken(app, db.users[0]);

    const withPassword = await app.inject({ method: 'POST', url: '/api/auth/reauth', cookies: { token }, payload: { password: PASSWORD } });
    assert.equal(withPassword.statusCode, 400);
    assert.equal(withPassword.json().code, 'MFA_CODE_REQUIRED');
    assert.equal(cookieFrom(withPassword, REAUTH_COOKIE), undefined);

    const withTotp = await app.inject({ method: 'POST', url: '/api/auth/reauth', cookies: { token }, payload: { code: totp(secret) } });
    assert.equal(withTotp.statusCode, 200, withTotp.body);
    assert.equal(withTotp.json().method, 'totp');
    const reauth = cookieFrom(withTotp, REAUTH_COOKIE).value;
    const created = await createKey(app, { token, reauth });
    assert.equal(created.statusCode, 200, created.body);

    // A recovery code revokes other sessions; the reauth is bound to the
    // replacement session cookie that is issued with it.
    const withRecovery = await app.inject({ method: 'POST', url: '/api/auth/reauth', cookies: { token }, payload: { code: recoveryCode } });
    assert.equal(withRecovery.statusCode, 200, withRecovery.body);
    assert.equal(withRecovery.json().method, 'recovery_code');
    assert.equal(db.users[0].mfaRecoveryCodes.length, 0, 'the recovery code is consumed');
    const renewed = cookieFrom(withRecovery, 'token').value;
    const recoveryReauth = cookieFrom(withRecovery, REAUTH_COOKIE).value;
    assert.equal((await createKey(app, { token: renewed, reauth: recoveryReauth })).statusCode, 200);
    assert.equal((await createKey(app, { token, reauth: recoveryReauth })).statusCode, 401, 'the old session was revoked');
    assert.ok(db.auditEvents.some((event) => event.action === 'auth.mfa_recovery_code_used'));
    assert.deepEqual(
      db.auditEvents.filter((event) => event.action === 'auth.reauthenticated').map((event) => event.metadata.method),
      ['totp', 'recovery_code'],
    );
  });

  it('shares the two-factor attempt budget and lockout', async (t) => {
    const secret = generateTotpSecret();
    const db = fakePrisma([makeUser({ mfaEnabled: true, mfaSecret: encryptMfaSecret(secret) })]);
    const app = await buildApp(t, db);
    const token = sessionToken(app, db.users[0]);
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/reauth', cookies: { token }, payload: { code: 'zzzz-zzzz-zzzz-zzzz' } });
      statuses.push(response.statusCode);
    }
    assert.deepEqual(statuses, [400, 400, 400, 400, 429, 429]);
    assert.ok(db.users[0].mfaLockedUntil, 'the account second factor is locked');
    const locked = await app.inject({ method: 'POST', url: '/api/auth/reauth', cookies: { token }, payload: { code: totp(secret) } });
    assert.equal(locked.statusCode, 429, 'a correct code is refused while locked');
  });
});

describe('requireRecentAuth', () => {
  async function setup(t) {
    const db = fakePrisma([makeUser(), makeUser({ id: 'user-2', email: 'other@agency.test' })]);
    const app = await buildApp(t, db);
    return { db, app, token: sessionToken(app, db.users[0]) };
  }

  function assertReauthRequired(response) {
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().code, 'REAUTH_REQUIRED');
  }

  it('denies a privileged action without a reauth cookie', async (t) => {
    const { app, db, token } = await setup(t);
    assertReauthRequired(await createKey(app, { token }));
    assert.equal(db.apiKeys.length, 0);
  });

  it('allows it right after re-authenticating', async (t) => {
    const { app, db, token } = await setup(t);
    const reauth = await reauthWithPassword(app, token);
    const response = await createKey(app, { token, reauth });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(db.apiKeys.length, 1);
  });

  it('denies an expired re-authentication', async (t) => {
    const { app, db, token } = await setup(t);
    const session = { ...app.jwt.decode(token) };
    const expired = signReauthToken(session, { nowMs: Date.now() - (REAUTH_TTL_SECONDS + 1) * 1000 });
    assertReauthRequired(await createKey(app, { token, reauth: expired }));
    assert.equal(db.apiKeys.length, 0);
  });

  it('denies another user\'s re-authentication', async (t) => {
    const { app, db, token } = await setup(t);
    const otherToken = sessionToken(app, db.users[1]);
    const otherReauth = await reauthWithPassword(app, otherToken);
    assertReauthRequired(await createKey(app, { token, reauth: otherReauth }));
  });

  it('denies a re-authentication made stale by a sessionVersion bump', async (t) => {
    const { app, db, token } = await setup(t);
    const reauth = await reauthWithPassword(app, token);
    db.users[0].sessionVersion += 1; // e.g. password change or MFA change elsewhere
    const renewed = sessionToken(app, db.users[0]);
    assertReauthRequired(await createKey(app, { token: renewed, reauth }));
  });

  it('denies a re-authentication from a different session of the same user', async (t) => {
    const { app, db } = await setup(t);
    const older = signUserSession(app.jwt, db.users[0], { iat: Math.floor(Date.now() / 1000) - 120 });
    const current = sessionToken(app, db.users[0]);
    assert.notEqual(app.jwt.decode(older).iat, app.jwt.decode(current).iat);
    const reauth = await reauthWithPassword(app, older);
    assert.equal((await createKey(app, { token: older, reauth })).statusCode, 200, 'valid in its own session');
    assertReauthRequired(await createKey(app, { token: current, reauth }));
  });

  it('denies a forged or session-signed token', async (t) => {
    const { app, token } = await setup(t);
    const [header, payload] = (await reauthWithPassword(app, token)).split('.');
    assertReauthRequired(await createKey(app, { token, reauth: `${header}.${payload}.forged` }));
    assertReauthRequired(await createKey(app, { token, reauth: token }));
  });
});

describe('API key scopes and expiry', () => {
  async function signedIn(t, apiKeys = []) {
    const db = fakePrisma([makeUser()], apiKeys);
    const app = await buildApp(t, db);
    const token = sessionToken(app, db.users[0]);
    const reauth = await reauthWithPassword(app, token);
    return { db, app, cookies: { token, reauth } };
  }

  it('requires at least one scope from the closed catalogue', async (t) => {
    const { app, db, cookies } = await signedIn(t);
    assert.equal((await createKey(app, cookies, { name: 'CI' })).statusCode, 400);
    assert.equal((await createKey(app, cookies, { name: 'CI', scopes: [] })).statusCode, 400);
    assert.equal((await createKey(app, cookies, { name: 'CI', scopes: ['admin:all'] })).statusCode, 400);
    assert.equal(db.apiKeys.length, 0);
  });

  it('defaults to a 90-day expiry and rejects more than 365 days', async (t) => {
    const { app, db, cookies } = await signedIn(t);
    const before = Date.now();
    const created = await createKey(app, cookies, { name: 'CI', scopes: ['ai_bridge:actions', 'ai_bridge:read'] });
    assert.equal(created.statusCode, 200, created.body);
    const expiresAt = new Date(created.json().expiresAt).getTime();
    assert.ok(Math.abs(expiresAt - (before + 90 * DAY_MS)) < 60_000, 'default is 90 days');
    assert.deepEqual(created.json().scopes, ['ai_bridge:actions', 'ai_bridge:read']);

    const tooLong = await createKey(app, cookies, { name: 'CI', scopes: ['ai_bridge:read'], expiresInDays: API_KEY_MAX_EXPIRY_DAYS + 1 });
    assert.equal(tooLong.statusCode, 400);
    const tooFar = await createKey(app, cookies, {
      name: 'CI', scopes: ['ai_bridge:read'], expiresAt: new Date(Date.now() + 400 * DAY_MS).toISOString(),
    });
    assert.equal(tooFar.statusCode, 400);
    const past = await createKey(app, cookies, { name: 'CI', scopes: ['ai_bridge:read'], expiresAt: new Date(Date.now() - DAY_MS).toISOString() });
    assert.equal(past.statusCode, 400);
    const year = await createKey(app, cookies, { name: 'CI', scopes: ['ai_bridge:read'], expiresInDays: 365 });
    assert.equal(year.statusCode, 200, year.body);
    assert.equal(db.apiKeys.length, 2);

    const audit = db.auditEvents.filter((event) => event.action === 'api_key.created');
    assert.equal(audit[0].metadata.scopes, 'ai_bridge:actions+ai_bridge:read');
    assert.equal(audit[0].metadata.expires, true);
    const serialized = JSON.stringify(db.auditEvents);
    assert.ok(!serialized.includes(created.json().key), 'the raw key is never audited');
    assert.ok(!serialized.includes(db.apiKeys[0].key), 'the key hash is never audited');
  });

  it('keeps legacy keys without an expiry working and flags them in the list', async (t) => {
    const { app, cookies } = await signedIn(t, [{
      id: 'legacy', name: 'Legacy', key: 'x', userId: 'user-1', isActive: true, revokedAt: null,
      scopes: ['ai_bridge:read', 'ai_bridge:actions'], expiresAt: null, createdAt: new Date(), lastUsedAt: null,
    }]);
    const list = await app.inject({ method: 'GET', url: '/api/api-keys', cookies });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().keys[0].noExpiry, true);
    assert.deepEqual(list.json().availableScopes, ['ai_bridge:read', 'ai_bridge:actions']);
  });

  async function keyFor(t, { scopes = ['ai_bridge:read'], expiresInDays } = {}) {
    const { app, db, cookies } = await signedIn(t);
    const created = await createKey(app, cookies, { name: 'Bot', scopes, ...(expiresInDays ? { expiresInDays } : {}) });
    assert.equal(created.statusCode, 200, created.body);
    return { app, db, cookies, rawKey: created.json().key, id: created.json().id };
  }

  function capabilities(app, rawKey) {
    return app.inject({ method: 'GET', url: '/api/ai-bridge/capabilities', headers: { 'x-api-key': rawKey } });
  }

  it('exposes the granted scopes to routes and accepts a valid key', async (t) => {
    const { app, rawKey } = await keyFor(t, { scopes: ['ai_bridge:read'] });
    const response = await capabilities(app, rawKey);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().grantedScopes, ['ai_bridge:read']);
    const bearer = await app.inject({ method: 'GET', url: '/api/ai-bridge/capabilities', headers: { authorization: `Bearer ${rawKey}` } });
    assert.equal(bearer.statusCode, 200);
  });

  it('denies an expired key', async (t) => {
    const { app, db, rawKey } = await keyFor(t);
    db.apiKeys[0].expiresAt = new Date(Date.now() - 1000);
    const response = await capabilities(app, rawKey);
    assert.equal(response.statusCode, 401);
  });

  it('denies a revoked key', async (t) => {
    const { app, db, cookies, rawKey, id } = await keyFor(t);
    const revoked = await app.inject({ method: 'DELETE', url: `/api/api-keys/${id}`, cookies });
    assert.equal(revoked.statusCode, 200);
    assert.equal(db.apiKeys[0].isActive, false);
    assert.ok(db.apiKeys[0].revokedAt instanceof Date);
    assert.equal((await capabilities(app, rawKey)).statusCode, 401);

    // revokedAt alone is enough to deny, whatever isActive says.
    db.apiKeys[0].isActive = true;
    assert.equal((await capabilities(app, rawKey)).statusCode, 401);
  });

  it('denies a key used for a route outside its scopes with INSUFFICIENT_SCOPE', async (t) => {
    const { app, rawKey } = await keyFor(t, { scopes: ['ai_bridge:read'] });
    const response = await app.inject({
      method: 'POST', url: '/api/ai-bridge/v1/actions/prepare', headers: { 'x-api-key': rawKey },
      payload: { action: 'create_task', idempotencyKey: 'scope-test-0001', input: { projectId: 'p', title: 'x' } },
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().code, 'INSUFFICIENT_SCOPE');
    assert.equal(response.json().requiredScope, 'ai_bridge:actions');

    const { app: actionsApp, rawKey: actionsKey } = await keyFor(t, { scopes: ['ai_bridge:actions'] });
    const chat = await actionsApp.inject({
      method: 'POST', url: '/api/ai-bridge/v1/chat/completions', headers: { 'x-api-key': actionsKey },
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(chat.statusCode, 403, chat.body);
    assert.equal(chat.json().code, 'INSUFFICIENT_SCOPE');
  });

  it('denies a key whose owner lost access (insufficient role for workflow actions)', async (t) => {
    const { app, db, rawKey } = await keyFor(t, { scopes: ['ai_bridge:actions'] });
    db.users[0].role = 'CLIENT';
    const response = await app.inject({
      method: 'POST', url: '/api/ai-bridge/v1/actions/prepare', headers: { 'x-api-key': rawKey },
      payload: { action: 'create_task', idempotencyKey: 'scope-test-0002', input: { projectId: 'p', title: 'x' } },
    });
    assert.equal(response.statusCode, 403);
    db.users[0].isActive = false;
    assert.equal((await capabilities(app, rawKey)).statusCode, 401);
  });
});

describe('log redaction', () => {
  it('never writes API keys, session cookies or passwords', () => {
    const lines = [];
    const sink = new Writable({ write(chunk, _enc, done) { lines.push(chunk.toString()); done(); } });
    const logger = pino({ redact: { ...LOG_REDACT_OPTIONS, paths: [...LOG_REDACT_OPTIONS.paths] } }, sink);
    logger.info({
      req: { headers: { authorization: 'Bearer ashbi_secret1', 'x-api-key': 'ashbi_secret2', cookie: 'token=secret3; reauth=secret4' } },
      apiKey: 'ashbi_secret5',
      body: { password: 'secret6' },
    }, 'request');
    const output = lines.join('');
    for (const secret of ['secret1', 'secret2', 'secret3', 'secret4', 'secret5', 'secret6']) {
      assert.ok(!output.includes(secret), `${secret} redacted`);
    }
    assert.match(output, /\[Redacted\]/);
  });
});
