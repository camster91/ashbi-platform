// Audited, read-only support impersonation (#416, docs/privileged-actions.md).
// Runs the real hook, decorators, routes and tenant proxy against an
// in-memory database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import pino from 'pino';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';
process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'unit-test-credentials-key';
process.env.PLATFORM_OPERATOR_USER_IDS = 'operator-a';

const { default: envConfig } = await import('../../config/env.js');
envConfig.platformOperatorUserIds = ['operator-a'];
const { createFakeIdentityDb, seedIdentityOrganizations } = await import('../helpers/fake-identity-db.js');
const { reauthCookies } = await import('../helpers/reauth.js');
const { isCurrentUserSession, signUserSession } = await import('../../auth/session.js');
const { requireRecentAuth } = await import('../../auth/reauth.js');
const {
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_SECONDS,
  applyImpersonation,
  createImpersonationHook,
  impersonationDenial,
  signImpersonationToken,
  verifyImpersonationToken,
} = await import('../../auth/impersonation.js');
const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { enterRequestContext } = await import('../../utils/request-context.js');
const { isTenancyExemptUrl } = await import('../../middleware/tenancy.js');
const { recordAuditEvent, recordRequestAuditEvent } = await import('../../services/audit-event.service.js');
const { default: authRoutes } = await import('../../routes/auth.routes.js');
const { default: teamRoutes } = await import('../../routes/team.routes.js');
const { default: privilegedAccessRoutes } = await import('../../routes/privileged-access.routes.js');
const { default: clientPortalRoutes } = await import('../../routes/client-portal.routes.js');

const SESSION_IAT = Math.floor(Date.now() / 1000) - 60;
const REASON = 'Customer ticket 4412: task list looks empty';

async function buildApp(t, { db = seedIdentityOrganizations(createFakeIdentityDb()) } = {}) {
  const lines = [];
  const stream = new Writable({ write(chunk, _enc, done) { lines.push(chunk.toString()); done(); } });
  const app = Fastify({ loggerInstance: pino({ level: 'info' }, stream) });
  await app.register(fastifyCookie);
  await app.register(rateLimit, { global: false });
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET, cookie: { cookieName: 'token', signed: false } });

  // Same wiring as src/index.js: the impersonation hook, then decorators
  // that re-apply the view after re-verifying the session cookie.
  app.addHook('onRequest', createImpersonationHook({ prisma: db, isCurrentUserSession }));
  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
      if (!(await isCurrentUserSession(db, request.user))) throw new Error('revoked');
      applyImpersonation(request);
    } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });
  app.decorate('adminOnly', async (request, reply) => {
    try {
      await request.jwtVerify();
      if (!(await isCurrentUserSession(db, request.user))) throw new Error('revoked');
      applyImpersonation(request);
      if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
    } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });
  app.decorate('auth', {});
  // Mirrors tenancyMiddleware (which is bound to the real client).
  app.addHook('preHandler', async (request, reply) => {
    const impersonation = request.impersonation
      ? { organizationId: request.impersonation.organizationId, actorUserId: request.impersonation.actorUserId, subjectUserId: request.impersonation.subjectUserId, sessionId: request.impersonation.sessionId }
      : null;
    if (isTenancyExemptUrl(request.url)) {
      request.prisma = db;
      enterRequestContext({ prisma: db, organizationId: null, impersonation });
      return undefined;
    }
    if (request.user?.role === 'CLIENT') return reply.status(403).send({ error: 'Client portal sessions cannot access staff APIs', code: 'CLIENT_SESSION_FORBIDDEN' });
    if (!request.user?.organizationId) return reply.status(403).send({ code: 'ORG_CONTEXT_REQUIRED' });
    request.prisma = createScopedPrisma(db, request.user.organizationId);
    enterRequestContext({ prisma: request.prisma, organizationId: request.user.organizationId, impersonation });
    return undefined;
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(privilegedAccessRoutes, { prefix: '/api/auth', prisma: db });
  await app.register(teamRoutes, { prefix: '/api/team' });
  await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
  const handled = [];
  await app.register(async (probe) => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      probe.route({
        method,
        url: '/api/probe',
        onRequest: [app.authenticate],
        handler: async (request) => {
          handled.push(`${method} ${request.user.id}`);
          // An audit write naming the (viewed) user as the actor.
          await recordRequestAuditEvent(request.prisma, request, { action: 'user.reactivated', entityId: 'probe', metadata: { fromActive: false, toActive: true } });
          await recordAuditEvent(request.prisma, { organizationId: request.user.organizationId, actorType: 'USER', actorUserId: request.user.id, action: 'user.deactivated', entityId: 'probe' });
          return { user: request.user.id, role: request.user.role };
        },
      });
    }
    probe.get('/api/probe/step-up', { onRequest: [app.authenticate], preHandler: [requireRecentAuth] }, async () => ({ ok: true }));
    probe.get('/api/probe/admin', { onRequest: [app.adminOnly] }, async () => ({ ok: true }));
    // Stand-ins for sensitive areas, to prove they are refused before any handler.
    for (const url of ['/api/api-keys', '/api/credentials/cred-1', '/api/audit-events', '/api/ai-connections']) {
      probe.get(url, { onRequest: [app.authenticate] }, async () => { handled.push(`GET ${url}`); return {}; });
    }
    probe.post('/api/ai-tools/approvals/:id/approve', { onRequest: [app.authenticate] }, async () => { handled.push('approve'); return {}; });
    probe.post('/api/portal/invoice/:token/pay', async () => { handled.push('pay'); return {}; });
  });
  t.after(() => app.close());

  const users = Object.fromEntries(db.tables.user.map((user) => [user.id, user]));
  const session = (id) => {
    const user = db.tables.user.find((row) => row.id === id);
    // A fixed iat so the reauth helper's binding matches.
    return app.jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role, clientId: user.clientId, organizationId: user.organizationId, sessionVersion: user.sessionVersion, iat: SESSION_IAT }, { expiresIn: '7d' });
  };
  const cookiesFor = (id, extra = {}) => ({ token: session(id), ...extra });
  const stepUp = (id) => reauthCookies({ id, sessionVersion: db.tables.user.find((row) => row.id === id).sessionVersion, iat: SESSION_IAT });
  const start = (actor, userId, reason = REASON, { reauth = true } = {}) => app.inject({
    method: 'POST', url: '/api/auth/impersonation', payload: { userId, reason },
    cookies: cookiesFor(actor, reauth ? stepUp(actor) : {}),
  });
  const startOk = async (actor = 'admin-a', subject = 'team-a') => {
    const response = await start(actor, subject);
    assert.equal(response.statusCode, 201, response.body);
    const cookie = response.cookies.find((c) => c.name === IMPERSONATION_COOKIE);
    assert.ok(cookie, 'impersonation cookie set');
    return { response, cookie, cookies: cookiesFor(actor, { [IMPERSONATION_COOKIE]: cookie.value }) };
  };
  return { app, db, users, lines, handled, session, cookiesFor, stepUp, start, startOk };
}

