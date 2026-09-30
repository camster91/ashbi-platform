// Client portal trust (#286) against a real PostgreSQL schema, through the
// real client-portal plugin and its clientAuth guard (signed client_session
// tokens, re-resolved on every request):
//
// - revocation: a portal session answers 401 on its very next request once
//   the client is paused, archived, churned or deleted, the contact is
//   removed or the user deactivated; the Socket.IO handshake and project
//   room joins refuse the same principal (src/auth/portal-principal.js);
// - two organizations: a portal session of organization A's client cannot
//   read organization B's projects, documents, invoices or reviews by id;
// - approvals and feedback leave an Activity row and an append-only audit
//   event (client_portal.revision_responded, client_portal.feedback_submitted,
//   review.decision_recorded via client_portal); uploads the file policy
//   refuses are audited (upload.rejected) and stored uploads carry a SHA-256.
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
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { default: clientPortalRoutes } = await import('../../routes/client-portal.routes.js');
const { signUserSession } = await import('../../auth/session.js');
const { createSocketAuthMiddleware, withClientReauthorization } = await import('../../auth/socket-auth.js');
const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
// Fixture credentials are built at runtime (never a literal secret).
const fixturePassword = () => ['fixture', randomUUID()].join(':');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('portal-trust-png')]);

async function multipartBody(name, type, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const encoded = new Request('http://localhost/upload', { method: 'POST', body: form });
  return { payload: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type') };
}

test('client portal: revocation, cross-organization isolation and auditable approvals', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const orgA = `trust-org-a-${suffix}`;
  const orgB = `trust-org-b-${suffix}`;
  const writtenFiles = [];
  let app;

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Trust Tenant A', slug: `trust-a-${suffix}` },
      { id: orgB, name: 'Trust Tenant B', slug: `trust-b-${suffix}` },
    ] });

    const fixtures = {};
    for (const [key, org] of [['a', orgA], ['b', orgB]]) {
      const staff = await raw.user.create({ data: { organizationId: org, email: `trust-staff-${key}-${suffix}@example.com`, name: `Staff ${key}`, password: fixturePassword(), role: 'ADMIN' } });
      const client = await raw.client.create({ data: { organizationId: org, name: `Trust client ${key}` } });
      const project = await raw.project.create({ data: { organizationId: org, clientId: client.id, name: `Trust site ${key}` } });
      const email = `trust-contact-${key}-${suffix}@example.com`;
      const contact = await raw.contact.create({ data: { clientId: client.id, name: `Contact ${key.toUpperCase()}`, email } });
      const user = await raw.user.create({ data: { organizationId: org, clientId: client.id, email, name: contact.name, password: fixturePassword(), role: 'CLIENT' } });
      const storedName = `trust-${key}-${suffix}.png`;
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      await fs.writeFile(path.join(UPLOAD_DIR, storedName), PNG);
      writtenFiles.push(storedName);
      const document = await raw.attachment.create({ data: {
        organizationId: org, filename: storedName, originalName: `${key}.png`, mimeType: 'image/png', size: PNG.length,
        path: `/uploads/${storedName}`, entityType: 'PROJECT', entityId: project.id, uploadedById: staff.id,
      } });
      const invoice = await raw.invoice.create({ data: { invoiceNumber: `TRUST-${key}-${suffix}`, clientId: client.id, organizationId: org, createdById: staff.id, status: 'SENT', total: 100 } });
      const revision = await raw.revisionRound.create({ data: { projectId: project.id, roundNumber: 1, status: 'IN_REVIEW' } });
      const review = await raw.reviewSession.create({ data: {
        organizationId: org, projectId: project.id, attachmentId: document.id, title: `Review ${key}`,
        sharedWithClient: true, clientCanDecide: true, createdById: staff.id,
      } });
      fixtures[key] = { org, staff, client, project, contact, user, document, invoice, revision, review };
    }

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
    await app.register(rateLimit, { global: false });
    await app.register(jwt, { secret: `portal-trust-${randomUUID()}`, cookie: { cookieName: 'token', signed: false } });
    app.decorate('notify', async () => {});
    app.decorate('io', { to: () => ({ emit: () => {} }) });
    // /api/client-portal is tenancy-exempt in production: the raw client.
    app.addHook('onRequest', async (request) => { request.prisma = raw; });
    await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
    await app.ready();

    const tokenFor = async (key) => {
      const user = await raw.user.findUnique({ where: { id: fixtures[key].user.id } });
      return signUserSession(app.jwt, user, { contactId: fixtures[key].contact.id });
    };
    const tokenA = await tokenFor('a');
    const tokenB = await tokenFor('b');
    const as = (token, method, url, payload, headers = {}) => app.inject({
      method, url: `/api/client-portal${url}`, payload, headers: { authorization: `Bearer ${token}`, ...headers },
    });
    const a = fixtures.a;
    const b = fixtures.b;

    // ── Two organizations: A's session reads its own records only ──────────
    assert.equal((await as(tokenA, 'GET', `/projects/${a.project.id}`)).statusCode, 200);
    const ownDownload = await as(tokenA, 'GET', `/documents/${a.document.id}/download`);
    assert.equal(ownDownload.statusCode, 200, ownDownload.body);
    assert.equal((await as(tokenA, 'GET', `/reviews/${a.review.id}`)).statusCode, 200);
    const ownInvoices = (await as(tokenA, 'GET', '/invoices')).json();
    assert.deepEqual(ownInvoices.map((invoice) => invoice.id), [a.invoice.id]);
    const ownProjects = (await as(tokenA, 'GET', '/projects')).json();
    assert.deepEqual(ownProjects.map((project) => project.id), [a.project.id]);
    const ownReviews = (await as(tokenA, 'GET', '/reviews')).json().sessions;
    assert.deepEqual(ownReviews.map((session) => session.id), [a.review.id]);

    for (const [method, url, payload] of [
      ['GET', `/projects/${b.project.id}`],
      ['GET', `/projects/${b.project.id}/tasks`],
      ['GET', `/projects/${b.project.id}/documents`],
      ['GET', `/projects/${b.project.id}/messages`],
      ['GET', `/documents/${b.document.id}/download`],
      ['GET', `/invoices/${b.invoice.id}/pdf`],
      ['GET', `/reviews/${b.review.id}`],
      ['GET', `/reviews/${b.review.id}/file`],
      ['POST', `/reviews/${b.review.id}/annotations`, { body: 'cross-tenant comment' }],
      ['POST', `/reviews/${b.review.id}/decisions`, { decision: 'approved' }],
      ['POST', `/projects/${b.project.id}/feedback`, { message: 'cross-tenant feedback' }],
      ['POST', `/projects/${b.project.id}/revisions/${b.revision.id}/respond`, { action: 'APPROVE' }],
      // B's revision through A's own project id: the round must belong to it.
      ['POST', `/projects/${a.project.id}/revisions/${b.revision.id}/respond`, { action: 'APPROVE' }],
      ['DELETE', `/documents/${b.document.id}`],
    ]) {
      const response = await as(tokenA, method, url, payload);
      assert.equal(response.statusCode, 404, `${method} ${url} as organization A: ${response.body}`);
      for (const leaked of [b.client.name, b.review.title, b.invoice.invoiceNumber]) {
        assert.equal(response.body.includes(leaked), false, `${method} ${url} leaked ${leaked}`);
      }
    }
    // Nothing of B changed.
    assert.equal((await raw.revisionRound.findUnique({ where: { id: b.revision.id } })).status, 'IN_REVIEW');
    assert.equal(await raw.reviewDecision.count({ where: { sessionId: b.review.id } }), 0);
    assert.equal(await raw.reviewAnnotation.count({ where: { sessionId: b.review.id } }), 0);
    assert.ok(await raw.attachment.findUnique({ where: { id: b.document.id } }));
    assert.equal(await raw.activity.count({ where: { projectId: b.project.id } }), 0);
    // And B still reads its own project (the refusals above were A's).
    assert.equal((await as(tokenB, 'GET', `/projects/${b.project.id}`)).statusCode, 200);

    // ── Approvals and feedback are auditable ────────────────────────────────
    const approved = await as(tokenA, 'POST', `/projects/${a.project.id}/revisions/${a.revision.id}/respond`, { action: 'APPROVE' });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().status, 'APPROVED');
    const approvalActivity = await raw.activity.findFirst({ where: { entityType: 'REVISION_ROUND', entityId: a.revision.id } });
    assert.equal(approvalActivity.type, 'CLIENT_REVISION_APPROVED');
    assert.equal(approvalActivity.userId, a.user.id);
    assert.equal(JSON.parse(approvalActivity.metadata).contactId, a.contact.id);
    const approvalAudit = await raw.auditEvent.findFirst({ where: { organizationId: orgA, action: 'client_portal.revision_responded', entityId: a.revision.id } });
    assert.ok(approvalAudit, 'the approval writes an audit event');
    assert.equal(approvalAudit.actorType, 'CLIENT');
    assert.equal(approvalAudit.actorUserId, a.user.id);
    assert.equal(approvalAudit.entityType, 'revision_round');
    assert.deepEqual(
      [approvalAudit.metadata.projectId, approvalAudit.metadata.clientId, approvalAudit.metadata.contactId, approvalAudit.metadata.response, approvalAudit.metadata.roundNumber, approvalAudit.metadata.activityId],
      [a.project.id, a.client.id, a.contact.id, 'APPROVE', 1, approvalActivity.id],
    );
    // A second response to an approved round is refused and not audited again.
    assert.equal((await as(tokenA, 'POST', `/projects/${a.project.id}/revisions/${a.revision.id}/respond`, { action: 'APPROVE' })).statusCode, 409);
    assert.equal(await raw.auditEvent.count({ where: { organizationId: orgA, action: 'client_portal.revision_responded' } }), 1);

    const feedback = await as(tokenA, 'POST', `/projects/${a.project.id}/feedback`, { message: 'Please make the logo bigger' });
    assert.equal(feedback.statusCode, 201, feedback.body);
    const feedbackActivity = await raw.activity.findUnique({ where: { id: feedback.json().id } });
    assert.deepEqual([feedbackActivity.type, feedbackActivity.projectId, feedbackActivity.userId], ['CLIENT_FEEDBACK', a.project.id, a.user.id]);
    const feedbackAudit = await raw.auditEvent.findFirst({ where: { organizationId: orgA, action: 'client_portal.feedback_submitted', entityId: a.project.id } });
    assert.ok(feedbackAudit, 'feedback writes an audit event');
    assert.equal(feedbackAudit.actorType, 'CLIENT');
    assert.equal(feedbackAudit.metadata.activityId, feedbackActivity.id);
    assert.equal(feedbackAudit.metadata.messageLength, 'Please make the logo bigger'.length);
    assert.equal(JSON.stringify(feedbackAudit.metadata).includes('logo'), false, 'the message text stays out of the audit log');

    const decided = await as(tokenA, 'POST', `/reviews/${a.review.id}/decisions`, { decision: 'approved', note: 'Looks good' });
    assert.equal(decided.statusCode, 201, decided.body);
    const decisionRow = await raw.reviewDecision.findFirst({ where: { sessionId: a.review.id } });
    assert.deepEqual([decisionRow.actorType, decisionRow.actorUserId, decisionRow.decision], ['client', a.user.id, 'approved']);
    const decisionAudit = await raw.auditEvent.findFirst({ where: { organizationId: orgA, action: 'review.decision_recorded', entityId: a.review.id } });
    assert.deepEqual([decisionAudit.actorType, decisionAudit.metadata.via, decisionAudit.metadata.decisionId], ['CLIENT', 'client_portal', decisionRow.id]);
    // None of it was filed under organization B.
    assert.equal(await raw.auditEvent.count({ where: { organizationId: orgB } }), 0);

    // ── Uploads: SHA-256 on stored files, refused files audited ────────────
    const good = await multipartBody('brief.png', 'image/png', PNG);
    const uploaded = await as(tokenA, 'POST', `/projects/${a.project.id}/upload`, good.payload, { 'content-type': good.contentType });
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    const storedUpload = await raw.attachment.findUnique({ where: { id: uploaded.json().id } });
    writtenFiles.push(storedUpload.filename);
    assert.equal(storedUpload.checksumSha256, createHash('sha256').update(PNG).digest('hex'));
    const chatUpload = await as(tokenA, 'POST', `/projects/${a.project.id}/chat-uploads`, good.payload, { 'content-type': good.contentType });
    assert.equal(chatUpload.statusCode, 201, chatUpload.body);
    const storedChat = await raw.attachment.findUnique({ where: { id: chatUpload.json().id } });
    writtenFiles.push(storedChat.filename);
    assert.equal(storedChat.checksumSha256, createHash('sha256').update(PNG).digest('hex'));

    const spoofed = await multipartBody('invoice.png', 'image/png', Buffer.from('<script>alert(1)</script>'));
    const refused = await as(tokenA, 'POST', `/projects/${a.project.id}/upload`, spoofed.payload, { 'content-type': spoofed.contentType });
    assert.equal(refused.statusCode, 400);
    const refusedChat = await as(tokenA, 'POST', `/projects/${a.project.id}/chat-uploads`, spoofed.payload, { 'content-type': spoofed.contentType });
    assert.equal(refusedChat.statusCode, 400);
    const rejections = await raw.auditEvent.findMany({ where: { organizationId: orgA, action: 'upload.rejected' } });
    // Compared as a set: both rows can share a createdAt.
    assert.deepEqual(rejections.map((event) => event.metadata.surface).sort(), ['client_portal_chat', 'client_portal_documents']);
    for (const event of rejections) {
      assert.equal(event.actorType, 'CLIENT');
      assert.equal(event.entityType, 'attachment');
      assert.equal(event.entityId, null);
      assert.deepEqual([event.metadata.reason, event.metadata.extension, event.metadata.mimeType, event.metadata.projectId], ['CONTENT_MISMATCH', '.png', 'image/png', a.project.id]);
      assert.equal(JSON.stringify(event.metadata).includes('invoice'), false, 'the file name stays out of the audit log');
    }

    // ── Revocation takes effect on the next request ────────────────────────
    const me = () => as(tokenA, 'GET', '/me');
    assert.equal((await me()).statusCode, 200);
    const revocations = [
      ['client paused', () => raw.client.update({ where: { id: a.client.id }, data: { status: 'PAUSED' } }), () => raw.client.update({ where: { id: a.client.id }, data: { status: 'ACTIVE' } })],
      ['client archived', () => raw.client.update({ where: { id: a.client.id }, data: { relationshipStatus: 'ARCHIVED' } }), () => raw.client.update({ where: { id: a.client.id }, data: { relationshipStatus: 'ACTIVE' } })],
      ['client churned', () => raw.client.update({ where: { id: a.client.id }, data: { relationshipStatus: 'CHURNED' } }), () => raw.client.update({ where: { id: a.client.id }, data: { relationshipStatus: 'ACTIVE' } })],
      ['client deleted', () => raw.client.update({ where: { id: a.client.id }, data: { deletedAt: new Date() } }), () => raw.client.update({ where: { id: a.client.id }, data: { deletedAt: null } })],
      ['user deactivated', () => raw.user.update({ where: { id: a.user.id }, data: { isActive: false } }), () => raw.user.update({ where: { id: a.user.id }, data: { isActive: true } })],
    ];

    // Socket.IO: the handshake and room joins resolve the same principal.
    const socketAuth = createSocketAuthMiddleware({ verifyToken: (token) => app.jwt.verify(token), parseCookie: () => ({}), prisma: raw });
    const handshake = (token) => new Promise((resolve) => {
      const socket = { handshake: { headers: {}, auth: { token } } };
      socketAuth(socket, (err) => resolve({ err, socket }));
    });
    const connected = await handshake(tokenA);
    assert.equal(connected.err, undefined);
    assert.deepEqual([connected.socket.userRole, connected.socket.clientId, connected.socket.organizationId], ['CLIENT', a.client.id, orgA]);
    const joins = [];
    let disconnected = false;
    connected.socket.disconnect = () => { disconnected = true; };
    const joinProject = withClientReauthorization(raw, connected.socket, async (projectId, ack) => { joins.push(projectId); ack?.({ joined: true }); });
    const join = () => new Promise((resolve) => joinProject(a.project.id, resolve));
    assert.deepEqual(await join(), { joined: true });

    for (const [label, revoke, restore] of revocations) {
      await revoke();
      for (const [method, url] of [['GET', '/me'], ['GET', `/projects/${a.project.id}`], ['GET', `/documents/${a.document.id}/download`], ['GET', '/invoices'], ['GET', `/reviews/${a.review.id}`]]) {
        const response = await as(tokenA, method, url);
        assert.equal(response.statusCode, 401, `${label}: ${method} ${url} answered ${response.statusCode}`);
      }
      // A cookie session is refused and its cookie cleared.
      const viaCookie = await app.inject({ method: 'GET', url: '/api/client-portal/me', cookies: { token: tokenA } });
      assert.equal(viaCookie.statusCode, 401, label);
      assert.match(String(viaCookie.headers['set-cookie']), /token=;/, `${label}: stale cookie cleared`);
      assert.ok((await handshake(tokenA)).err, `${label}: socket handshake refused`);
      disconnected = false;
      assert.deepEqual(await join(), { joined: false }, `${label}: room join refused`);
      assert.equal(disconnected, true, `${label}: socket disconnected`);
      await restore();
      assert.equal((await me()).statusCode, 200, `${label}: restored access`);
      assert.deepEqual(await join(), { joined: true }, `${label}: restored room join`);
    }
    assert.equal(joins.length, 1 + revocations.length, 'joins went through only while authorized');

    // Removing the contact revokes the session for good.
    await raw.contact.delete({ where: { id: a.contact.id } });
    assert.equal((await me()).statusCode, 401);
    assert.equal((await as(tokenA, 'GET', `/documents/${a.document.id}/download`)).statusCode, 401);
    assert.ok((await handshake(tokenA)).err, 'contact removed: socket handshake refused');
    // Organization B is untouched by A's revocation.
    assert.equal((await as(tokenB, 'GET', '/me')).statusCode, 200);
  } finally {
    await app?.close();
    await Promise.all(writtenFiles.map((name) => fs.rm(path.join(UPLOAD_DIR, name), { force: true })));
    await raw.reviewSession.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.invoice.deleteMany({ where: { client: { organizationId: { in: [orgA, orgB] } } } });
    await raw.activity.deleteMany({ where: { project: { organizationId: { in: [orgA, orgB] } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.attachment.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.contact.deleteMany({ where: { client: { organizationId: { in: [orgA, orgB] } } } });
    await raw.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    if (await purgeFixtureAuditEvents(raw, { ids: [orgA, orgB] })) {
      await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await raw.$disconnect();
  }
});
