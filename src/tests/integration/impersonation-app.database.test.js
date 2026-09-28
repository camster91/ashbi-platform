// End-to-end proof through the real application factory (#416): the
// impersonation hook, decorators and tenancy middleware exactly as wired in
// src/index.js. The unit tests rebuild that wiring by hand; this test fails if
// the real wiring is removed or reordered. Needs a disposable, fully migrated
// database in both DATABASE_URL (read by src/config/db.js) and
// TENANT_INTEGRATION_DATABASE_URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const sameDatabase = databaseUrl && process.env.DATABASE_URL === databaseUrl;
const JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';
process.env.JWT_SECRET = JWT_SECRET;

test('the real application enforces a read-only support view end to end', {
  skip: !sameDatabase && 'TENANT_INTEGRATION_DATABASE_URL (equal to DATABASE_URL) is not configured',
  timeout: 120_000,
}, async () => {
  const { buildApp } = await import('../../index.js');
  // The raw client: fixtures and cleanup must bypass soft delete and tenancy.
  const { rawPrisma: prisma } = await import('../../config/db.js');
  const { reauthCookies } = await import('../helpers/reauth.js');
  const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');
  const { IMPERSONATION_COOKIE } = await import('../../auth/impersonation.js');

  const suffix = randomUUID();
  const org = `imp-app-${suffix}`;
  const app = await buildApp({ initializeRuntime: false, jwtSecret: JWT_SECRET });
  try {
    await prisma.organization.create({ data: { id: org, name: 'Impersonation App Tenant', slug: `imp-app-${suffix}` } });
    const admin = await prisma.user.create({ data: { organizationId: org, email: `imp-app-admin-${suffix}@example.com`, name: 'App Admin', password: 'x', role: 'ADMIN' } });
    const staff = await prisma.user.create({ data: { organizationId: org, email: `imp-app-staff-${suffix}@example.com`, name: 'App Staff', password: 'x', role: 'STAFF' } });
    const client = await prisma.client.create({ data: { organizationId: org, name: 'App Client' } });

    const iat = Math.floor(Date.now() / 1000) - 30;
    const session = app.jwt.sign({ id: admin.id, email: admin.email, name: admin.name, role: 'ADMIN', organizationId: org, sessionVersion: 0, iat }, { expiresIn: '1h' });
    const adminCookies = { token: session, ...reauthCookies({ id: admin.id, sessionVersion: 0, iat }) };

    const started = await app.inject({ method: 'POST', url: '/api/auth/impersonation', cookies: adminCookies, payload: { userId: staff.id, reason: 'End-to-end support view check' } });
    assert.equal(started.statusCode, 201, started.body);
    const view = { token: session, [IMPERSONATION_COOKIE]: started.cookies.find((c) => c.name === IMPERSONATION_COOKIE).value };

    // A read works, as the viewed person and inside the tenant.
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: view });
    assert.equal(me.json().id, staff.id);
    assert.equal(me.json().impersonation.actor.id, admin.id);
    const clients = await app.inject({ method: 'GET', url: '/api/clients', cookies: view });
    assert.equal(clients.statusCode, 200, clients.body);
    assert.ok(JSON.stringify(clients.json()).includes(client.id));

    // Writes are refused, including routes added after this feature.
    for (const [method, url, payload] of [
      ['POST', '/api/clients', { name: 'Should not exist' }],
      ['PUT', `/api/clients/${client.id}`, { name: 'Renamed' }],
      ['DELETE', `/api/clients/${client.id}`, undefined],
      ['POST', '/api/ai-tools/sessions', {}],
      ['POST', '/api/domain-events/replay', {}],
      ['POST', '/api/domain-events/discard', {}],
    ]) {
      const response = await app.inject({ method, url, cookies: view, payload });
      assert.equal(response.statusCode, 403, `${method} ${url}: ${response.body}`);
      assert.equal(response.json().code, 'IMPERSONATION_READ_ONLY', `${method} ${url}`);
    }
    assert.equal((await prisma.client.findUnique({ where: { id: client.id } })).name, 'App Client');

    // Blocked areas, also through an encoded path and the OAuth start GET.
    for (const url of ['/api/api-keys', '/api/api-%6beys', '/api/audit-events', '/api/google-calendar/oauth/start']) {
      const response = await app.inject({ method: 'GET', url, cookies: view });
      assert.equal(response.statusCode, 403, url);
      assert.equal(response.json().code, 'IMPERSONATION_BLOCKED', url);
    }

    // Opening the app during a view does not write to the viewed person's
    // onboarding record (the tour requests it on every page load).
    const onboarding = await app.inject({ method: 'GET', url: '/api/onboarding/progress', cookies: view });
    assert.equal(onboarding.statusCode, 200, onboarding.body);
    assert.equal(await prisma.onboardingProgress.count({ where: { userId: staff.id } }), 0);

    // Realtime is refused while the view cookie is present: the socket would
    // otherwise authenticate as the admin and join the admin's rooms.
    const socketAuth = app.io.of('/')._fns?.[0];
    assert.equal(typeof socketAuth, 'function', 'socket auth middleware is registered');
    const handshake = (jar) => new Promise((resolve) => {
      const cookie = Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
      socketAuth({ handshake: { headers: { cookie }, auth: {} } }, (err) => resolve(err));
    });
    assert.match((await handshake(view))?.message || '', /support view/);
    assert.equal(await handshake({ token: session }), undefined);

    // Stopping restores the admin.
    const stop = await app.inject({ method: 'POST', url: '/api/auth/impersonation/stop', cookies: view });
    assert.equal(stop.statusCode, 200, stop.body);
    assert.equal(stop.json().stopped, 1);
    // A request still carrying the ended view's cookie is refused, never run
    // as the admin; without it the admin is themselves again.
    const stale = await app.inject({ method: 'PUT', url: `/api/clients/${client.id}`, cookies: view, payload: { name: 'Renamed' } });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().code, 'IMPERSONATION_ENDED');
    assert.equal((await prisma.client.findUnique({ where: { id: client.id } })).name, 'App Client');
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { token: session } });
    assert.equal(after.json().id, admin.id);
    assert.equal(after.json().impersonation, undefined);
    const actions = (await prisma.auditEvent.findMany({ where: { organizationId: org }, orderBy: { createdAt: 'asc' } })).map((e) => e.action);
    assert.deepEqual(actions.filter((a) => a.startsWith('impersonation.')), ['impersonation.started', 'impersonation.ended']);

    // Starts at the same moment (several tabs) leave exactly one open view.
    const racing = await Promise.all([1, 2, 3, 4, 5, 6].map(() => app.inject({
      method: 'POST', url: '/api/auth/impersonation', cookies: adminCookies, payload: { userId: staff.id, reason: 'Concurrent start check' },
    })));
    assert.ok(racing.every((r) => r.statusCode === 201), racing.map((r) => r.body).join('\n'));
    assert.equal(await prisma.impersonationSession.count({ where: { organizationId: org, actorUserId: admin.id, endedAt: null } }), 1);
    const superseded = await prisma.impersonationSession.findMany({ where: { organizationId: org, endReason: 'superseded' } });
    assert.equal(superseded.length, racing.length - 1);
  } finally {
    await app.close();
    await prisma.notification.deleteMany({ where: { user: { organizationId: org } } });
    await prisma.onboardingProgress.deleteMany({ where: { user: { organizationId: org } } });
    await prisma.impersonationSession.deleteMany({ where: { organizationId: org } });
    await prisma.client.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
    if (await purgeFixtureAuditEvents(prisma, { ids: [org] })) {
      await prisma.organization.deleteMany({ where: { id: org } });
    }
    await prisma.$disconnect();
  }
});
