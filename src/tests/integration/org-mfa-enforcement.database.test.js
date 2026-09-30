// Organization MFA requirement (#416 follow-up) through the real application
// factory and a real, fully migrated database: the global enforcement hook,
// the settings route with step-up, the real sign-in and enrollment routes,
// Socket.IO handshake refusal, break-glass and tenant isolation. Needs a
// disposable database in both DATABASE_URL (read by src/config/db.js) and
// TENANT_INTEGRATION_DATABASE_URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import bcrypt from 'bcrypt';
import { io as connectClient } from 'socket.io-client';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const sameDatabase = databaseUrl && process.env.DATABASE_URL === databaseUrl;
const JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';
process.env.JWT_SECRET = JWT_SECRET;
process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'integration-test-credentials-key';

const PASSWORD = 'Org-Mfa-Integration-1';
const CODE = 'MFA_ENROLLMENT_REQUIRED';

/** Resolve with true when `emitter` emits `event` within `ms`, else false. */
function emitsWithin(emitter, event, ms = 3_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { emitter.off(event, onEvent); resolve(false); }, ms);
    function onEvent() { clearTimeout(timer); resolve(true); }
    emitter.once(event, onEvent);
  });
}

test('an organization can require two-factor authentication for all staff', {
  skip: !sameDatabase && 'TENANT_INTEGRATION_DATABASE_URL (equal to DATABASE_URL) is not configured',
  timeout: 120_000,
}, async () => {
  const { buildApp } = await import('../../index.js');
  const { rawPrisma: prisma } = await import('../../config/db.js');
  const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');
  const { totp } = await import('../../auth/totp.js');
  const { encryptMfaSecret } = await import('../../auth/mfa.js');
  const { generateTotpSecret } = await import('../../auth/totp.js');
  const { signUserSession } = await import('../../auth/session.js');
  const { issueBreakGlassGrant, redeemBreakGlassGrant } = await import('../../auth/break-glass.js');

  const suffix = randomUUID();
  const orgA = `org-mfa-a-${suffix}`;
  const orgB = `org-mfa-b-${suffix}`;
  const app = await buildApp({ initializeRuntime: false, jwtSecret: JWT_SECRET });
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const enrolledSecret = generateTotpSecret();
  const recoveredSecret = generateTotpSecret();
  // Real Socket.IO clients against the real server (F3: sockets opened
  // before the requirement applied must not keep working).
  await app.listen({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  const sockets = [];
  const connectSocket = async (jar) => {
    const cookie = Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
    const client = connectClient(baseUrl, { transports: ['websocket'], extraHeaders: { cookie }, reconnection: false });
    sockets.push(client);
    const [outcome] = await Promise.race([once(client, 'connect').then(() => ['connect']), once(client, 'connect_error')]);
    assert.equal(outcome, 'connect', `socket connects: ${outcome?.message ?? ''}`);
    return client;
  };
  const joinProject = (client, projectId) => new Promise((resolve) => client.emit('join-project', projectId, resolve));

  const inject = (method, url, cookies, payload) => app.inject({ method, url, cookies, payload });
  const cookieFrom = (response, name) => response.cookies.find((cookie) => cookie.name === name)?.value;
  const sessionOf = (user) => ({ token: signUserSession(app.jwt, user) });
  const auditCount = (organizationId) => prisma.auditEvent.count({
    where: { organizationId, action: 'organization.mfa_requirement_changed' },
  });

  try {
    await prisma.organization.create({ data: { id: orgA, name: 'MFA Tenant A', slug: orgA } });
    await prisma.organization.create({ data: { id: orgB, name: 'MFA Tenant B', slug: orgB } });
    const mk = (organizationId, key, role, extra = {}) => prisma.user.create({
      data: { organizationId, email: `${key}-${suffix}@example.com`, name: key, password: passwordHash, role, ...extra },
    });
    const admin = await mk(orgA, 'admin', 'ADMIN');
    const unenrolledAdmin = await mk(orgA, 'admin-2', 'ADMIN');
    const staff = await mk(orgA, 'staff', 'STAFF');
    const team = await mk(orgA, 'team', 'TEAM');
    const enrolled = await mk(orgA, 'enrolled', 'TEAM', {
      mfaEnabled: true, mfaSecret: encryptMfaSecret(enrolledSecret), mfaEnabledAt: new Date(),
    });
    const recovered = await mk(orgA, 'recovered', 'ADMIN', {
      mfaEnabled: true, mfaSecret: encryptMfaSecret(recoveredSecret), mfaEnabledAt: new Date(),
    });
    const staffB = await mk(orgB, 'staff-b', 'STAFF');
    await prisma.client.create({ data: { organizationId: orgA, name: 'Tenant A Client' } });

    // --- Turning it on needs step-up and the admin's own two-factor. --------
    let adminCookies = sessionOf(admin);
    const noStepUp = await inject('PUT', '/api/settings/mfa-requirement', adminCookies, { required: true });
    assert.equal(noStepUp.statusCode, 403, noStepUp.body);
    assert.equal(noStepUp.json().code, 'REAUTH_REQUIRED');

    const passwordReauth = await inject('POST', '/api/auth/reauth', adminCookies, { password: PASSWORD });
    assert.equal(passwordReauth.statusCode, 200, passwordReauth.body);
    adminCookies = { ...adminCookies, reauth: cookieFrom(passwordReauth, 'reauth') };
    const selfNotEnrolled = await inject('PUT', '/api/settings/mfa-requirement', adminCookies, { required: true });
    assert.equal(selfNotEnrolled.statusCode, 409, selfNotEnrolled.body);
    assert.equal(selfNotEnrolled.json().code, 'MFA_SELF_ENROLLMENT_REQUIRED');
    assert.equal((await prisma.organization.findUnique({ where: { id: orgA } })).mfaRequired, false);
    assert.equal(await auditCount(orgA), 0);

    // The admin enrolls through the real routes, then steps up with a code.
    const adminEnroll = await inject('POST', '/api/auth/mfa/enroll', adminCookies, { password: PASSWORD });
    assert.equal(adminEnroll.statusCode, 200, adminEnroll.body);
    const adminSecret = adminEnroll.json().secret;
    const adminConfirm = await inject('POST', '/api/auth/mfa/confirm', adminCookies, { code: totp(adminSecret) });
    assert.equal(adminConfirm.statusCode, 200, adminConfirm.body);
    adminCookies = { token: cookieFrom(adminConfirm, 'token') };
    // The next time step: the confirmation already used this one.
    const codeReauth = await inject('POST', '/api/auth/reauth', adminCookies, { code: totp(adminSecret, { timeMs: Date.now() + 30_000 }) });
    assert.equal(codeReauth.statusCode, 200, codeReauth.body);
    assert.equal(codeReauth.json().method, 'totp');
    adminCookies = { ...adminCookies, reauth: cookieFrom(codeReauth, 'reauth') };

    const before = await inject('GET', '/api/settings/mfa-requirement', adminCookies);
    assert.equal(before.statusCode, 200, before.body);
    assert.deepEqual(before.json(), { required: false, staffWithoutMfa: 3, actorMfaEnabled: true });

    // Realtime opened before the requirement: an unenrolled member's socket,
    // an enrolled member's and the enabling admin's.
    const staffSocketBefore = await connectSocket(sessionOf(staff));
    const enrolledSocket = await connectSocket(sessionOf(enrolled));
    const adminSocket = await connectSocket({ token: adminCookies.token });
    const staffDropped = emitsWithin(staffSocketBefore, 'disconnect');
    const enrolledDroppedEarly = emitsWithin(enrolledSocket, 'disconnect', 1_000);
    const adminDropped = emitsWithin(adminSocket, 'disconnect', 1_000);

    const enabled = await inject('PUT', '/api/settings/mfa-requirement', adminCookies, { required: true });
    assert.equal(enabled.statusCode, 200, enabled.body);
    // Turning it on ends the unenrolled member's open realtime connection,
    // and only theirs.
    assert.equal(await staffDropped, true, 'the unenrolled member\'s socket is disconnected');
    assert.equal(await enrolledDroppedEarly, false, 'an enrolled member keeps realtime');
    assert.equal(await adminDropped, false, 'the enabling admin keeps realtime');
    assert.equal(enrolledSocket.connected, true);
    assert.equal(enabled.json().required, true);
    assert.equal(enabled.json().changed, true);
    assert.equal((await prisma.organization.findUnique({ where: { id: orgA } })).mfaRequired, true);
    const [onEvent] = await prisma.auditEvent.findMany({ where: { organizationId: orgA, action: 'organization.mfa_requirement_changed' } });
    assert.equal(onEvent.actorUserId, admin.id);
    assert.equal(onEvent.entityType, 'organization');
    assert.equal(onEvent.entityId, orgA);
    assert.deepEqual(onEvent.metadata, { fromRequired: false, toRequired: true, staffWithoutMfa: 3 });
    // Repeating the request changes nothing and writes nothing.
    assert.equal((await inject('PUT', '/api/settings/mfa-requirement', adminCookies, { required: true })).json().changed, false);
    assert.equal(await auditCount(orgA), 1);
    // The enabling admin is not locked out.
    assert.equal((await inject('GET', '/api/clients', adminCookies)).statusCode, 200);

    // --- Unenrolled staff: enrollment only, on existing sessions too. -------
    const staffCookies = sessionOf(staff);
    for (const [method, url, payload] of [
      ['GET', '/api/clients'],
      ['POST', '/api/clients', { name: 'Should not exist' }],
      ['GET', '/api/projects'],
      ['PUT', '/api/auth/me', { name: 'Renamed' }],
      ['POST', '/api/auth/reauth', { password: PASSWORD }],
      ['POST', '/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Another-Pass-2' }],
    ]) {
      const response = await inject(method, url, staffCookies, payload);
      assert.equal(response.statusCode, 403, `${method} ${url}: ${response.body}`);
      assert.equal(response.json().code, CODE, `${method} ${url}`);
    }
    assert.equal(await prisma.client.count({ where: { organizationId: orgA } }), 1);
    const staffMe = await inject('GET', '/api/auth/me', staffCookies);
    assert.equal(staffMe.statusCode, 200, staffMe.body);
    assert.equal(staffMe.json().mfaEnrollmentRequired, true);
    const staffStatus = await inject('GET', '/api/auth/mfa', staffCookies);
    assert.equal(staffStatus.statusCode, 200, staffStatus.body);
    assert.equal(staffStatus.json().requiredByOrganization, true);

    // An unenrolled admin cannot use admin powers either, including a view.
    const otherAdmin = sessionOf(unenrolledAdmin);
    for (const [method, url, payload] of [
      ['PUT', '/api/settings/mfa-requirement', { required: false }],
      ['POST', '/api/auth/impersonation', { userId: staff.id, reason: 'Trying to escape the requirement' }],
      ['POST', '/api/auth/register', { email: `x-${suffix}@example.com`, password: PASSWORD, name: 'X', role: 'TEAM' }],
      ['GET', '/api/team'],
    ]) {
      const response = await inject(method, url, otherAdmin, payload);
      assert.equal(response.statusCode, 403, `${method} ${url}: ${response.body}`);
      assert.equal(response.json().code, CODE, `${method} ${url}`);
    }

    // F1: the scheme of the Authorization header is case-insensitive in
    // @fastify/jwt, so the requirement must see the admin behind any case.
    // No cookie: the header alone identifies the caller.
    for (const scheme of ['bearer', 'BEARER', 'BeArEr']) {
      const email = `bearer-${scheme}-${suffix}@example.com`.toLowerCase();
      const register = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { authorization: `${scheme} ${otherAdmin.token}` },
        payload: { email, password: PASSWORD, name: 'Bearer Case', role: 'TEAM' },
      });
      assert.equal(register.statusCode, 403, `register with ${scheme}: ${register.body}`);
      assert.equal(register.json().code, CODE, `register with ${scheme}`);
      assert.equal(await prisma.user.count({ where: { email } }), 0, `no user created with ${scheme}`);
      const normal = await app.inject({ method: 'GET', url: '/api/team', headers: { authorization: `${scheme} ${otherAdmin.token}` } });
      assert.equal(normal.statusCode, 403, `GET /api/team with ${scheme}: ${normal.body}`);
      assert.equal(normal.json().code, CODE, `GET /api/team with ${scheme}`);
    }

    // F2: public links opened in a browser holding a restricted staff
    // session are never refused for the staff member's missing enrollment
    // (unknown tokens answer 404 from the handlers themselves).
    const unknownToken = `no-such-token-${suffix}`;
    for (const [method, url, payload] of [
      ['GET', `/api/estimates/view/${unknownToken}`],
      ['POST', `/api/estimates/view/${unknownToken}/approve`, {}],
      ['GET', `/api/contracts/sign/${unknownToken}`],
      ['GET', `/api/invoices/client/${unknownToken}`],
      ['GET', `/api/proposals/client/${unknownToken}`],
      ['GET', `/api/portal/${unknownToken}`],
      ['GET', `/api/portal/review/${unknownToken}`],
      ['POST', '/api/client-portal/request-access', { email: `nobody-${suffix}@example.com` }],
      ['GET', '/api/webhooks/email/status'],
      ['GET', '/api/live'],
    ]) {
      for (const cookies of [staffCookies, otherAdmin]) {
        const response = await inject(method, url, cookies, payload);
        assert.notEqual(response.json()?.code, CODE, `${method} ${url}: ${response.body}`);
        assert.notEqual(response.statusCode, 403, `${method} ${url}: ${response.body}`);
        assert.notEqual(response.statusCode, 500, `${method} ${url}: ${response.body}`);
      }
    }
    // An OAuth callback completes a staff connection: still restricted.
    const oauth = await inject('GET', '/api/slack/oauth/callback?code=c&state=s', staffCookies);
    assert.equal(oauth.statusCode, 403, oauth.body);
    assert.equal(oauth.json().code, CODE);

    // Signing in still works and says so; the new session is restricted too.
    const login = await inject('POST', '/api/auth/login', {}, { email: team.email, password: PASSWORD });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(login.json().user.mfaEnrollmentRequired, true);
    const teamCookies = { token: cookieFrom(login, 'token') };
    assert.equal((await inject('GET', '/api/clients', teamCookies)).json().code, CODE);

    // Realtime is refused until enrollment.
    const socketAuth = app.io.of('/')._fns?.[0];
    assert.equal(typeof socketAuth, 'function', 'socket auth middleware is registered');
    const handshake = (jar) => new Promise((resolve) => {
      const cookie = Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
      socketAuth({ handshake: { headers: { cookie }, auth: {} } }, (err) => resolve(err));
    });
    assert.match((await handshake(staffCookies))?.message || '', /Two-factor/);
    assert.equal(await handshake({ token: adminCookies.token }), undefined);

    // --- Enrolled staff are unaffected and still complete MFA at sign-in. ---
    assert.equal((await inject('GET', '/api/clients', sessionOf(enrolled))).statusCode, 200);
    const enrolledLogin = await inject('POST', '/api/auth/login', {}, { email: enrolled.email, password: PASSWORD });
    assert.equal(enrolledLogin.statusCode, 200, enrolledLogin.body);
    assert.equal(enrolledLogin.json().mfaRequired, true);
    assert.equal(cookieFrom(enrolledLogin, 'token'), undefined, 'no session before the second factor');

    // --- Enrolling lifts the restriction without signing in again. ----------
    const enroll = await inject('POST', '/api/auth/mfa/enroll', staffCookies, { password: PASSWORD });
    assert.equal(enroll.statusCode, 200, enroll.body);
    const confirm = await inject('POST', '/api/auth/mfa/confirm', staffCookies, { code: totp(enroll.json().secret) });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const staffAfter = { token: cookieFrom(confirm, 'token') };
    assert.equal((await inject('GET', '/api/clients', staffAfter)).statusCode, 200);
    assert.equal((await inject('GET', '/api/auth/me', staffAfter)).json().mfaEnrollmentRequired, false);
    assert.equal(await handshake(staffAfter), undefined);

    // F3: turning one's own two-factor off under the requirement ends one's
    // open realtime at once, and reconnecting is refused.
    const staffSocketAfter = await connectSocket(staffAfter);
    const selfDisableDrop = emitsWithin(staffSocketAfter, 'disconnect');
    const selfDisable = await inject('POST', '/api/auth/mfa/disable', staffAfter, {
      password: PASSWORD, code: totp(enroll.json().secret, { timeMs: Date.now() + 30_000 }),
    });
    assert.equal(selfDisable.statusCode, 200, selfDisable.body);
    assert.equal(selfDisable.json().mfaEnrollmentRequired, true);
    assert.equal(await selfDisableDrop, true, 'the socket is disconnected after turning two-factor off');
    assert.match((await handshake({ token: cookieFrom(selfDisable, 'token') }))?.message || '', /Two-factor/);

    // F3: an admin resetting a member's two-factor ends that member's open
    // realtime too (the enrolled member's socket, connected before the
    // requirement was turned on).
    const resetDrop = emitsWithin(enrolledSocket, 'disconnect');
    const reset = await inject('POST', `/api/auth/mfa/admin/users/${enrolled.id}/reset`, sessionOf(recovered), {
      password: PASSWORD, code: totp(recoveredSecret),
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(await resetDrop, true, 'the reset member\'s socket is disconnected');

    // --- Break-glass cannot become a bypass. ---------------------------------
    // Redemption turns the recovered admin's two-factor off; in an
    // organization that requires it, their new session is enrollment-only.
    const environment = { BREAK_GLASS_ENABLED: 'true', PLATFORM_OPERATOR_USER_IDS: admin.id };
    const { token: recovery } = await issueBreakGlassGrant(prisma, {
      organizationId: orgA, targetUserId: recovered.id, operatorId: admin.id, reason: 'Integration: admin lost both factors',
      osUser: 'deploy', host: 'api-1.internal',
    }, { environment });
    await redeemBreakGlassGrant(prisma, { token: recovery, newPassword: 'Recovered-Pass-1' }, { environment });
    const recoveredLogin = await inject('POST', '/api/auth/login', {}, { email: recovered.email, password: 'Recovered-Pass-1' });
    assert.equal(recoveredLogin.statusCode, 200, recoveredLogin.body);
    assert.equal(recoveredLogin.json().user.mfaEnrollmentRequired, true);
    const recoveredCookies = { token: cookieFrom(recoveredLogin, 'token') };
    const recoveredAdminCall = await inject('GET', '/api/settings/mfa-requirement', recoveredCookies);
    assert.equal(recoveredAdminCall.statusCode, 403, recoveredAdminCall.body);
    assert.equal(recoveredAdminCall.json().code, CODE);
    assert.equal((await inject('GET', '/api/auth/mfa', recoveredCookies)).statusCode, 200, 'can still enroll');

    // --- Tenant isolation: org A's requirement does not reach org B. --------
    const staffBCookies = sessionOf(staffB);
    assert.equal((await inject('GET', '/api/clients', staffBCookies)).statusCode, 200);
    assert.equal((await inject('GET', '/api/auth/me', staffBCookies)).json().mfaEnrollmentRequired, false);
    assert.equal((await prisma.organization.findUnique({ where: { id: orgB } })).mfaRequired, false);
    assert.equal(await auditCount(orgB), 0);

    // --- Turning it off restores access at once. -----------------------------
    const disabled = await inject('PUT', '/api/settings/mfa-requirement', adminCookies, { required: false });
    assert.equal(disabled.statusCode, 200, disabled.body);
    assert.equal(disabled.json().required, false);
    for (const cookies of [teamCookies, otherAdmin, recoveredCookies]) {
      assert.equal((await inject('GET', '/api/clients', cookies)).statusCode, 200);
    }
    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgA, action: 'organization.mfa_requirement_changed' }, orderBy: { createdAt: 'asc' },
    });
    assert.equal(events.length, 2);
    assert.equal(events[1].metadata.fromRequired, true);
    assert.equal(events[1].metadata.toRequired, false);

    // F3: join-project re-checks the requirement, so a socket that missed
    // the disconnect (the requirement switched on by any other path, a lost
    // revocation) is refused and dropped on its next join.
    const teamSocket = await connectSocket(teamCookies);
    const firstJoin = await joinProject(teamSocket, `no-such-project-${suffix}`);
    assert.deepEqual(firstJoin, { joined: false }, 'an ordinary refusal while not required');
    await prisma.organization.update({ where: { id: orgA }, data: { mfaRequired: true } });
    const joinDrop = emitsWithin(teamSocket, 'disconnect');
    const refusedJoin = await joinProject(teamSocket, `no-such-project-${suffix}`);
    assert.deepEqual(refusedJoin, { joined: false, code: CODE });
    assert.equal(await joinDrop, true, 'the socket is disconnected on join-project');
    await prisma.organization.update({ where: { id: orgA }, data: { mfaRequired: false } });
  } finally {
    for (const client of sockets) client.disconnect();
    await app.close();
    await prisma.notification.deleteMany({ where: { user: { organizationId: { in: [orgA, orgB] } } } });
    await prisma.impersonationSession.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.breakGlassGrant.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    if (await purgeFixtureAuditEvents(prisma, { ids: [orgA, orgB] })) {
      await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await prisma.$disconnect();
  }
});
