// Review evidence export and upload checksums (#417, docs/media-review.md
// "Evidence export" and "Upload checksums") against a real PostgreSQL schema:
//
// - a staff upload stores the SHA-256 of the bytes written; a refused upload
//   is an `upload.rejected` audit event;
// - GET /api/reviews/:id/export is a JSON download (Content-Disposition,
//   X-Evidence-Sha256 of the exact body) with the review, every asset version
//   and its checksum, annotations and markup with authors, decisions with
//   actor, role and comment, share links and the review audit trail, and no
//   storage path or share token;
// - it has the same access as viewing the review: another organization's
//   staff get 404, non-staff principals 403, anonymous callers 401.
//
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { default: reviewRoutes } = await import('../../routes/review.routes.js');
const { default: reviewPortalRoutes } = await import('../../routes/review-portal.routes.js');
const { default: attachmentRoutes } = await import('../../routes/attachment.routes.js');
const { reauthCookies, withSession } = await import('../helpers/reauth.js');
const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const fixturePassword = () => ['fixture', randomUUID()].join(':');
const png = (label) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function multipartBody(fields, name, type, bytes) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', new Blob([bytes], { type }), name);
  const encoded = new Request('http://localhost/upload', { method: 'POST', body: form });
  return { payload: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type') };
}