const audits = (db, action) => db.tables.auditEvent.filter((event) => event.action === action);
const cleared = (response) => response.cookies.some((c) => c.name === IMPERSONATION_COOKIE && (c.value === '' || c.maxAge === 0 || (c.expires && c.expires.getTime() <= Date.now())));

describe('starting a support view', () => {
  it('refuses a non-admin', async (t) => {
    const { start, db } = await buildApp(t);
    const response = await start('team-a', 'client-user-a');
    assert.equal(response.statusCode, 403);
    assert.equal(db.tables.impersonationSession.length, 0);
  });

  it('requires recent re-authentication', async (t) => {
    const { start, db } = await buildApp(t);
    const response = await start('admin-a', 'team-a', REASON, { reauth: false });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 'REAUTH_REQUIRED');
    assert.equal(db.tables.impersonationSession.length, 0);
  });

  it('never reaches another organization (answers 404, like a missing user)', async (t) => {
    const { start, db } = await buildApp(t);
    const foreign = await start('admin-a', 'team-b');
    assert.equal(foreign.statusCode, 404);
    assert.equal(foreign.json().code, 'IMPERSONATION_TARGET_NOT_FOUND');
    const missing = await start('admin-a', 'nobody');
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), foreign.json());
    assert.equal(db.tables.impersonationSession.length, 0);
    assert.equal(audits(db, 'impersonation.started').length, 0);
  });

  it('refuses another administrator, yourself, a bot, a platform operator and a deactivated account', async (t) => {
    const { start, db } = await buildApp(t);
    const cases = [
      ['admin-a2', 403, 'IMPERSONATION_TARGET_FORBIDDEN'],
      ['admin-a', 400, 'IMPERSONATION_SELF'],
      ['bot-a', 403, 'IMPERSONATION_TARGET_FORBIDDEN'],
      ['operator-a', 403, 'IMPERSONATION_TARGET_FORBIDDEN'],
      ['team-a-inactive', 409, 'IMPERSONATION_TARGET_INACTIVE'],
      ['client-user-a-nocontact', 409, 'IMPERSONATION_TARGET_NO_PORTAL'],
    ];
    for (const [target, status, code] of cases) {
      const response = await start('admin-a', target);
      assert.equal(response.statusCode, status, `${target}: ${response.body}`);
      assert.equal(response.json().code, code, target);
    }
    assert.equal(db.tables.impersonationSession.length, 0);
  });

  it('requires a reason of 10 to 500 characters', async (t) => {
    const { start } = await buildApp(t);
    assert.equal((await start('admin-a', 'team-a', 'short')).statusCode, 400);
    assert.equal((await start('admin-a', 'team-a', 'x'.repeat(501))).statusCode, 400);
    assert.equal((await start('admin-a', 'team-a', '          ')).statusCode, 400);
  });

  it('opens a 30-minute read-only view, audits both identities and notifies the viewed person', async (t) => {
    const { startOk, db } = await buildApp(t);
    const before = Date.now();
    const { response, cookie } = await startOk();

    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Strict');
    assert.equal(cookie.path, '/');
    assert.equal(cookie.maxAge, IMPERSONATION_TTL_SECONDS);
    assert.equal(IMPERSONATION_TTL_SECONDS, 30 * 60);
    assert.equal(response.headers['cache-control'], 'no-store');
    const claims = verifyImpersonationToken(cookie.value);
    assert.equal(claims.act, 'admin-a');
    assert.equal(claims.sub, 'team-a');
    assert.equal(claims.org, 'org-a');

    const [row] = db.tables.impersonationSession;
    assert.equal(row.organizationId, 'org-a');
    assert.equal(row.actorUserId, 'admin-a');
    assert.equal(row.subjectUserId, 'team-a');
    assert.equal(row.subjectRole, 'TEAM');
    assert.equal(row.reason, REASON);
    assert.equal(row.readOnly, true);
    const ttl = row.expiresAt.getTime() - row.startedAt.getTime();
    assert.equal(ttl, IMPERSONATION_TTL_SECONDS * 1000);
    assert.ok(row.startedAt.getTime() >= before);

    const body = response.json();
    assert.equal(body.session.subject.name, 'Terry Team');
    assert.equal(body.session.readOnly, true);

    const [event] = audits(db, 'impersonation.started');
    assert.equal(event.organizationId, 'org-a');
    assert.equal(event.actorUserId, 'admin-a');
    assert.equal(event.actorType, 'USER');
    assert.equal(event.entityType, 'impersonation_session');
    assert.equal(event.entityId, row.id);
    assert.equal(event.metadata.subjectUserId, 'team-a');
    assert.equal(event.metadata.impersonatedUserId, 'team-a');
    assert.equal(event.metadata.impersonationSessionId, row.id);
    assert.equal(event.metadata.readOnly, true);
    assert.equal(event.metadata.ttlSeconds, 1800);
    assert.ok(!JSON.stringify(event.metadata).includes('ticket'), 'the free-text reason stays out of audit metadata');

    const [note] = db.tables.notification;
    assert.equal(note.userId, 'team-a');
    assert.equal(note.type, 'security.impersonation_started');
    assert.match(note.message, /Avery Admin/);
    assert.match(note.message, /read-only/);
    assert.match(note.message, /ticket 4412/);
  });

  it('allows every non-admin staff role (TEAM from registration, STAFF from the Team page)', async (t) => {
    const { startOk, db } = await buildApp(t);
    await startOk('admin-a', 'staff-a');
    assert.equal(db.tables.impersonationSession[0].subjectRole, 'STAFF');
  });

  it('ends the previous view when an admin starts another', async (t) => {
    const { startOk, db } = await buildApp(t);
    await startOk('admin-a', 'team-a');
    await startOk('admin-a', 'client-user-a');
    const [first, second] = db.tables.impersonationSession;
    assert.equal(first.endReason, 'superseded');
    assert.ok(first.endedAt);
    assert.equal(second.endedAt, undefined);
    assert.equal(audits(db, 'impersonation.ended')[0].metadata.reason, 'superseded');
  });
});

