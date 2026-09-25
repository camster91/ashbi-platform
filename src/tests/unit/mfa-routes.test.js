import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';
process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'unit-test-credentials-key';

const { default: authRoutes } = await import('../../routes/auth.routes.js');
const { default: mfaRoutes } = await import('../../routes/mfa.routes.js');
const { LocalAuthProvider } = await import('../../auth/providers/local.provider.js');
const { isCurrentUserSession, signUserSession } = await import('../../auth/session.js');
const { hotp, totp, totpStep } = await import('../../auth/totp.js');
const {
  createMfaChallenge,
  decryptMfaSecret,
  hashRecoveryCode,
  MFA_MAX_FAILED_ATTEMPTS,
  verifyMfaChallenge,
} = await import('../../auth/mfa.js');

const PASSWORD = 'Correct-Horse-9';
const PASSWORD_HASH = await bcrypt.hash(PASSWORD, 4);

function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'staff@agency.test',
    name: 'Staff Member',
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

function fakePrisma(users) {
  const db = { users, notifications: [], auditEvents: [] };
  db.client = {
    user: {
      findUnique: async ({ where }) => {
        const row = db.users.find((u) => (where.id ? u.id === where.id : u.email === where.email));
        return row ? structuredClone(row) : null;
      },
      // Models Prisma's extended-where update: one atomic conditional
      // UPDATE ... RETURNING that throws P2025 when no row matches.
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
    organization: { upsert: async () => ({ id: 'org-1' }) },
    notification: { create: async ({ data }) => { db.notifications.push(data); return data; } },
    auditEvent: { create: async ({ data }) => { db.auditEvents.push(data); return data; } },
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
  app.decorate('auth', new LocalAuthProvider(db.client, app.jwt));
  app.addHook('onRequest', async (request) => { request.prisma = db.client; });
  await app.register(authRoutes);
  await app.register(mfaRoutes);
  t.after(() => app.close());
  return app;
}

function sessionCookie(app, user) {
  return { token: signUserSession(app.jwt, user) };
}

function tokenCookie(response) {
  return response.cookies.find((cookie) => cookie.name === 'token');
}

/** Enroll the fake user through the real endpoints and return the plain secret + recovery codes. */
async function enroll(app, db) {
  const cookies = sessionCookie(app, db.users[0]);
  const started = await app.inject({ method: 'POST', url: '/mfa/enroll', cookies, payload: { password: PASSWORD } });
  assert.equal(started.statusCode, 200, started.body);
  const { secret } = started.json();
  const confirmed = await app.inject({ method: 'POST', url: '/mfa/confirm', cookies, payload: { code: totp(secret) } });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  // Enrollment claimed the current step; let the login tests use a fresh one.
  db.users[0].mfaLastUsedStep = totpStep() - 2;
  return { secret, recoveryCodes: confirmed.json().recoveryCodes, cookie: tokenCookie(confirmed) };
}

async function passwordLogin(app) {
  const response = await app.inject({ method: 'POST', url: '/login', payload: { email: 'staff@agency.test', password: PASSWORD } });
  assert.equal(response.statusCode, 200, response.body);
  return response;
}

function wrongCode(secret) {
  const step = totpStep();
  const valid = new Set([-1, 0, 1].map((offset) => hotp(secret, step + offset)));
  for (let i = 0; ; i += 1) {
    const candidate = String(i).padStart(6, '0');
    if (!valid.has(candidate)) return candidate;
  }
}

describe('MFA enrollment', () => {
  it('stores the secret encrypted, confirms with a code, and returns 10 hashed recovery codes once', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const cookies = sessionCookie(app, db.users[0]);

    const noPassword = await app.inject({ method: 'POST', url: '/mfa/enroll', cookies, payload: {} });
    assert.equal(noPassword.statusCode, 400);
    const wrongPassword = await app.inject({ method: 'POST', url: '/mfa/enroll', cookies, payload: { password: 'not-my-password' } });
    assert.equal(wrongPassword.statusCode, 400, 'a stolen session alone cannot bind an authenticator');
    assert.equal(db.users[0].mfaSecret, null);

    const started = await app.inject({ method: 'POST', url: '/mfa/enroll', cookies, payload: { password: PASSWORD } });
    assert.equal(started.statusCode, 200);
    const { secret, otpauthUri } = started.json();
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.match(otpauthUri, /^otpauth:\/\/totp\/Ashbi%20Hub%3Astaff%40agency\.test\?/);
    assert.equal(started.headers['cache-control'], 'no-store');
    assert.notEqual(db.users[0].mfaSecret, secret, 'secret is never stored in plaintext');
    assert.ok(!db.users[0].mfaSecret.includes(secret));
    assert.equal(decryptMfaSecret(db.users[0].mfaSecret), secret);
    assert.equal(db.users[0].mfaEnabled, false);

    const status = await app.inject({ method: 'GET', url: '/mfa', cookies });
    assert.deepEqual(status.json(), { eligible: true, enabled: false, enabledAt: null, pendingEnrollment: true, recoveryCodesRemaining: 0 });

    const wrong = await app.inject({ method: 'POST', url: '/mfa/confirm', cookies, payload: { code: wrongCode(secret) } });
    assert.equal(wrong.statusCode, 400);
    assert.equal(db.users[0].mfaEnabled, false);

    const confirmed = await app.inject({ method: 'POST', url: '/mfa/confirm', cookies, payload: { code: totp(secret) } });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    const { recoveryCodes } = confirmed.json();
    assert.equal(recoveryCodes.length, 10);
    assert.equal(new Set(recoveryCodes).size, 10);
    recoveryCodes.forEach((code) => assert.match(code, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/));
    assert.deepEqual(db.users[0].mfaRecoveryCodes, recoveryCodes.map(hashRecoveryCode));
    assert.ok(!JSON.stringify(db.users[0]).includes(recoveryCodes[0]), 'recovery codes are stored hashed');
    assert.equal(db.users[0].mfaEnabled, true);

    // Enabling revokes other sessions but keeps this browser signed in.
    assert.equal(db.users[0].sessionVersion, 1);
    assert.equal(await isCurrentUserSession(db.client, app.jwt.verify(cookies.token)), false);
    const renewed = tokenCookie(confirmed);
    assert.ok(renewed);
    assert.equal(app.jwt.verify(renewed.value).sessionVersion, 1);
    assert.equal(db.notifications.at(-1).type, 'security.mfa_enabled');
    assert.ok(!JSON.stringify(db.notifications).includes(secret));

    const again = await app.inject({ method: 'POST', url: '/mfa/enroll', cookies: { token: renewed.value }, payload: { password: PASSWORD } });
    assert.equal(again.statusCode, 409, 'cannot silently replace an active authenticator');
  });

  it('is available to every staff role and refused to client and bot identities', async (t) => {
    for (const role of ['CLIENT', 'BOT']) {
      const db = fakePrisma([makeUser({ role })]);
      const app = await buildApp(t, db);
      const response = await app.inject({ method: 'POST', url: '/mfa/enroll', cookies: sessionCookie(app, db.users[0]), payload: { password: PASSWORD } });
      assert.equal(response.statusCode, 403, role);
      assert.equal(db.users[0].mfaSecret, null);
    }
    for (const role of ['ADMIN', 'TEAM', 'STAFF']) {
      const db = fakePrisma([makeUser({ role })]);
      const app = await buildApp(t, db);
      const response = await app.inject({ method: 'POST', url: '/mfa/enroll', cookies: sessionCookie(app, db.users[0]), payload: { password: PASSWORD } });
      assert.equal(response.statusCode, 200, role);
    }
  });

  it('keeps requiring the second factor after a role change', async (t) => {
    const db = fakePrisma([makeUser({ role: 'STAFF' })]);
    const app = await buildApp(t, db);
    await enroll(app, db);
    db.users[0].role = 'CLIENT';
    const response = await passwordLogin(app);
    assert.equal(response.json().mfaRequired, true);
    assert.equal(tokenCookie(response), undefined);
  });

  it('requires a session', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const response = await app.inject({ method: 'POST', url: '/mfa/enroll', payload: { password: PASSWORD } });
    assert.equal(response.statusCode, 401);
  });

  it('disables only with the current password and a valid code, revoking other sessions', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const { secret, cookie } = await enroll(app, db);
    const cookies = { token: cookie.value };

    const badPassword = await app.inject({ method: 'POST', url: '/mfa/disable', cookies, payload: { password: 'wrong-password', code: totp(secret) } });
    assert.equal(badPassword.statusCode, 400);
    const badCode = await app.inject({ method: 'POST', url: '/mfa/disable', cookies, payload: { password: PASSWORD, code: wrongCode(secret) } });
    assert.equal(badCode.statusCode, 400, 'a wrong code must not look like an expired session');
    const noFactor = await app.inject({ method: 'POST', url: '/mfa/disable', cookies, payload: { password: PASSWORD } });
    assert.equal(noFactor.statusCode, 400);
    assert.equal(db.users[0].mfaEnabled, true);

    const versionBefore = db.users[0].sessionVersion;
    const disabled = await app.inject({ method: 'POST', url: '/mfa/disable', cookies, payload: { password: PASSWORD, code: totp(secret) } });
    assert.equal(disabled.statusCode, 200, disabled.body);
    assert.equal(db.users[0].mfaEnabled, false);
    assert.equal(db.users[0].mfaSecret, null);
    assert.deepEqual(db.users[0].mfaRecoveryCodes, []);
    assert.equal(db.users[0].sessionVersion, versionBefore + 1);
    assert.equal(app.jwt.verify(tokenCookie(disabled).value).sessionVersion, versionBefore + 1);
    assert.equal(db.notifications.at(-1).type, 'security.mfa_disabled');

    const login = await passwordLogin(app);
    assert.ok(tokenCookie(login), 'password-only login resumes after disabling');
  });
});

