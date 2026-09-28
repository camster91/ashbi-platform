// Real-database proof for support impersonation and break-glass recovery
// (#416, docs/privileged-actions.md): the new tables stay inside their
// organization through the tenant proxy, the CHECK constraints hold, a view
// expires on schedule, and the audit trail lands in the right tenant. Runs
// only when TENANT_INTEGRATION_DATABASE_URL points at a disposable, fully
// migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { enterRequestContext } = await import('../../utils/request-context.js');
const { isTenancyExemptUrl } = await import('../../middleware/tenancy.js');
const { isCurrentUserSession } = await import('../../auth/session.js');
const { reauthCookies } = await import('../helpers/reauth.js');
const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');
const {
  IMPERSONATION_COOKIE,
  applyImpersonation,
  createImpersonationHook,
} = await import('../../auth/impersonation.js');
const { issueBreakGlassGrant, redeemBreakGlassGrant } = await import('../../auth/break-glass.js');
const { default: authRoutes } = await import('../../routes/auth.routes.js');
const { default: privilegedAccessRoutes } = await import('../../routes/privileged-access.routes.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const REASON = 'Integration check: support ticket 1';

test('impersonation sessions and break-glass grants stay in their tenant, expire, and are audited', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const orgA = `imp-org-a-${suffix}`;
  const orgB = `imp-org-b-${suffix}`;
  const orgC = `imp-org-c-${suffix}`;
  let app;

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Impersonation Tenant A', slug: `imp-a-${suffix}` },
      { id: orgB, name: 'Impersonation Tenant B', slug: `imp-b-${suffix}` },
    ] });
    const make = (org, key, role) => raw.user.create({ data: { organizationId: org, email: `imp-${key}-${suffix}@example.com`, name: `User ${key}`, password: 'x', role } });
    const adminA = await make(orgA, 'admin-a', 'ADMIN');
    const teamA = await make(orgA, 'team-a', 'TEAM');
    const adminB = await make(orgB, 'admin-b', 'ADMIN');
    const teamB = await make(orgB, 'team-b', 'TEAM');

    // --- The application path: real hook, decorators and routes. ---------
    app = Fastify();
    await app.register(fastifyCookie);
    await app.register(rateLimit, { global: false });
    await app.register(fastifyJwt, { secret: process.env.JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
    app.addHook('onRequest', createImpersonationHook({ prisma: raw, isCurrentUserSession }));
    const guard = (adminOnly) => async (request, reply) => {
      try {
        await request.jwtVerify();
        if (!(await isCurrentUserSession(raw, request.user))) throw new Error('revoked');
        applyImpersonation(request);
        if (adminOnly && request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
      } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
      return undefined;
    };
    app.decorate('authenticate', guard(false));
    app.decorate('adminOnly', guard(true));
    app.decorate('auth', {});
    app.addHook('preHandler', async (request) => {
      const impersonation = request.impersonation
        ? { organizationId: request.impersonation.organizationId, actorUserId: request.impersonation.actorUserId, subjectUserId: request.impersonation.subjectUserId, sessionId: request.impersonation.sessionId }
        : null;
      request.prisma = isTenancyExemptUrl(request.url) ? raw : createScopedPrisma(raw, request.user.organizationId);
      enterRequestContext({ prisma: request.prisma, organizationId: null, impersonation });
    });
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(privilegedAccessRoutes, { prefix: '/api/auth', prisma: raw });

    const iat = Math.floor(Date.now() / 1000) - 30;
    const token = (user) => app.jwt.sign({ typ: user.role === 'CLIENT' ? 'client_session' : 'session', id: user.id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId, sessionVersion: user.sessionVersion, iat }, { expiresIn: '1h' });
    const adminCookies = { token: token(adminA), ...reauthCookies({ id: adminA.id, sessionVersion: adminA.sessionVersion, iat }) };

    const crossTenant = await app.inject({ method: 'POST', url: '/api/auth/impersonation', cookies: adminCookies, payload: { userId: teamB.id, reason: REASON } });
    assert.equal(crossTenant.statusCode, 404, crossTenant.body);

    const started = await app.inject({ method: 'POST', url: '/api/auth/impersonation', cookies: adminCookies, payload: { userId: teamA.id, reason: REASON } });
    assert.equal(started.statusCode, 201, started.body);
    const imp = started.cookies.find((cookie) => cookie.name === IMPERSONATION_COOKIE).value;
    const viewing = { token: token(adminA), [IMPERSONATION_COOKIE]: imp };

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: viewing });
    assert.equal(me.json().id, teamA.id);
    assert.equal(me.json().impersonation.actor.id, adminA.id);
    const readOnly = await app.inject({ method: 'PUT', url: '/api/auth/me', cookies: viewing, payload: { name: 'Changed' } });
    assert.equal(readOnly.statusCode, 403);
    assert.equal(readOnly.json().code, 'IMPERSONATION_READ_ONLY');
    assert.equal((await raw.user.findUnique({ where: { id: teamA.id } })).name, 'User team-a');

    const row = await raw.impersonationSession.findFirstOrThrow({ where: { organizationId: orgA } });
    assert.equal(row.actorUserId, adminA.id);
    assert.equal(row.subjectUserId, teamA.id);
    assert.equal(row.expiresAt.getTime() - row.startedAt.getTime(), 30 * 60 * 1000);
    const note = await raw.notification.findFirstOrThrow({ where: { userId: teamA.id, type: 'security.impersonation_started' } });
    assert.match(note.message, /support ticket 1/);

    // --- Tenant isolation of the new tables. -------------------------------
    const scopedB = createScopedPrisma(raw, orgB);
    const scopedA = createScopedPrisma(raw, orgA);
    assert.deepEqual(await scopedB.impersonationSession.findMany({}), []);
    assert.equal(await scopedB.impersonationSession.findFirst({ where: { id: row.id } }), null);
    assert.equal((await scopedB.impersonationSession.updateMany({ where: { id: row.id }, data: { reason: 'tampered by tenant b' } })).count, 0);
    assert.equal((await scopedA.impersonationSession.findMany({})).length, 1);
    // A scoped create cannot place a row in another tenant.
    const planted = await scopedB.impersonationSession.create({ data: {
      organizationId: orgA, actorUserId: adminB.id, subjectUserId: teamB.id, subjectRole: 'TEAM', reason: REASON, expiresAt: new Date(Date.now() + 60_000),
    } });
    assert.equal(planted.organizationId, orgB);
    await raw.impersonationSession.delete({ where: { id: planted.id } });

    // --- CHECK constraints. -------------------------------------------------
    const base = { organizationId: orgA, actorUserId: adminA.id, subjectUserId: teamA.id, subjectRole: 'TEAM', reason: REASON };
    const now = Date.now();
    for (const [label, data] of [
      ['longer than 60 minutes', { ...base, startedAt: new Date(now), expiresAt: new Date(now + 61 * 60 * 1000) }],
      ['expiry before start', { ...base, startedAt: new Date(now), expiresAt: new Date(now - 1000) }],
      ['short reason', { ...base, reason: 'short', expiresAt: new Date(now + 60_000) }],
      ['admin subject', { ...base, subjectRole: 'ADMIN', expiresAt: new Date(now + 60_000) }],
      ['self', { ...base, subjectUserId: adminA.id, expiresAt: new Date(now + 60_000) }],
      ['end reason without end time', { ...base, endReason: 'stopped', expiresAt: new Date(now + 60_000) }],
      ['unknown end reason', { ...base, endedAt: new Date(now), endReason: 'whatever', expiresAt: new Date(now + 60_000) }],
    ]) {
      await assert.rejects(raw.impersonationSession.create({ data }), undefined, label);
    }

    // --- Expiry ends the view and records it once. -------------------------
    await raw.$executeRawUnsafe(
      `UPDATE "impersonation_sessions" SET "startedAt" = NOW() - INTERVAL '40 minutes', "expiresAt" = NOW() - INTERVAL '10 minutes' WHERE "id" = $1`,
      row.id,
    );
    const afterExpiry = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: viewing });
    assert.equal(afterExpiry.statusCode, 409, afterExpiry.body);
    assert.equal(afterExpiry.json().code, 'IMPERSONATION_ENDED');
    const ended = await raw.impersonationSession.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(ended.endReason, 'expired');
    assert.equal(ended.endedAt.getTime(), ended.expiresAt.getTime());
    await app.inject({ method: 'GET', url: '/api/auth/me', cookies: viewing });
    const events = await raw.auditEvent.findMany({ where: { organizationId: orgA, action: { in: ['impersonation.started', 'impersonation.ended'] } }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(events.map((event) => event.action), ['impersonation.started', 'impersonation.ended']);
    assert.equal(events[0].actorUserId, adminA.id);
    assert.equal(events[0].metadata.impersonatedUserId, teamA.id);
    assert.equal(events[1].metadata.reason, 'expired');
    assert.equal(await raw.auditEvent.count({ where: { organizationId: orgB, action: { startsWith: 'impersonation.' } } }), 0);

    // --- Break-glass: grant in org A by an operator of org B. --------------
    const environment = { BREAK_GLASS_ENABLED: 'true', PLATFORM_OPERATOR_USER_IDS: adminB.id };
    const { grant, token: recovery } = await issueBreakGlassGrant(raw, {
      organizationId: orgA, targetUserId: adminA.id, operatorId: adminB.id, reason: 'Integration: admin lost both factors',
      osUser: 'deploy', host: 'api-1.internal',
    }, { environment });
    assert.equal(grant.issuedByOsUser, 'deploy');
    assert.equal(grant.issuedFromHost, 'api-1.internal');
    assert.equal(await scopedB.breakGlassGrant.findFirst({ where: { id: grant.id } }), null);
    assert.equal((await scopedA.breakGlassGrant.findMany({})).length, 1);
    await assert.rejects(raw.breakGlassGrant.create({ data: {
      organizationId: orgA, targetUserId: adminA.id, operatorId: adminB.id, reason: 'x', tokenHash: `h-${suffix}`, issuedByOsUser: 'ops', issuedFromHost: 'host', expiresAt: new Date(Date.now() + 60_000),
    } }), undefined, 'short reason');
    await assert.rejects(raw.breakGlassGrant.create({ data: {
      organizationId: orgA, targetUserId: adminA.id, operatorId: adminB.id, reason: REASON, tokenHash: `h2-${suffix}`, issuedByOsUser: 'ops', issuedFromHost: 'host', expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    } }), undefined, 'longer than 60 minutes');

    const redeemed = await redeemBreakGlassGrant(raw, { token: recovery, newPassword: 'Integration-Pass-1' }, { environment });
    assert.equal(redeemed.redeemed, true);
    await assert.rejects(redeemBreakGlassGrant(raw, { token: recovery, newPassword: 'Integration-Pass-1' }, { environment }), { code: 'BREAK_GLASS_INVALID' });
    const glassEvents = await raw.auditEvent.findMany({ where: { organizationId: orgA, action: { startsWith: 'break_glass.' } }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(glassEvents.map((event) => event.action), ['break_glass.granted', 'break_glass.redeemed']);
    assert.equal(glassEvents[0].metadata.osUser, 'deploy');
    assert.equal(glassEvents[0].metadata.host, 'api-1.internal');
    assert.equal(await raw.auditEvent.count({ where: { organizationId: orgB, action: { startsWith: 'break_glass.' } } }), 0);
    const restored = await raw.user.findUniqueOrThrow({ where: { id: adminA.id } });
    assert.equal(restored.sessionVersion, adminA.sessionVersion + 1);
    // The old admin session no longer works.
    const stale = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { token: token(adminA) } });
    assert.equal(stale.statusCode, 401);

    // Concurrent issues for one person leave exactly one redeemable grant.
    await Promise.all([1, 2, 3, 4].map((n) => issueBreakGlassGrant(raw, {
      organizationId: orgA, targetUserId: adminA.id, operatorId: adminB.id, reason: `Integration: concurrent issue number ${n}`,
      osUser: 'deploy', host: 'api-1.internal',
    }, { environment })));
    assert.equal(await raw.breakGlassGrant.count({ where: { organizationId: orgA, targetUserId: adminA.id, redeemedAt: null, revokedAt: null } }), 1);

    // Two promotion grants redeemed at once in an organization with no
    // administrator promote exactly one person.
    await raw.organization.create({ data: { id: orgC, name: 'Impersonation Tenant C', slug: `imp-c-${suffix}` } });
    const teamC1 = await make(orgC, 'team-c1', 'TEAM');
    const teamC2 = await make(orgC, 'team-c2', 'TEAM');
    const promotions = [];
    for (const target of [teamC1, teamC2]) {
      promotions.push((await issueBreakGlassGrant(raw, {
        organizationId: orgC, targetUserId: target.id, operatorId: adminB.id, promoteToAdmin: true,
        reason: 'Integration: every administrator left the organization', osUser: 'deploy', host: 'api-1.internal',
      }, { environment })).token);
    }
    const results = await Promise.allSettled(promotions.map((recoveryToken) => redeemBreakGlassGrant(raw, { token: recoveryToken, newPassword: 'Integration-Pass-2' }, { environment })));
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(await raw.user.count({ where: { organizationId: orgC, role: 'ADMIN' } }), 1);

    // Restoring a deactivated administrator takes the same organization lock,
    // so it cannot interleave with a promotion's no-admin check.
    const [promotedC] = await raw.user.findMany({ where: { organizationId: orgC, role: 'ADMIN' } });
    await raw.user.update({ where: { id: promotedC.id }, data: { isActive: false } });
    const { token: restoreToken } = await issueBreakGlassGrant(raw, {
      organizationId: orgC, targetUserId: promotedC.id, operatorId: adminB.id,
      reason: 'Integration: restore the deactivated administrator', osUser: 'deploy', host: 'api-1.internal',
    }, { environment });
    let releaseLock;
    const held = new Promise((resolve) => { releaseLock = resolve; });
    let lockTaken;
    const taken = new Promise((resolve) => { lockTaken = resolve; });
    const holder = raw.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`break-glass-redeem:${orgC}`}, 0))`;
      lockTaken();
      await held;
    }, { timeout: 20_000 });
    await taken;
    let restoreSettled = false;
    const restore = redeemBreakGlassGrant(raw, { token: restoreToken, newPassword: 'Integration-Pass-3' }, { environment })
      .finally(() => { restoreSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(restoreSettled, false, 'restoration waits for the organization lock');
    releaseLock();
    await holder;
    assert.equal((await restore).redeemed, true);
  } finally {
    await app?.close();
    await raw.notification.deleteMany({ where: { user: { organizationId: { in: [orgA, orgB, orgC] } } } });
    await raw.impersonationSession.deleteMany({ where: { organizationId: { in: [orgA, orgB, orgC] } } });
    await raw.breakGlassGrant.deleteMany({ where: { organizationId: { in: [orgA, orgB, orgC] } } });
    await raw.user.deleteMany({ where: { organizationId: { in: [orgA, orgB, orgC] } } });
    if (await purgeFixtureAuditEvents(raw, { ids: [orgA, orgB, orgC] })) {
      await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB, orgC] } } });
    }
    await raw.$disconnect();
  }
});