describe('while viewing as someone', () => {
  it('acts as the viewed person and reports the view on /api/auth/me', async (t) => {
    const { startOk, app } = await buildApp(t);
    const { cookies } = await startOk();
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().id, 'team-a');
    assert.equal(me.json().impersonation.actor.id, 'admin-a');
    assert.equal(me.json().impersonation.subject.name, 'Terry Team');
    assert.equal(me.json().impersonation.readOnly, true);
    const probe = await app.inject({ method: 'GET', url: '/api/probe', cookies });
    assert.deepEqual(probe.json(), { user: 'team-a', role: 'TEAM' });
    const status = await app.inject({ method: 'GET', url: '/api/auth/impersonation', cookies });
    assert.equal(status.json().active, true);
    assert.equal(status.json().session.subject.id, 'team-a');
  });

  it('refuses every mutating method with 403 IMPERSONATION_READ_ONLY before the handler runs', async (t) => {
    const { startOk, app, handled, db } = await buildApp(t);
    const { cookies } = await startOk();
    const eventsBefore = db.tables.auditEvent.length;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await app.inject({ method, url: '/api/probe', cookies, payload: {} });
      assert.equal(response.statusCode, 403, method);
      assert.equal(response.json().code, 'IMPERSONATION_READ_ONLY', method);
    }
    const pay = await app.inject({ method: 'POST', url: '/api/portal/invoice/tok/pay', cookies, payload: {} });
    assert.equal(pay.json().code, 'IMPERSONATION_READ_ONLY');
    const teamWrite = await app.inject({ method: 'PUT', url: '/api/team/team-a', cookies, payload: { name: 'Changed' } });
    assert.equal(teamWrite.json().code, 'IMPERSONATION_READ_ONLY');
    assert.deepEqual(handled, []);
    assert.equal(db.tables.auditEvent.length, eventsBefore);
    assert.equal(db.tables.user.find((u) => u.id === 'team-a').name, 'Terry Team');
  });

  it('blocks sensitive areas for every method, including reads', async (t) => {
    const { startOk, app, handled } = await buildApp(t);
    const { cookies } = await startOk();
    const blocked = [
      ['GET', '/api/auth/mfa'],
      ['POST', '/api/auth/mfa/disable'],
      ['POST', '/api/auth/reauth'],
      ['POST', '/api/auth/change-password'],
      ['GET', '/api/api-keys'],
      ['GET', '/api/credentials/cred-1'],
      ['GET', '/api/audit-events'],
      ['GET', '/api/ai-connections'],
      ['POST', '/api/ai-tools/approvals/a1/approve'],
      ['POST', '/api/auth/impersonation'],
      ['POST', '/api/auth/break-glass/redeem'],
    ];
    for (const [method, url] of blocked) {
      const response = await app.inject({ method, url, cookies, payload: {} });
      assert.equal(response.statusCode, 403, `${method} ${url}`);
      assert.equal(response.json().code, 'IMPERSONATION_BLOCKED', `${method} ${url}`);
    }
    assert.deepEqual(handled, []);
    // Step-up routes refuse a view without prompting for re-authentication.
    const stepUp = await app.inject({ method: 'GET', url: '/api/probe/step-up', cookies });
    assert.equal(stepUp.statusCode, 403);
    assert.equal(stepUp.json().code, 'IMPERSONATION_BLOCKED');
    // Admin-only routes see the viewed person's role.
    const admin = await app.inject({ method: 'GET', url: '/api/probe/admin', cookies });
    assert.equal(admin.statusCode, 403);
    const sessions = await app.inject({ method: 'GET', url: '/api/auth/impersonation/sessions', cookies });
    assert.equal(sessions.statusCode, 403);
  });

  it('records the real admin as actor and the viewed person on every audit event and log line', async (t) => {
    const { startOk, app, db, lines } = await buildApp(t);
    const { cookies } = await startOk();
    const sessionId = db.tables.impersonationSession[0].id;
    const response = await app.inject({ method: 'GET', url: '/api/probe', cookies });
    assert.equal(response.statusCode, 200, response.body);
    for (const action of ['user.reactivated', 'user.deactivated']) {
      const [event] = audits(db, action);
      assert.equal(event.actorUserId, 'admin-a', action);
      assert.equal(event.actorType, 'USER', action);
      assert.equal(event.metadata.impersonatedUserId, 'team-a', action);
      assert.equal(event.metadata.impersonationSessionId, sessionId, action);
    }
    const logged = lines.map((line) => JSON.parse(line)).filter((line) => line.msg === 'impersonated request');
    assert.ok(logged.length > 0, 'impersonated requests are logged');
    const last = logged.at(-1);
    assert.equal(last.actorUserId, 'admin-a');
    assert.equal(last.impersonatedUserId, 'team-a');
    assert.equal(last.impersonationSessionId, sessionId);
    assert.ok(!lines.join('\n').includes(cookies[IMPERSONATION_COOKIE]), 'the cookie value is not logged');
  });

  it('works for a client user through the client portal, and not through staff APIs', async (t) => {
    const { startOk, app } = await buildApp(t);
    const { cookies } = await startOk('admin-a', 'client-user-a');
    const portal = await app.inject({ method: 'GET', url: '/api/client-portal/me', cookies });
    assert.equal(portal.statusCode, 200, portal.body);
    assert.equal(portal.json().client.name, 'Client A');
    const staff = await app.inject({ method: 'GET', url: '/api/probe', cookies });
    assert.equal(staff.statusCode, 403);
    assert.equal(staff.json().code, 'CLIENT_SESSION_FORBIDDEN');
    const logout = await app.inject({ method: 'POST', url: '/api/client-portal/logout', cookies });
    assert.equal(logout.json().code, 'IMPERSONATION_READ_ONLY');
  });

  it('ignores a view cookie that belongs to another admin or a forged one', async (t) => {
    const { startOk, app, cookiesFor } = await buildApp(t);
    const { cookie } = await startOk();
    // Another admin in the same org presenting admin-a's cookie.
    const stolen = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: cookiesFor('admin-a2', { [IMPERSONATION_COOKIE]: cookie.value }) });
    assert.equal(stolen.json().id, 'admin-a2');
    assert.equal(stolen.json().impersonation, undefined);
    assert.ok(cleared(stolen));
    const forged = `${cookie.value.slice(0, -4)}AAAA`;
    const forgedResponse = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: cookiesFor('admin-a', { [IMPERSONATION_COOKIE]: forged }) });
    assert.equal(forgedResponse.json().id, 'admin-a');
    // Without a valid admin session the cookie is worthless.
    const anonymous = await app.inject({ method: 'GET', url: '/api/probe', cookies: { [IMPERSONATION_COOKIE]: cookie.value } });
    assert.equal(anonymous.statusCode, 401);
  });
});

