// Real-database proof for media review (#417 slice 1, docs/media-review.md):
// share links reach only their own session, the tenant proxy keeps review
// data inside its organization, decisions are append-only, and the CHECK
// constraints the Prisma schema cannot express hold. Runs only when
// TENANT_INTEGRATION_DATABASE_URL points at a disposable, fully migrated
// database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { default: reviewRoutes } = await import('../../routes/review.routes.js');
const { default: reviewPortalRoutes } = await import('../../routes/review-portal.routes.js');
const { reauthCookies, withSession } = await import('../helpers/reauth.js');
const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');
const { hashShareToken } = await import('../../services/media-review.service.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('review share links stay inside their session and review data inside its tenant', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const orgA = `review-org-a-${suffix}`;
  const orgB = `review-org-b-${suffix}`;
  let app;

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Review Tenant A', slug: `review-a-${suffix}` },
      { id: orgB, name: 'Review Tenant B', slug: `review-b-${suffix}` },
    ] });
    const users = {};
    for (const [key, org] of [['a', orgA], ['b', orgB]]) {
      users[key] = await raw.user.create({ data: { organizationId: org, email: `review-${key}-${suffix}@example.com`, name: `Reviewer ${key.toUpperCase()}`, password: 'x', role: 'ADMIN' } });
    }
    const fixtures = {};
    for (const [key, org] of [['a', orgA], ['b', orgB]]) {
      const client = await raw.client.create({ data: { organizationId: org, name: `Client ${key}` } });
      const project = await raw.project.create({ data: { organizationId: org, clientId: client.id, name: `Site ${key}` } });
      const file = (name, mimeType) => raw.attachment.create({ data: {
        organizationId: org, filename: `${name}-${suffix}.bin`, originalName: `${name}.bin`, mimeType, size: 10,
        path: `/uploads/${name}-${suffix}.bin`, entityType: 'PROJECT', entityId: project.id, uploadedById: users[key].id,
      } });
      fixtures[key] = { project, image: await file(`image-${key}`, 'image/png'), video: await file(`video-${key}`, 'video/mp4') };
    }

    app = Fastify();
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    app.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/api/portal/')) request.prisma = raw;
    });
    app.decorate('authenticate', async (request, reply) => {
      const user = { a: users.a, b: users.b }[request.headers['x-test-user']];
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });
      request.user = withSession({ id: user.id, role: user.role, organizationId: user.organizationId, name: user.name, email: user.email });
      request.prisma = createScopedPrisma(raw, user.organizationId);
      return undefined;
    });
    await app.register(reviewRoutes, { prefix: '/api/reviews' });
    await app.register(reviewPortalRoutes, { prefix: '/api/portal/review' });

    const staff = (key, method, url, payload, cookies = {}) => app.inject({ method, url: `/api/reviews${url}`, payload, headers: { 'x-test-user': key }, cookies });
    const guest = (method, url, payload) => app.inject({ method, url: `/api/portal/review/${url}`, payload });
    const session = async (key, attachment, title) => {
      const response = await staff(key, 'POST', '', { projectId: fixtures[key].project.id, attachmentId: attachment.id, title });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().session;
    };
    const link = async (key, sessionId, body = {}) => {
      const response = await staff(key, 'POST', `/${sessionId}/share-links`, body, reauthCookies({ id: users[key].id }));
      assert.equal(response.statusCode, 201, response.body);
      return response.json();
    };

    const a1 = await session('a', fixtures.a.image, 'Homepage');
    const a2 = await session('a', fixtures.a.video, 'Walkthrough');
    const b1 = await session('b', fixtures.b.image, 'Tenant B homepage');

    // Tenant A cannot create a session over tenant B's project or file.
    assert.equal((await staff('a', 'POST', '', { projectId: fixtures.b.project.id, attachmentId: fixtures.b.image.id, title: 'x' })).statusCode, 404);
    assert.equal((await staff('a', 'POST', '', { projectId: fixtures.a.project.id, attachmentId: fixtures.b.image.id, title: 'x' })).statusCode, 404);
    assert.equal((await staff('a', 'GET', `/${b1.id}`)).statusCode, 404);
    await assert.rejects(
      createScopedPrisma(raw, orgA).reviewSession.create({ data: { projectId: fixtures.b.project.id, attachmentId: fixtures.b.image.id, title: 'forged', createdById: users.a.id } }),
      /Tenancy Error/,
    );

    const annotationA2 = (await staff('a', 'POST', `/${a2.id}/annotations`, { body: 'Other session', timecodeMs: 1000 })).json().annotation;
    const annotationB1 = (await staff('b', 'POST', `/${b1.id}/annotations`, { body: 'Tenant B only' })).json().annotation;
    await assert.rejects(
      createScopedPrisma(raw, orgA).reviewAnnotation.create({ data: { sessionId: b1.id, authorType: 'staff', authorUserId: users.a.id, authorName: 'x', body: 'forged' } }),
      /Tenancy Error/,
    );
    assert.equal(await createScopedPrisma(raw, orgA).reviewAnnotation.count({ where: { id: annotationB1.id } }), 0);

    const { token, shareLink } = await link('a', a1.id, { allowDecision: true });
    const stored = await raw.reviewShareLink.findUnique({ where: { id: shareLink.id } });
    assert.equal(stored.tokenHash, hashShareToken(token));
    assert.equal(JSON.stringify(stored).includes(token), false);

    // The link reads only its own session.
    const view = await guest('GET', token);
    assert.equal(view.statusCode, 200);
    assert.equal(view.json().session.title, 'Homepage');
    assert.deepEqual(view.json().annotations, []);
    for (const leaked of [a2.id, b1.id, annotationA2.id, annotationB1.id, fixtures.a.project.id, orgA, users.a.id]) {
      assert.equal(view.body.includes(leaked), false, `share link view leaked ${leaked}`);
    }
    assert.ok((await raw.reviewShareLink.findUnique({ where: { id: shareLink.id } })).lastUsedAt);

    // Cross-session writes are refused.
    for (const parentId of [annotationA2.id, annotationB1.id]) {
      assert.equal((await guest('POST', `${token}/annotations`, { name: 'Guest', body: 'reply', parentId })).statusCode, 404);
    }
    const comment = await guest('POST', `${token}/annotations`, { name: 'Casey Client', email: 'casey@example.com', body: 'Bigger logo', region: { x: 0.1, y: 0.1, w: 0, h: 0 } });
    assert.equal(comment.statusCode, 201, comment.body);
    const guestRow = await raw.reviewAnnotation.findUnique({ where: { id: comment.json().annotation.id } });
    assert.deepEqual([guestRow.sessionId, guestRow.shareLinkId, guestRow.authorType], [a1.id, shareLink.id, 'guest']);

    const decided = await guest('POST', `${token}/decisions`, { name: 'Casey Client', decision: 'changes_requested', note: 'See comment' });
    assert.equal(decided.statusCode, 201, decided.body);
    assert.equal((await raw.reviewSession.findUnique({ where: { id: a1.id } })).status, 'changes_requested');
    assert.equal((await raw.reviewSession.findUnique({ where: { id: b1.id } })).status, 'open');
    const event = await raw.auditEvent.findFirst({ where: { organizationId: orgA, action: 'review.decision_recorded' } });
    assert.deepEqual([event.actorType, event.actorUserId, event.metadata.via], ['CLIENT', null, 'share_link']);

    // Wrong, expired and revoked tokens are refused.
    assert.equal((await guest('GET', 'x'.repeat(43))).statusCode, 404);
    await raw.reviewShareLink.update({ where: { id: shareLink.id }, data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 5000) } });
    assert.equal((await guest('GET', token)).statusCode, 410);
    assert.equal((await guest('POST', `${token}/decisions`, { name: 'x', decision: 'approved' })).statusCode, 410);
    await raw.reviewShareLink.update({ where: { id: shareLink.id }, data: { expiresAt: new Date(Date.now() + 86_400_000) } });
    assert.equal((await guest('GET', token)).statusCode, 200);
    // Tenant B cannot revoke tenant A's link; tenant A can.
    assert.equal((await staff('b', 'POST', `/${a1.id}/share-links/${shareLink.id}/revoke`)).statusCode, 404);
    assert.equal((await staff('a', 'POST', `/${a1.id}/share-links/${shareLink.id}/revoke`)).statusCode, 200);
    assert.equal((await guest('GET', token)).statusCode, 410);
    assert.equal((await guest('GET', `${token}/file`)).statusCode, 410);

    // Decisions are append-only at the database level; only the session's
    // own deletion removes them.
    const decision = await raw.reviewDecision.findFirst({ where: { sessionId: a1.id } });
    await assert.rejects(raw.reviewDecision.update({ where: { id: decision.id }, data: { decision: 'approved' } }), /append-only/);
    await assert.rejects(raw.reviewDecision.delete({ where: { id: decision.id } }), /append-only/);
    await assert.rejects(raw.$executeRawUnsafe('TRUNCATE "review_decisions"'), /append-only/);

    // CHECK constraints.
    const base = { sessionId: a1.id, authorName: 'x', body: 'x' };
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, authorType: 'staff' } }), /author_check|check constraint/);
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, authorType: 'robot' } }), /author_check|check constraint/);
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, authorType: 'guest', body: 'x'.repeat(5001) } }), /body_check|check constraint/);
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, authorType: 'guest', regionX: 0.9, regionY: 0, regionW: 0.5, regionH: 0 } }), /region_check|check constraint/);
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, authorType: 'guest', regionX: 0.1 } }), /region_check|check constraint/);
    await assert.rejects(raw.reviewSession.update({ where: { id: a1.id }, data: { status: 'done' } }), /status_check|check constraint/);
    await assert.rejects(raw.reviewDecision.create({ data: { sessionId: a1.id, decision: 'maybe', actorType: 'staff', actorUserId: users.a.id, actorName: 'x' } }), /decision_check|check constraint/);
    await assert.rejects(raw.reviewDecision.create({ data: { sessionId: a1.id, decision: 'approved', actorType: 'guest', actorName: 'x' } }), /actor_check|check constraint/);
    await assert.rejects(raw.reviewShareLink.create({ data: { sessionId: a1.id, tokenHash: 'plain-token', expiresAt: new Date(Date.now() + 1000), createdById: users.a.id } }), /token_hash_check|check constraint/);
    await assert.rejects(
      raw.reviewShareLink.create({ data: { sessionId: a1.id, tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 91 * 86_400_000), createdById: users.a.id } }),
      /expiry_check|check constraint/,
    );

    // Versioning: one next version per session, previous closed.
    const v2 = await staff('a', 'POST', '', { projectId: fixtures.a.project.id, attachmentId: fixtures.a.video.id, title: 'Homepage v2', previousSessionId: a1.id });
    assert.equal(v2.statusCode, 201, v2.body);
    assert.equal(v2.json().session.version, 2);
    assert.equal((await raw.reviewSession.findUnique({ where: { id: a1.id } })).status, 'closed');
    assert.equal((await staff('a', 'POST', '', { projectId: fixtures.a.project.id, attachmentId: fixtures.a.image.id, title: 'fork', previousSessionId: a1.id })).statusCode, 409);

    // A reviewed file cannot be deleted: the foreign key is RESTRICT, so the
    // approval evidence can never go with it.
    await assert.rejects(raw.attachment.delete({ where: { id: fixtures.a.image.id } }), /foreign key|P2003|violates/i);
    await assert.rejects(raw.attachment.delete({ where: { id: fixtures.a.video.id } }), /foreign key|P2003|violates/i);
    assert.equal(await raw.reviewDecision.count({ where: { sessionId: a1.id } }), 1);

    // Hard-deleting the project (trash purge) is the deliberate lifecycle
    // path: it removes its review data, decisions included; the audit events
    // stay (docs/media-review.md).
    await raw.project.delete({ where: { id: fixtures.a.project.id } });
    assert.equal(await raw.reviewDecision.count({ where: { sessionId: a1.id } }), 0);
    assert.equal(await raw.reviewSession.count({ where: { organizationId: orgA } }), 0);
  } finally {
    await app?.close();
    await raw.reviewSession.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.project.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.attachment.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    if (await purgeFixtureAuditEvents(raw, { ids: [orgA, orgB] })) {
      await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await raw.$disconnect();
  }
});
