// Break-glass recovery of administrator access (#416,
// docs/privileged-actions.md#break-glass-administrator-recovery).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { createFakeIdentityDb, seedIdentityOrganizations } = await import('../helpers/fake-identity-db.js');
const {
  BREAK_GLASS_TTL_SECONDS,
  hashBreakGlassToken,
  issueBreakGlassGrant,
  redeemBreakGlassGrant,
  listBreakGlassGrants,
  provenanceValue,
  revokeBreakGlassGrant,
} = await import('../../auth/break-glass.js');
const { default: privilegedAccessRoutes } = await import('../../routes/privileged-access.routes.js');

const REASON = 'All admins lost their devices; verified by phone with the owner';
// The platform operator is an ADMIN of the platform's own organization (org-b here).
const ENABLED = { BREAK_GLASS_ENABLED: 'true', PLATFORM_OPERATOR_USER_IDS: 'admin-b' };

function setup() {
  const db = seedIdentityOrganizations(createFakeIdentityDb());
  const admin = db.tables.user.find((u) => u.id === 'admin-a');
  Object.assign(admin, { mfaEnabled: true, mfaSecret: 'enc:secret', mfaRecoveryCodes: ['hash1'], mfaLockedUntil: new Date(Date.now() + 60_000), isActive: false });
  db.tables.apiKey.push({ id: 'key-1', userId: 'admin-a', isActive: true, revokedAt: null });
  return db;
}

const issue = (db, overrides = {}, environment = ENABLED) => issueBreakGlassGrant(db, {
  organizationId: 'org-a', targetEmail: 'ADMIN-A@org-a.test', operatorId: 'admin-b', reason: REASON,
  osUser: 'deploy', host: 'api-1.internal', ...overrides,
}, { environment });

const audits = (db, action) => db.tables.auditEvent.filter((event) => event.action === action);

describe('issuing a break-glass grant', () => {
  it('is disabled unless BREAK_GLASS_ENABLED=true', async () => {
    const db = setup();
    await assert.rejects(issue(db, {}, { PLATFORM_OPERATOR_USER_IDS: 'admin-b' }), { code: 'BREAK_GLASS_DISABLED' });
    await assert.rejects(issue(db, {}, { BREAK_GLASS_ENABLED: '1', PLATFORM_OPERATOR_USER_IDS: 'admin-b' }), { code: 'BREAK_GLASS_DISABLED' });
    assert.equal(db.tables.breakGlassGrant.length, 0);
  });

  it('only a listed platform operator who is still an active admin can issue', async () => {
    const db = setup();
    await assert.rejects(issue(db, { operatorId: 'admin-a2' }), { code: 'BREAK_GLASS_NOT_OPERATOR' });
    await assert.rejects(issue(db, { operatorId: 'team-b' }, { ...ENABLED, PLATFORM_OPERATOR_USER_IDS: 'team-b' }), { code: 'BREAK_GLASS_NOT_OPERATOR' });
    db.tables.user.find((u) => u.id === 'admin-b').isActive = false;
    await assert.rejects(issue(db), { code: 'BREAK_GLASS_NOT_OPERATOR' });
  });

  it('requires a reason and a staff target in that organization', async () => {
    const db = setup();
    await assert.rejects(issue(db, { reason: 'because' }), { code: 'BREAK_GLASS_REASON_REQUIRED' });
    await assert.rejects(issue(db, { targetEmail: 'team-b@org-b.test' }), { code: 'BREAK_GLASS_TARGET_NOT_FOUND' });
    await assert.rejects(issue(db, { targetEmail: 'client-user-a@org-a.test' }), { code: 'BREAK_GLASS_TARGET_FORBIDDEN' });
    await assert.rejects(issue(db, { targetEmail: 'team-a@org-a.test' }), { code: 'BREAK_GLASS_TARGET_NOT_ADMIN' });
    // Promoting a team member is only for an organization with no active admin.
    await assert.rejects(issue(db, { targetEmail: 'team-a@org-a.test', promoteToAdmin: true }), { code: 'BREAK_GLASS_ADMIN_EXISTS' });
    await assert.rejects(issue(db, { organizationId: 'org-missing' }), { code: 'BREAK_GLASS_ORG_NOT_FOUND' });
  });

  it('stores only the token hash, expires in 30 minutes, audits in the target org and notifies its admins', async () => {
    const db = setup();
    const before = Date.now();
    const { grant, token } = await issue(db);
    assert.equal(db.tables.breakGlassGrant.length, 1);
    const [row] = db.tables.breakGlassGrant;
    assert.equal(row.tokenHash, hashBreakGlassToken(token));
    assert.ok(!JSON.stringify(db.tables).includes(token), 'the raw token is never stored');
    assert.equal(row.organizationId, 'org-a');
    assert.equal(row.targetUserId, 'admin-a');
    assert.equal(row.reason, REASON);
    assert.equal(BREAK_GLASS_TTL_SECONDS, 1800);
    assert.ok(Math.abs(row.expiresAt.getTime() - before - 1800_000) < 5_000);

    const [event] = audits(db, 'break_glass.granted');
    assert.equal(event.organizationId, 'org-a');
    assert.equal(event.actorUserId, 'admin-b');
    assert.equal(event.entityId, grant.id);
    assert.deepEqual(Object.keys(event.metadata).sort(), ['expiresAt', 'host', 'operatorId', 'osUser', 'promoteToAdmin', 'targetUserId']);
    // The operator id is only claimed; where the CLI ran is recorded too.
    assert.equal(event.metadata.osUser, 'deploy');
    assert.equal(event.metadata.host, 'api-1.internal');
    assert.equal(row.issuedByOsUser, 'deploy');
    assert.equal(row.issuedFromHost, 'api-1.internal');
    assert.equal(provenanceValue('Jane Doe (root)'), 'Jane_Doe__root_');
    assert.equal(provenanceValue(''), 'unknown');

    const notified = db.tables.notification.filter((n) => n.type === 'security.break_glass_granted').map((n) => n.userId).sort();
    assert.deepEqual(notified, ['admin-a', 'admin-a2'], 'the org\'s active admins and the target');
    assert.ok(db.tables.notification.every((n) => !n.message.includes(token)));
  });

  it('listing grants also requires the operator check and never returns token hashes', async () => {
    const db = setup();
    await issue(db);
    await assert.rejects(listBreakGlassGrants(db, { organizationId: 'org-a', operatorId: 'admin-a2' }, { environment: ENABLED }), { code: 'BREAK_GLASS_NOT_OPERATOR' });
    const grants = await listBreakGlassGrants(db, { organizationId: 'org-a', operatorId: 'admin-b' }, { environment: ENABLED });
    assert.equal(grants.length, 1);
    assert.equal(grants[0].tokenHash, undefined);
    assert.equal(grants[0].issuedFromHost, 'api-1.internal');
  });

  it('a new grant for the same person revokes the outstanding one', async () => {
    const db = setup();
    await issue(db);
    await issue(db);
    const [first, second] = db.tables.breakGlassGrant;
    assert.ok(first.revokedAt);
    assert.equal(second.revokedAt, undefined);
    assert.equal(audits(db, 'break_glass.revoked').length, 1);
  });
});