describe('ending a support view', () => {
  it('stops explicitly and restores the admin session', async (t) => {
    const { startOk, app, db } = await buildApp(t);
    const { cookies } = await startOk();
    const stop = await app.inject({ method: 'POST', url: '/api/auth/impersonation/stop', cookies });
    assert.equal(stop.statusCode, 200, stop.body);
    assert.deepEqual(stop.json(), { active: false, stopped: 1 });
    assert.ok(cleared(stop));
    const [row] = db.tables.impersonationSession;
    assert.equal(row.endReason, 'stopped');
    assert.equal(row.endedById, 'admin-a');
    const [ended] = audits(db, 'impersonation.ended');
    assert.equal(ended.actorUserId, 'admin-a');
    assert.equal(ended.metadata.reason, 'stopped');
    assert.equal(ended.metadata.subjectUserId, 'team-a');
    assert.equal(typeof ended.metadata.durationSeconds, 'number');
    // The old cookie no longer works; the admin is themselves again.
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    assert.equal(me.json().id, 'admin-a');
    assert.equal(me.json().impersonation, undefined);
    const write = await app.inject({ method: 'POST', url: '/api/probe', cookies, payload: {} });
    assert.equal(write.statusCode, 200);
  });

  it('expires after the window without extension, recording the end once', async (t) => {
    const { startOk, app, db } = await buildApp(t);
    const { cookies } = await startOk();
    const [row] = db.tables.impersonationSession;
    // Move the whole view into the past.
    row.startedAt = new Date(Date.now() - 31 * 60 * 1000);
    row.expiresAt = new Date(Date.now() - 60 * 1000);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    assert.equal(me.json().id, 'admin-a');
    assert.ok(cleared(me));
    assert.equal(row.endReason, 'expired');
    assert.equal(row.endedAt.getTime(), row.expiresAt.getTime());
    const [ended] = audits(db, 'impersonation.ended');
    assert.equal(ended.actorType, 'SYSTEM');
    assert.equal(ended.metadata.reason, 'expired');
    await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    assert.equal(audits(db, 'impersonation.ended').length, 1);
  });

  it('rejects a token past its own expiry even if the row were still open', async (t) => {
    const { startOk } = await buildApp(t);
    const { cookie } = await startOk();
    const claims = verifyImpersonationToken(cookie.value, { nowMs: Date.now() + (IMPERSONATION_TTL_SECONDS + 1) * 1000 });
    assert.equal(claims.expired, true);
  });

  it('is revoked by an admin password reset, role change or deactivation of either person', async (t) => {
    const { app, db, startOk, cookiesFor, stepUp } = await buildApp(t);
    const cases = [
      ['POST', '/api/team/team-a/reset-password', { newPassword: 'Another-Pass-99' }, 'revoked_password_reset'],
      ['PUT', '/api/team/team-a', { role: 'CLIENT' }, 'revoked_role_change'],
      ['PUT', '/api/team/team-a', { isActive: false }, 'revoked_deactivated'],
    ];
    for (const [method, url, payload, reason] of cases) {
      db.tables.user.find((u) => u.id === 'team-a').role = 'TEAM';
      db.tables.user.find((u) => u.id === 'team-a').isActive = true;
      const { cookies } = await startOk('admin-a', 'team-a');
      const row = db.tables.impersonationSession.at(-1);
      const response = await app.inject({ method, url, payload, cookies: cookiesFor('admin-a2', stepUp('admin-a2')) });
      assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
      assert.equal(row.endReason, reason, url);
      const after = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
      assert.equal(after.json().id, 'admin-a', `${url}: back to the admin`);
    }
  });

  it('ends when the admin signs out', async (t) => {
    const { startOk, app, db } = await buildApp(t);
    const { cookies } = await startOk();
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies });
    assert.equal(logout.statusCode, 200);
    assert.ok(cleared(logout));
    assert.equal(db.tables.impersonationSession[0].endReason, 'signed_out');
  });

  it('ends when the admin session is revoked elsewhere (sessionVersion changes)', async (t) => {
    const { startOk, app, db } = await buildApp(t);
    const { cookie } = await startOk();
    db.tables.user.find((u) => u.id === 'admin-a').sessionVersion += 1;
    const fresh = app.jwt.sign({ id: 'admin-a', role: 'ADMIN', organizationId: 'org-a', sessionVersion: 1, iat: SESSION_IAT });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { token: fresh, [IMPERSONATION_COOKIE]: cookie.value } });
    assert.equal(me.json().id, 'admin-a');
    assert.equal(me.json().impersonation, undefined);
  });

  it('lists recent views with reasons for admins', async (t) => {
    const { startOk, app, cookiesFor } = await buildApp(t);
    await startOk();
    const list = await app.inject({ method: 'GET', url: '/api/auth/impersonation/sessions', cookies: cookiesFor('admin-a2') });
    assert.equal(list.statusCode, 200, list.body);
    const [entry] = list.json().sessions;
    assert.equal(entry.actor.name, 'Avery Admin');
    assert.equal(entry.subject.name, 'Terry Team');
    assert.equal(entry.reason, REASON);
    assert.equal(entry.active, true);
    const other = await app.inject({ method: 'GET', url: '/api/auth/impersonation/sessions', cookies: cookiesFor('admin-b') });
    assert.deepEqual(other.json().sessions, []);
  });
});