test('review evidence export carries versions, checksums, markup, decisions and share-link history, inside its tenant', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const orgA = `evidence-org-a-${suffix}`;
  const orgB = `evidence-org-b-${suffix}`;
  let app;

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Evidence Tenant A', slug: `evidence-a-${suffix}` },
      { id: orgB, name: 'Evidence Tenant B', slug: `evidence-b-${suffix}` },
    ] });
    const users = {
      a: await raw.user.create({ data: { organizationId: orgA, email: `evidence-a-${suffix}@example.com`, name: 'Avery Admin', password: fixturePassword(), role: 'ADMIN' } }),
      team: await raw.user.create({ data: { organizationId: orgA, email: `evidence-team-${suffix}@example.com`, name: 'Taylor Team', password: fixturePassword(), role: 'TEAM' } }),
      bot: await raw.user.create({ data: { organizationId: orgA, email: `evidence-bot-${suffix}@example.com`, name: 'Bot', password: fixturePassword(), role: 'BOT' } }),
      b: await raw.user.create({ data: { organizationId: orgB, email: `evidence-b-${suffix}@example.com`, name: 'Blake Admin', password: fixturePassword(), role: 'ADMIN' } }),
    };
    const clientA = await raw.client.create({ data: { organizationId: orgA, name: 'Evidence client' } });
    const projectA = await raw.project.create({ data: { organizationId: orgA, clientId: clientA.id, name: 'Evidence site' } });

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
    await app.register(rateLimit, { global: false });
    app.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/api/portal/')) request.prisma = raw;
    });
    app.decorate('authenticate', async (request, reply) => {
      const user = users[request.headers['x-test-user']];
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });
      request.user = withSession({ id: user.id, role: user.role, organizationId: user.organizationId, name: user.name, email: user.email });
      request.prisma = createScopedPrisma(raw, user.organizationId);
      return undefined;
    });
    await app.register(attachmentRoutes, { prefix: '/api/attachments' });
    await app.register(reviewRoutes, { prefix: '/api/reviews' });
    await app.register(reviewPortalRoutes, { prefix: '/api/portal/review' });

    const staff = (key, method, url, payload, cookies = {}) => app.inject({ method, url: `/api/reviews${url}`, payload, headers: { 'x-test-user': key }, cookies });
    const guest = (method, url, payload) => app.inject({ method, url: `/api/portal/review/${url}`, payload });
    const upload = async (key, name, bytes, type = 'image/png') => {
      const { payload, contentType } = await multipartBody({ entityType: 'PROJECT', entityId: projectA.id }, name, type, bytes);
      return app.inject({ method: 'POST', url: '/api/attachments', payload, headers: { 'x-test-user': key, 'content-type': contentType } });
    };

    // ── Upload checksums ────────────────────────────────────────────────────
    const v1Bytes = png('homepage-v1');
    const v2Bytes = png('homepage-v2');
    const v1Upload = await upload('a', 'homepage.png', v1Bytes);
    assert.equal(v1Upload.statusCode, 201, v1Upload.body);
    const v2Upload = await upload('a', 'homepage-v2.png', v2Bytes);
    assert.equal(v2Upload.statusCode, 201, v2Upload.body);
    const v1File = await raw.attachment.findUnique({ where: { id: v1Upload.json().id } });
    const v2File = await raw.attachment.findUnique({ where: { id: v2Upload.json().id } });
    assert.equal(v1File.checksumSha256, sha256(v1Bytes));
    assert.equal(v2File.checksumSha256, sha256(v2Bytes));
    assert.equal(sha256(await fs.readFile(path.join(UPLOAD_DIR, v1File.filename))), v1File.checksumSha256, 'the checksum is of the bytes on disk');
    // The database refuses a malformed checksum.
    await assert.rejects(raw.attachment.update({ where: { id: v1File.id }, data: { checksumSha256: 'not-a-sha' } }), /check constraint|violates|_check/i);

    const refused = await upload('a', 'evil.png', Buffer.from('GIF89a but not a png'));
    assert.equal(refused.statusCode, 400);
    const rejection = await raw.auditEvent.findFirst({ where: { organizationId: orgA, action: 'upload.rejected' } });
    assert.ok(rejection, 'a refused upload is audited');
    assert.deepEqual(
      [rejection.actorType, rejection.actorUserId, rejection.metadata.surface, rejection.metadata.reason, rejection.metadata.projectId, rejection.metadata.extension],
      ['USER', users.a.id, 'attachments', 'CONTENT_MISMATCH', projectA.id, '.png'],
    );

    // ── A review with two versions, markup, a share link and decisions ─────
    const v1 = (await staff('a', 'POST', '', { projectId: projectA.id, attachmentId: v1File.id, title: 'Homepage hero' })).json().session;
    const markup = await staff('team', 'POST', `/${v1.id}/annotations`, {
      body: 'Logo too small', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, shape: 'rect', color: 'red',
    });
    assert.equal(markup.statusCode, 201, markup.body);
    const link = await staff('a', 'POST', `/${v1.id}/share-links`, { allowDecision: true, label: 'Client review' }, reauthCookies({ id: users.a.id }));
    assert.equal(link.statusCode, 201, link.body);
    const { token, shareLink } = link.json();
    const guestComment = await guest('POST', `${token}/annotations`, { name: 'Casey Client', email: 'casey@example.com', body: 'Agree, bigger please', parentId: markup.json().annotation.id });
    assert.equal(guestComment.statusCode, 201, guestComment.body);
    const guestDecision = await guest('POST', `${token}/decisions`, { name: 'Casey Client', decision: 'changes_requested', note: 'See the logo comment' });
    assert.equal(guestDecision.statusCode, 201, guestDecision.body);
    assert.equal((await staff('a', 'POST', `/${v1.id}/share-links/${shareLink.id}/revoke`)).statusCode, 200);

    const v2Response = await staff('a', 'POST', '', { projectId: projectA.id, attachmentId: v2File.id, title: 'Homepage hero', previousSessionId: v1.id });
    assert.equal(v2Response.statusCode, 201, v2Response.body);
    const v2 = v2Response.json().session;
    const approved = await staff('a', 'POST', `/${v2.id}/decisions`, { decision: 'approved', note: 'Ship it' });
    assert.equal(approved.statusCode, 201, approved.body);

    // ── Export ──────────────────────────────────────────────────────────────
    const exported = await staff('team', 'GET', `/${v2.id}/export`);
    assert.equal(exported.statusCode, 200, exported.body);
    assert.match(exported.headers['content-type'], /^application\/json/);
    assert.match(exported.headers['content-disposition'], /^attachment; filename="review-evidence-homepage-hero-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal(exported.headers['cache-control'], 'no-store');
    assert.equal(exported.headers['x-evidence-sha256'], sha256(exported.rawPayload), 'the header hashes the exact body');
    for (const secret of [token, '/uploads/', shareLink.tokenHash].filter(Boolean)) {
      assert.equal(exported.body.includes(secret), false, `export leaked ${secret}`);
    }
    const evidence = exported.json();
    assert.equal(evidence.format, 'ashbi.review-evidence');
    assert.equal(evidence.formatVersion, 1);
    assert.equal(evidence.exportedBy.userId, users.team.id);
    assert.deepEqual(
      [evidence.review.id, evidence.review.title, evidence.review.status, evidence.review.version, evidence.review.project.id, evidence.review.project.name],
      [v2.id, 'Homepage hero', 'approved', 2, projectA.id, 'Evidence site'],
    );

    assert.deepEqual(evidence.versions.map((version) => [version.sessionId, version.version, version.status, version.current]), [
      [v1.id, 1, 'closed', false],
      [v2.id, 2, 'approved', true],
    ]);
    assert.deepEqual(evidence.versions.map((version) => version.asset), [
      { attachmentId: v1File.id, fileName: 'homepage.png', storedFileName: v1File.filename, mimeType: 'image/png', kind: 'image', size: v1Bytes.length, checksum: { algorithm: 'sha256', value: sha256(v1Bytes) }, uploadedById: users.a.id, uploadedAt: v1File.createdAt.toISOString() },
      { attachmentId: v2File.id, fileName: 'homepage-v2.png', storedFileName: v2File.filename, mimeType: 'image/png', kind: 'image', size: v2Bytes.length, checksum: { algorithm: 'sha256', value: sha256(v2Bytes) }, uploadedById: users.a.id, uploadedAt: v2File.createdAt.toISOString() },
    ]);

    assert.equal(evidence.annotations.length, 2);
    const [staffNote, guestReply] = evidence.annotations;
    assert.deepEqual(
      [staffNote.sessionId, staffNote.version, staffNote.authorType, staffNote.authorRole, staffNote.authorUserId, staffNote.authorName, staffNote.body, staffNote.shape, staffNote.color],
      [v1.id, 1, 'staff', 'TEAM', users.team.id, 'Taylor Team', 'Logo too small', 'rect', 'red'],
    );
    assert.deepEqual(staffNote.region, { x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
    assert.ok(staffNote.createdAt && staffNote.updatedAt);
    assert.deepEqual(
      [guestReply.parentId, guestReply.authorType, guestReply.authorRole, guestReply.authorName, guestReply.authorEmail, guestReply.viaShareLinkId],
      [staffNote.id, 'guest', 'GUEST', 'Casey Client', 'casey@example.com', shareLink.id],
    );

    assert.deepEqual(evidence.decisions.map((decision) => [decision.sessionId, decision.version, decision.decision, decision.actorType, decision.actorRole, decision.actorName, decision.comment, decision.viaShareLinkId]), [
      [v1.id, 1, 'changes_requested', 'guest', 'GUEST', 'Casey Client', 'See the logo comment', shareLink.id],
      [v2.id, 2, 'approved', 'staff', 'ADMIN', 'Avery Admin', 'Ship it', null],
    ]);
    assert.ok(evidence.decisions.every((decision) => typeof decision.createdAt === 'string'));

    assert.equal(evidence.shareLinks.length, 1);
    assert.deepEqual(
      [evidence.shareLinks[0].id, evidence.shareLinks[0].sessionId, evidence.shareLinks[0].state, evidence.shareLinks[0].allowDecision, evidence.shareLinks[0].revokedById, evidence.shareLinks[0].createdById],
      [shareLink.id, v1.id, 'revoked', true, users.a.id, users.a.id],
    );
    assert.ok(evidence.shareLinks[0].lastUsedAt, 'link use is recorded');
    const trail = evidence.auditTrail.map((event) => `${event.action}:${event.entityId}`);
    for (const expected of [
      `review.session_created:${v1.id}`,
      `review.share_link_created:${shareLink.id}`,
      `review.decision_recorded:${v1.id}`,
      `review.share_link_revoked:${shareLink.id}`,
      `review.session_created:${v2.id}`,
      `review.decision_recorded:${v2.id}`,
    ]) {
      assert.ok(trail.includes(expected), `audit trail has ${expected}: ${trail.join(', ')}`);
    }
    assert.deepEqual(evidence.completeness, { versionChainComplete: true, annotationsTruncated: false, auditTrailTruncated: false, assetsWithoutChecksum: 0 });

    // The export itself is audited, with counts only.
    const exportAudit = await raw.auditEvent.findFirst({ where: { organizationId: orgA, action: 'review.evidence_exported', entityId: v2.id } });
    assert.ok(exportAudit);
    assert.deepEqual(
      [exportAudit.actorUserId, exportAudit.metadata.versionCount, exportAudit.metadata.annotationCount, exportAudit.metadata.decisionCount, exportAudit.metadata.shareLinkCount],
      [users.team.id, 2, 2, 2, 1],
    );
    // Exporting the older version yields the same chain, marked current there.
    const olderExport = (await staff('a', 'GET', `/${v1.id}/export`)).json();
    assert.deepEqual(olderExport.versions.map((version) => version.current), [true, false]);

    // A legacy file stored before checksums: exported with a null checksum.
    const legacy = await raw.attachment.create({ data: {
      organizationId: orgA, filename: `legacy-${suffix}.png`, originalName: 'legacy.png', mimeType: 'image/png', size: 10,
      path: `/uploads/legacy-${suffix}.png`, entityType: 'PROJECT', entityId: projectA.id, uploadedById: users.a.id,
    } });
    const legacySession = (await staff('a', 'POST', '', { projectId: projectA.id, attachmentId: legacy.id, title: 'Legacy' })).json().session;
    const legacyExport = (await staff('a', 'GET', `/${legacySession.id}/export`)).json();
    assert.equal(legacyExport.versions[0].asset.checksum, null);
    assert.equal(legacyExport.completeness.assetsWithoutChecksum, 1);

    // ── Authorization ───────────────────────────────────────────────────────
    const otherTenant = await staff('b', 'GET', `/${v2.id}/export`);
    assert.equal(otherTenant.statusCode, 404);
    assert.equal(otherTenant.body.includes('Homepage'), false);
    assert.equal((await staff('bot', 'GET', `/${v2.id}/export`)).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: `/api/reviews/${v2.id}/export` })).statusCode, 401);
    assert.equal((await staff('a', 'GET', `/${randomUUID()}/export`)).statusCode, 404);
    // Refused exports are not audited.
    assert.equal(await raw.auditEvent.count({ where: { organizationId: orgB } }), 0);
    assert.equal(await raw.auditEvent.count({ where: { organizationId: orgA, action: 'review.evidence_exported' } }), 3);
  } finally {
    await app?.close();
    const files = await raw.attachment.findMany({ where: { organizationId: { in: [orgA, orgB] } }, select: { filename: true } });
    await Promise.all(files.map((file) => fs.rm(path.join(UPLOAD_DIR, file.filename), { force: true })));
    await raw.reviewSession.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.activity.deleteMany({ where: { project: { organizationId: { in: [orgA, orgB] } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.attachment.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    if (await purgeFixtureAuditEvents(raw, { ids: [orgA, orgB] })) {
      await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await raw.$disconnect();
  }
});