describe('redeeming a break-glass grant', () => {
  it('restores the administrator: new password, two-factor off, reactivated, sessions and API keys revoked, audited', async () => {
    const db = setup();
    const { token, grant } = await issue(db);
    const result = await redeemBreakGlassGrant(db, { token, newPassword: 'Fresh-Start-2026' }, { environment: ENABLED });
    assert.deepEqual(result, { redeemed: true, promoted: false, reactivated: true, mfaReset: true });

    const admin = db.tables.user.find((u) => u.id === 'admin-a');
    assert.ok(await bcrypt.compare('Fresh-Start-2026', admin.password));
    assert.equal(admin.isActive, true);
    assert.equal(admin.mfaEnabled, false);
    assert.equal(admin.mfaSecret, null);
    assert.deepEqual(admin.mfaRecoveryCodes, []);
    assert.equal(admin.mfaLockedUntil, null);
    assert.equal(admin.sessionVersion, 1);
    assert.equal(admin.role, 'ADMIN');
    assert.equal(db.tables.apiKey[0].isActive, false);
    assert.ok(db.tables.breakGlassGrant[0].redeemedAt);

    const [redeemed] = audits(db, 'break_glass.redeemed');
    assert.equal(redeemed.organizationId, 'org-a');
    assert.equal(redeemed.entityId, grant.id);
    assert.equal(redeemed.metadata.operatorId, 'admin-b');
    assert.equal(redeemed.metadata.apiKeysRevoked, 1);
    assert.equal(audits(db, 'auth.password_changed')[0].metadata.method, 'break_glass');
    assert.equal(audits(db, 'auth.mfa_reset').length, 1);
    assert.equal(audits(db, 'user.reactivated').length, 1);
    assert.ok(db.tables.notification.some((n) => n.type === 'security.break_glass_redeemed' && n.userId === 'admin-a2'));
  });

  it('is single use, expires, and dies when revoked', async () => {
    const db = setup();
    const { token } = await issue(db);
    await redeemBreakGlassGrant(db, { token, newPassword: 'Fresh-Start-2026' }, { environment: ENABLED });
    await assert.rejects(redeemBreakGlassGrant(db, { token, newPassword: 'Again-Start-2026' }, { environment: ENABLED }), { code: 'BREAK_GLASS_INVALID' });

    const expired = await issue(db);
    await assert.rejects(
      redeemBreakGlassGrant(db, { token: expired.token, newPassword: 'Fresh-Start-2026' }, { environment: ENABLED, nowMs: Date.now() + 31 * 60 * 1000 }),
      { code: 'BREAK_GLASS_INVALID' },
    );

    const revoked = await issue(db);
    assert.deepEqual(await revokeBreakGlassGrant(db, { grantId: revoked.grant.id, operatorId: 'admin-b' }, { environment: ENABLED }), { revoked: true, grantId: revoked.grant.id });
    await assert.rejects(redeemBreakGlassGrant(db, { token: revoked.token, newPassword: 'Fresh-Start-2026' }, { environment: ENABLED }), { code: 'BREAK_GLASS_INVALID' });
    await assert.rejects(revokeBreakGlassGrant(db, { grantId: revoked.grant.id, operatorId: 'admin-b' }, { environment: ENABLED }), { code: 'BREAK_GLASS_GRANT_CLOSED' });
    await assert.rejects(redeemBreakGlassGrant(db, { token: 'x'.repeat(43), newPassword: 'Fresh-Start-2026' }, { environment: ENABLED }), { code: 'BREAK_GLASS_INVALID' });
  });

  it('promotes a team member only when the grant says so and no admin is left', async () => {
    const db = setup();
    db.tables.user.filter((u) => u.organizationId === 'org-a' && u.role === 'ADMIN').forEach((u) => { u.isActive = false; });
    const { token } = await issue(db, { targetEmail: 'team-a@org-a.test', promoteToAdmin: true });
    const result = await redeemBreakGlassGrant(db, { token, newPassword: 'Fresh-Start-2026' }, { environment: ENABLED });
    assert.equal(result.promoted, true);
    assert.equal(db.tables.user.find((u) => u.id === 'team-a').role, 'ADMIN');
    assert.deepEqual(audits(db, 'user.role_changed')[0].metadata, { fromRole: 'TEAM', toRole: 'ADMIN' });
  });

  it('re-checks at redemption that a promotion is still needed', async () => {
    const db = setup();
    const admins = db.tables.user.filter((u) => u.organizationId === 'org-a' && u.role === 'ADMIN');
    admins.forEach((u) => { u.isActive = false; });
    const { token } = await issue(db, { targetEmail: 'staff-a@org-a.test', promoteToAdmin: true });
    // An administrator was restored in the meantime.
    admins[1].isActive = true;
    await assert.rejects(redeemBreakGlassGrant(db, { token, newPassword: 'Fresh-Start-2026' }, { environment: ENABLED }), { code: 'BREAK_GLASS_INVALID' });
    assert.equal(db.tables.user.find((u) => u.id === 'staff-a').role, 'STAFF');
  });

  it('the redeem route answers 404 when disabled and a generic 400 for a bad token', async (t) => {
    const db = setup();
    const app = Fastify();
    await app.register(fastifyCookie);
    await app.register(rateLimit, { global: false });
    await app.register(fastifyJwt, { secret: process.env.JWT_SECRET, cookie: { cookieName: 'token', signed: false } });
    app.decorate('authenticate', async () => {});
    app.decorate('adminOnly', async () => {});
    await app.register(privilegedAccessRoutes, { prefix: '/api/auth', prisma: db });
    t.after(() => app.close());
    const saved = { enabled: process.env.BREAK_GLASS_ENABLED, operators: process.env.PLATFORM_OPERATOR_USER_IDS };
    t.after(() => {
      if (saved.enabled === undefined) delete process.env.BREAK_GLASS_ENABLED; else process.env.BREAK_GLASS_ENABLED = saved.enabled;
      if (saved.operators === undefined) delete process.env.PLATFORM_OPERATOR_USER_IDS; else process.env.PLATFORM_OPERATOR_USER_IDS = saved.operators;
    });

    delete process.env.BREAK_GLASS_ENABLED;
    const disabled = await app.inject({ method: 'POST', url: '/api/auth/break-glass/redeem', payload: { token: 'x'.repeat(43), newPassword: 'Fresh-Start-2026' } });
    assert.equal(disabled.statusCode, 404);
    // Before validation: an invalid body gets the same 404.
    for (const payload of [{}, { token: 'short' }, 'not json']) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/break-glass/redeem', payload });
      assert.equal(response.statusCode, 404, JSON.stringify(payload));
    }

    Object.assign(process.env, ENABLED);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/break-glass/redeem', payload: { token: 'x'.repeat(43), newPassword: 'Fresh-Start-2026' } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().code, 'BREAK_GLASS_INVALID');
    const weak = await app.inject({ method: 'POST', url: '/api/auth/break-glass/redeem', payload: { token: 'x'.repeat(43), newPassword: 'short' } });
    assert.equal(weak.statusCode, 400);

    const { token } = await issue(db);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/break-glass/redeem', payload: { token, newPassword: 'Fresh-Start-2026' } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.deepEqual(ok.json(), { success: true, mfaReset: true });
    assert.equal(ok.headers['cache-control'], 'no-store');
  });
});