describe('impersonationDenial policy', () => {
  it('allows reads, ending the view and signing out; refuses other writes', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(impersonationDenial(method, '/api/projects?x=1'), null);
    assert.equal(impersonationDenial('POST', '/api/auth/impersonation/stop'), null);
    assert.equal(impersonationDenial('POST', '/api/auth/logout'), null);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(impersonationDenial(method, '/api/projects/p1').code, 'IMPERSONATION_READ_ONLY');
    }
    assert.equal(impersonationDenial('GET', '/api/api-keys?all=1').code, 'IMPERSONATION_BLOCKED');
    assert.equal(impersonationDenial('GET', '/api/api-keysx'), null, 'prefixes match whole segments');
  });

  it('never accepts a token signed with another key or of another type', () => {
    const token = signImpersonationToken({
      sessionId: 's1', actor: { id: 'a', organizationId: 'o', sessionVersion: 0, iat: 1 }, subjectUserId: 'b', expiresAt: new Date(Date.now() + 60_000),
    });
    assert.ok(verifyImpersonationToken(token));
    const [header, payload] = token.split('.');
    assert.equal(verifyImpersonationToken(`${header}.${payload}.bad`), null);
    const session = signUserSession({ sign: (claims) => JSON.stringify(claims) }, { id: 'a' });
    assert.equal(verifyImpersonationToken(session), null);
  });
});