describe('MFA login challenge', () => {
  it('withholds the session until a valid code is supplied', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const { secret } = await enroll(app, db);

    const first = await passwordLogin(app);
    assert.equal(tokenCookie(first), undefined, 'no session cookie before the second factor');
    const body = first.json();
    assert.equal(body.mfaRequired, true);
    assert.equal(body.user, undefined);
    assert.ok(verifyMfaChallenge(body.challengeToken));
    assert.throws(() => app.jwt.verify(body.challengeToken), 'a challenge is never a valid session JWT');

    const done = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken: body.challengeToken, code: totp(secret) } });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().user.email, 'staff@agency.test');
    assert.equal(done.json().method, 'totp');
    const session = tokenCookie(done);
    assert.ok(session);
    assert.equal(session.httpOnly, true);
    assert.equal(await isCurrentUserSession(db.client, app.jwt.verify(session.value)), true);
  });

  it('rejects a wrong code, and a replayed code within its window', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const { secret } = await enroll(app, db);
    const { challengeToken } = (await passwordLogin(app)).json();

    const wrong = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken, code: wrongCode(secret) } });
    assert.equal(wrong.statusCode, 401);
    assert.equal(tokenCookie(wrong), undefined);
    assert.equal(db.users[0].mfaFailedAttempts, 1);

    const code = totp(secret);
    const ok = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken, code } });
    assert.equal(ok.statusCode, 200);
    assert.equal(db.users[0].mfaFailedAttempts, 0, 'success resets the failure counter');

    const replay = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken, code } });
    assert.equal(replay.statusCode, 401);
    assert.match(replay.json().error, /already used/);
    assert.equal(tokenCookie(replay), undefined);
  });

  it('accepts each recovery code once, bumps the session version and notifies', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const { recoveryCodes } = await enroll(app, db);
    const versionBefore = db.users[0].sessionVersion;

    let { challengeToken } = (await passwordLogin(app)).json();
    const used = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken, recoveryCode: recoveryCodes[3].toUpperCase() } });
    assert.equal(used.statusCode, 200, used.body);
    assert.equal(used.json().method, 'recovery_code');
    assert.equal(used.json().recoveryCodesRemaining, 9);
    assert.equal(db.users[0].sessionVersion, versionBefore + 1);
    assert.equal(app.jwt.verify(tokenCookie(used).value).sessionVersion, versionBefore + 1);
    assert.equal(db.notifications.at(-1).type, 'security.mfa_recovery_code_used');
    assert.ok(!JSON.stringify(db.notifications).includes(recoveryCodes[3]));

    ({ challengeToken } = (await passwordLogin(app)).json());
    const reused = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken, recoveryCode: recoveryCodes[3] } });
    assert.equal(reused.statusCode, 401);
    assert.equal(db.users[0].mfaRecoveryCodes.length, 9);
  });

  it('invalidates outstanding challenges when the session version changes', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const { secret } = await enroll(app, db);
    const { challengeToken } = (await passwordLogin(app)).json();
    db.users[0].sessionVersion += 1; // e.g. a password reset

    const response = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken, code: totp(secret) } });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, 'MFA_CHALLENGE_EXPIRED');
  });

  it('rejects forged and expired challenges', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const { secret } = await enroll(app, db);
    const expired = createMfaChallenge(db.users[0], { nowMs: Date.now() - 10 * 60 * 1000 });
    const valid = createMfaChallenge(db.users[0]);
    const [, payload, signature] = valid.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), uid: 'user-2' })).toString('base64url');

    for (const challengeToken of [expired, `mfa.${forgedPayload}.${signature}`, 'mfa.x.y', signUserSession(app.jwt, db.users[0])]) {
      const response = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken, code: totp(secret) } });
      assert.equal(response.statusCode, 401, challengeToken);
    }
  });

  it('locks the second factor for the account after repeated wrong codes', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const { secret } = await enroll(app, db);
    const { challengeToken } = (await passwordLogin(app)).json();

    for (let i = 1; i < MFA_MAX_FAILED_ATTEMPTS; i += 1) {
      const response = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken, code: wrongCode(secret) } });
      assert.equal(response.statusCode, 401);
    }
    const locking = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken, code: wrongCode(secret) } });
    assert.equal(locking.statusCode, 429);
    assert.ok(db.users[0].mfaLockedUntil > new Date());

    // The challenge that burned the budget is dead even with a correct code…
    const sameChallenge = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken, code: totp(secret) } });
    assert.equal(sameChallenge.statusCode, 401);
    assert.equal(sameChallenge.json().code, 'MFA_CHALLENGE_EXPIRED');
    assert.equal(tokenCookie(sameChallenge), undefined);

    // …and a fresh challenge stays locked out until the lock expires.
    await new Promise((resolve) => { setTimeout(resolve, 1100); });
    const fresh = (await passwordLogin(app)).json();
    const correctButLocked = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken: fresh.challengeToken, code: totp(secret) } });
    assert.equal(correctButLocked.statusCode, 429);
    assert.equal(tokenCookie(correctButLocked), undefined);

    db.users[0].mfaLockedUntil = new Date(Date.now() - 1000);
    const afterExpiry = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken: fresh.challengeToken, code: totp(secret) } });
    assert.equal(afterExpiry.statusCode, 200, afterExpiry.body);
  });

  it('rate-limits the challenge endpoint per IP', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      const response = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken: 'mfa.bogus.token', code: '123456' } });
      statuses.push(response.statusCode);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.equal(statuses[10], 429);
  });

  it('leaves password-only login unchanged for users without MFA', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const response = await passwordLogin(app);
    assert.equal(response.json().mfaRequired, undefined);
    assert.equal(response.json().user.email, 'staff@agency.test');
    assert.ok(tokenCookie(response));
  });
});

describe('MFA lockout under concurrency', () => {
  it('evaluates at most 5 codes even when many wrong codes arrive in parallel from many IPs', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const { secret } = await enroll(app, db);
    const { challengeToken } = (await passwordLogin(app)).json();
    const bad = wrongCode(secret);

    const responses = await Promise.all(Array.from({ length: 60 }, (_, i) => app.inject({
      method: 'POST',
      url: '/login/mfa',
      remoteAddress: `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`,
      payload: { challengeToken, code: bad },
    })));

    const evaluatedAndRejected = responses.filter((r) => r.statusCode === 401 && r.json().error === 'Invalid authentication code').length;
    const refused = responses.filter((r) => r.statusCode === 429 || r.json().code === 'MFA_CHALLENGE_EXPIRED').length;
    // Attempts 1-4 are evaluated and rejected, attempt 5 is evaluated and
    // locks; every other request is refused without evaluating its code
    // (locked, or its challenge was revoked by the lock).
    assert.equal(evaluatedAndRejected, MFA_MAX_FAILED_ATTEMPTS - 1);
    assert.equal(refused, 60 - evaluatedAndRejected);
    assert.ok(responses.every((r) => !tokenCookie(r)));
    assert.ok(db.users[0].mfaLockedUntil > new Date());
    assert.equal(db.users[0].mfaFailedAttempts, 0, 'no attempts are counted while locked');
  });

  it('evaluates at most 5 codes when parallel requests are spread over fresh challenges', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const { secret } = await enroll(app, db);
    const challenges = [];
    for (let i = 0; i < 3; i += 1) challenges.push((await passwordLogin(app)).json().challengeToken);
    const bad = wrongCode(secret);

    const responses = await Promise.all(Array.from({ length: 30 }, (_, i) => app.inject({
      method: 'POST',
      url: '/login/mfa',
      remoteAddress: `10.1.0.${i + 1}`,
      payload: { challengeToken: challenges[i % 3], code: bad },
    })));
    const evaluated = responses.filter((r) => r.statusCode === 401 && r.json().error === 'Invalid authentication code').length;
    assert.equal(evaluated, MFA_MAX_FAILED_ATTEMPTS - 1);
    assert.ok(db.users[0].mfaLockedUntil > new Date());
  });
});

describe('MFA admin reset', () => {
  function orgUsers() {
    return [
      makeUser({ id: 'admin-1', email: 'admin@agency.test', role: 'ADMIN' }),
      makeUser({ id: 'user-1', email: 'staff@agency.test', role: 'STAFF' }),
      makeUser({ id: 'other-1', email: 'other@elsewhere.test', role: 'STAFF', organizationId: 'org-2', mfaEnabled: true, mfaSecret: 'x' }),
    ];
  }

  async function enrolledTarget(t) {
    const db = fakePrisma(orgUsers());
    const app = await buildApp(t, db);
    const target = db.users[1];
    const cookies = sessionCookie(app, target);
    const { secret } = (await app.inject({ method: 'POST', url: '/mfa/enroll', cookies, payload: { password: PASSWORD } })).json();
    await app.inject({ method: 'POST', url: '/mfa/confirm', cookies, payload: { code: totp(secret) } });
    assert.equal(target.mfaEnabled, true);
    target.mfaLockedUntil = new Date(Date.now() + 60_000);
    return { db, app, target, adminCookies: sessionCookie(app, db.users[0]) };
  }

  it('resets and unlocks a same-organization user, revoking their sessions and notifying them', async (t) => {
    const { db, app, target, adminCookies } = await enrolledTarget(t);
    const targetSession = sessionCookie(app, target);
    const versionBefore = target.sessionVersion;

    const response = await app.inject({ method: 'POST', url: '/mfa/admin/users/user-1/reset', cookies: adminCookies, payload: { password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(target.mfaEnabled, false);
    assert.equal(target.mfaSecret, null);
    assert.deepEqual(target.mfaRecoveryCodes, []);
    assert.equal(target.mfaLockedUntil, null);
    assert.equal(target.sessionVersion, versionBefore + 1);
    assert.equal(await isCurrentUserSession(db.client, app.jwt.verify(targetSession.token)), false);
    const notice = db.notifications.at(-1);
    assert.equal(notice.userId, 'user-1');
    assert.equal(notice.type, 'security.mfa_admin_reset');
    assert.equal(notice.data.actorUserId, 'admin-1');
    assert.equal(tokenCookie(response), undefined, "the admin's own session is untouched");
  });

  it('requires the admin password, the ADMIN role and the same organization', async (t) => {
    const { db, app, target, adminCookies } = await enrolledTarget(t);

    const wrongPassword = await app.inject({ method: 'POST', url: '/mfa/admin/users/user-1/reset', cookies: adminCookies, payload: { password: 'nope-nope' } });
    assert.equal(wrongPassword.statusCode, 400);
    const crossOrg = await app.inject({ method: 'POST', url: '/mfa/admin/users/other-1/reset', cookies: adminCookies, payload: { password: PASSWORD } });
    assert.equal(crossOrg.statusCode, 404);
    assert.equal(db.users[2].mfaEnabled, true);
    const self = await app.inject({ method: 'POST', url: '/mfa/admin/users/admin-1/reset', cookies: adminCookies, payload: { password: PASSWORD } });
    assert.equal(self.statusCode, 400);

    db.users[0].role = 'STAFF';
    const notAdmin = await app.inject({ method: 'POST', url: '/mfa/admin/users/user-1/reset', cookies: sessionCookie(app, db.users[0]), payload: { password: PASSWORD } });
    assert.equal(notAdmin.statusCode, 403, 'the role is re-read from the database, not trusted from the token');
    assert.equal(target.mfaEnabled, true);
  });
});

describe('MFA hardening follow-ups', () => {
  it('draws enrollment confirmation guesses from the per-account budget', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const cookies = sessionCookie(app, db.users[0]);
    const { secret } = (await app.inject({ method: 'POST', url: '/mfa/enroll', cookies, payload: { password: PASSWORD } })).json();

    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => app.inject({
      method: 'POST', url: '/mfa/confirm', cookies, remoteAddress: `10.2.0.${i + 1}`, payload: { code: wrongCode(secret) },
    })));
    const evaluated = responses.filter((r) => r.statusCode === 400).length;
    assert.equal(evaluated, MFA_MAX_FAILED_ATTEMPTS - 1);
    assert.equal(responses.filter((r) => r.statusCode === 429).length, 12 - evaluated);

    const correctButLocked = await app.inject({ method: 'POST', url: '/mfa/confirm', cookies, payload: { code: totp(secret) } });
    assert.equal(correctButLocked.statusCode, 429);
    assert.equal(db.users[0].mfaEnabled, false);
  });

  async function adminWithMfa(t) {
    const db = fakePrisma([
      makeUser({ id: 'admin-1', email: 'admin@agency.test', role: 'ADMIN' }),
      makeUser({ id: 'user-1', email: 'staff@agency.test', role: 'STAFF', mfaEnabled: true, mfaSecret: 'x' }),
    ]);
    const app = await buildApp(t, db);
    const admin = db.users[0];
    const cookies = sessionCookie(app, admin);
    const { secret } = (await app.inject({ method: 'POST', url: '/mfa/enroll', cookies, payload: { password: PASSWORD } })).json();
    const confirmed = await app.inject({ method: 'POST', url: '/mfa/confirm', cookies, payload: { code: totp(secret) } });
    admin.mfaLastUsedStep = totpStep() - 2;
    return { db, app, secret, recoveryCodes: confirmed.json().recoveryCodes, cookies: { token: tokenCookie(confirmed).value } };
  }

  it("requires the acting admin's own second factor when they use MFA", async (t) => {
    const { db, app, secret, cookies } = await adminWithMfa(t);
    const url = '/mfa/admin/users/user-1/reset';

    const missing = await app.inject({ method: 'POST', url, cookies, payload: { password: PASSWORD } });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().code, 'MFA_CODE_REQUIRED');
    const wrong = await app.inject({ method: 'POST', url, cookies, payload: { password: PASSWORD, code: wrongCode(secret) } });
    assert.equal(wrong.statusCode, 400);
    assert.equal(db.users[1].mfaEnabled, true, 'nothing reset without the admin factor');

    const ok = await app.inject({ method: 'POST', url, cookies, payload: { password: PASSWORD, code: totp(secret) } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(db.users[1].mfaEnabled, false);
  });

  it("accepts the admin's recovery code and keeps the admin signed in", async (t) => {
    const { db, app, recoveryCodes, cookies } = await adminWithMfa(t);
    const response = await app.inject({ method: 'POST', url: '/mfa/admin/users/user-1/reset', cookies, payload: { password: PASSWORD, recoveryCode: recoveryCodes[0] } });
    assert.equal(response.statusCode, 200, response.body);
    const renewed = tokenCookie(response);
    assert.ok(renewed, 'recovery-code use revokes other sessions but reissues this one');
    assert.equal(await isCurrentUserSession(db.client, app.jwt.verify(renewed.value)), true);
    assert.equal(db.users[0].mfaRecoveryCodes.length, 9);
  });
});

describe('MFA audit trail (#412)', () => {
  it('records enable, failed code and disable as tenant-owned audit events without secrets', async (t) => {
    const db = fakePrisma([makeUser()]);
    const app = await buildApp(t, db);
    const { secret } = await enroll(app, db);

    const login = await passwordLogin(app);
    const wrong = await app.inject({ method: 'POST', url: '/login/mfa', payload: { challengeToken: login.json().challengeToken, code: wrongCode(secret) } });
    assert.equal(wrong.statusCode, 401);
    // The failed-code event is written without delaying the response.
    await new Promise((resolve) => setImmediate(resolve));

    db.users[0].mfaLastUsedStep = totpStep() - 2;
    const cookies = sessionCookie(app, db.users[0]);
    const disabled = await app.inject({ method: 'POST', url: '/mfa/disable', cookies, payload: { password: PASSWORD, code: totp(secret) } });
    assert.equal(disabled.statusCode, 200, disabled.body);

    const actions = db.auditEvents.map((event) => event.action);
    assert.deepEqual(actions, ['auth.mfa_enabled', 'auth.mfa_failed', 'auth.mfa_disabled']);
    for (const event of db.auditEvents) {
      assert.equal(event.organizationId, 'org-1');
      assert.equal(event.entityId, 'user-1');
      assert.equal(event.actorUserId, 'user-1');
      assert.equal(event.actorType, 'USER');
      assert.ok(!JSON.stringify(event).includes(secret), 'no TOTP secret in audit rows');
    }
    assert.deepEqual(db.auditEvents[0].metadata, { recoveryCodesIssued: 10 });
    assert.deepEqual(db.auditEvents[1].metadata, { reason: 'invalid' });
    assert.deepEqual(db.auditEvents[2].metadata, { method: 'totp' });
  });

  it('attributes an admin reset to the acting admin', async (t) => {
    const admin = makeUser({ id: 'admin-1', email: 'admin@agency.test' });
    const member = makeUser({ id: 'member-1', email: 'member@agency.test', role: 'TEAM', mfaEnabled: true, mfaSecret: 'x' });
    const db = fakePrisma([admin, member]);
    const app = await buildApp(t, db);
    const cookies = sessionCookie(app, admin);

    const reset = await app.inject({ method: 'POST', url: '/mfa/admin/users/member-1/reset', cookies, payload: { password: PASSWORD } });
    assert.equal(reset.statusCode, 200, reset.body);

    const event = db.auditEvents.find((row) => row.action === 'auth.mfa_reset');
    assert.ok(event, 'reset is audited');
    assert.equal(event.actorUserId, 'admin-1');
    assert.equal(event.entityId, 'member-1');
    assert.equal(event.organizationId, 'org-1');
    assert.deepEqual(event.metadata, { wasEnabled: true });
  });
});
