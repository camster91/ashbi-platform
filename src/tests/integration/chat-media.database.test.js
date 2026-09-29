// Chat media against a real PostgreSQL schema (built with `prisma migrate
// deploy`; docs/chat-media.md):
//
// - files upload first as pending chat uploads and the message create claims
//   them in one transaction (a failed claim leaves no message behind);
// - clients read chat files ONLY of CLIENT-visible messages of their own
//   client's projects, over both the message payloads and the download route
//   (INTERNAL files, another client's files, unsent and deleted files are
//   404), and realtime payloads to the client room carry only client-safe
//   attachment fields;
// - unsent uploads older than 24 hours are purged, row and bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import chatRoutes from '../../routes/chat.routes.js';
import clientPortalRoutes from '../../routes/client-portal.routes.js';
import { signUserSession } from '../../auth/session.js';
import { purgeStalePendingChatUploads } from '../../services/chat-attachment.service.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('chat-media-png')]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('chat-media-webm')]);

async function multipartBody(name, type, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const encoded = new Request('http://localhost/upload', { method: 'POST', body: form });
  return { payload: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type') };
}

test('chat media: atomic send, client isolation and pending purge', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 90_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const ids = {
    org: `cm-org-${suffix}`,
    clientA: `cm-client-a-${suffix}`, clientB: `cm-client-b-${suffix}`,
    projectA: `cm-project-a-${suffix}`, projectB: `cm-project-b-${suffix}`,
    staff: `cm-staff-${suffix}`, staff2: `cm-staff2-${suffix}`,
    portalA: `cm-portal-a-${suffix}`, portalB: `cm-portal-b-${suffix}`,
    contactA: `cm-contact-a-${suffix}`, contactB: `cm-contact-b-${suffix}`,
  };
  const emails = { a: `client-a-${suffix}@example.com`, b: `client-b-${suffix}@example.com` };
  // Fixture credentials are generated per run, never literal strings.
  const password = () => `fixture-${randomUUID()}`;
  let app;
  try {
    await raw.organization.create({ data: { id: ids.org, name: 'Chat media tenant', slug: `cm-${suffix}` } });
    await raw.client.createMany({ data: [
      { id: ids.clientA, name: 'Client A', organizationId: ids.org },
      { id: ids.clientB, name: 'Client B', organizationId: ids.org },
    ] });
    await raw.project.createMany({ data: [
      { id: ids.projectA, name: 'Project A', clientId: ids.clientA, organizationId: ids.org },
      { id: ids.projectB, name: 'Project B', clientId: ids.clientB, organizationId: ids.org },
    ] });
    await raw.user.createMany({ data: [
      { id: ids.staff, email: `staff-${suffix}@example.com`, name: `Staff${suffix.slice(0, 4)}`, password: password(), role: 'TEAM', organizationId: ids.org },
      { id: ids.staff2, email: `staff2-${suffix}@example.com`, name: `Other${suffix.slice(0, 4)}`, password: password(), role: 'TEAM', organizationId: ids.org },
      { id: ids.portalA, email: emails.a, name: 'Dana A', password: password(), role: 'CLIENT', clientId: ids.clientA, organizationId: ids.org },
      { id: ids.portalB, email: emails.b, name: 'Blake B', password: password(), role: 'CLIENT', clientId: ids.clientB, organizationId: ids.org },
    ] });
    await raw.contact.createMany({ data: [
      { id: ids.contactA, email: emails.a, name: 'Dana A', clientId: ids.clientA },
      { id: ids.contactB, email: emails.b, name: 'Blake B', clientId: ids.clientB },
    ] });

    let currentStaff = ids.staff;
    const emitted = [];
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
    await app.register(jwt, { secret: `chat-media-${randomUUID()}`, cookie: { cookieName: 'token', signed: false } });
    app.decorate('authenticate', async (request) => {
      request.user = { id: currentStaff, name: 'Staff', organizationId: ids.org, role: 'TEAM' };
    });
    app.decorate('notify', async () => {});
    app.decorate('io', { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) });
    const scoped = createScopedPrisma(raw, ids.org);
    // Staff routes get the tenant-scoped client; the client portal is
    // tenancy-exempt in production and scopes by clientId itself.
    app.addHook('onRequest', async (request) => {
      request.prisma = request.url.startsWith('/api/client-portal') ? raw : scoped;
    });
    await app.register(chatRoutes, { prefix: '/api/chat' });
    await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
    await app.ready();

    const portalUsers = await raw.user.findMany({ where: { id: { in: [ids.portalA, ids.portalB] } } });
    const tokenFor = (userId, contactId) => signUserSession(app.jwt, portalUsers.find((user) => user.id === userId), { contactId });
    const asClientA = { authorization: `Bearer ${tokenFor(ids.portalA, ids.contactA)}` };
    const asClientB = { authorization: `Bearer ${tokenFor(ids.portalB, ids.contactB)}` };

    const staffUpload = async (projectId, name, type, bytes) => {
      const { payload, contentType } = await multipartBody(name, type, bytes);
      const response = await app.inject({ method: 'POST', url: `/api/chat/projects/${projectId}/uploads`, payload, headers: { 'content-type': contentType } });
      assert.equal(response.statusCode, 201, response.body);
      return response.json();
    };
    const staffSend = (payload) => app.inject({ method: 'POST', url: `/api/chat/projects/${ids.projectA}/messages`, payload });

    // ── Staff: upload first, then send ────────────────────────────────────
    const internalShot = await staffUpload(ids.projectA, 'internal.png', 'image/png', PNG);
    assert.equal((await raw.attachment.findUnique({ where: { id: internalShot.id } })).entityType, 'CHAT_PENDING');
    emitted.length = 0;
    const internalResponse = await staffSend({ content: 'Internal only', attachmentIds: [internalShot.id] });
    assert.equal(internalResponse.statusCode, 201, internalResponse.body);
    const internalMessage = internalResponse.json();
    assert.equal(internalMessage.visibility, 'INTERNAL');
    assert.deepEqual(internalMessage.attachments.map((file) => file.id), [internalShot.id]);
    assert.ok(emitted.length > 0 && emitted.every((entry) => entry.room === `project:${ids.projectA}`), 'INTERNAL files never reach the client room');

    const clientShot = await staffUpload(ids.projectA, 'for-client.png', 'image/png', PNG);
    const clientVideo = await staffUpload(ids.projectA, 'walkthrough.webm', 'video/webm', WEBM);
    emitted.length = 0;
    const clientResponse = await staffSend({ content: '', visibility: 'CLIENT', attachmentIds: [clientShot.id, clientVideo.id] });
    assert.equal(clientResponse.statusCode, 201, clientResponse.body);
    const clientMessage = clientResponse.json();
    assert.equal(clientMessage.attachments.length, 2);
    const clientRoomEvent = emitted.find((entry) => entry.room === `project:${ids.projectA}:client`);
    assert.ok(clientRoomEvent, 'CLIENT message reaches the client room');
    for (const file of clientRoomEvent.payload.attachments) {
      assert.deepEqual(Object.keys(file).sort(), ['id', 'mimeType', 'name', 'size', 'url']);
      assert.match(file.url, /^\/api\/client-portal\/chat-attachments\//);
    }
    assert.ok(!JSON.stringify(clientRoomEvent.payload).includes('/uploads/'), 'no storage path reaches the client room');

    // Atomic send: a file that is no longer pending (already sent) rolls the
    // whole message back.
    const messagesBefore = await raw.chatMessage.count({ where: { projectId: ids.projectA } });
    const reused = await staffSend({ content: 'Reuse a sent file', attachmentIds: [internalShot.id] });
    assert.equal(reused.statusCode, 409, reused.body);
    assert.equal(reused.json().code, 'ATTACHMENT_NOT_PENDING');
    // Someone else's pending upload cannot be claimed either.
    const othersUpload = await staffUpload(ids.projectA, 'mine.png', 'image/png', PNG);
    currentStaff = ids.staff2;
    const stolen = await staffSend({ content: 'Not my file', attachmentIds: [othersUpload.id] });
    assert.equal(stolen.statusCode, 409, stolen.body);
    currentStaff = ids.staff;
    // Nor a pending upload of another project.
    const otherProjectUpload = await staffUpload(ids.projectB, 'other-project.png', 'image/png', PNG);
    const crossProject = await staffSend({ content: 'Wrong project', attachmentIds: [otherProjectUpload.id] });
    assert.equal(crossProject.statusCode, 409, crossProject.body);
    assert.equal(await raw.chatMessage.count({ where: { projectId: ids.projectA } }), messagesBefore, 'refused sends leave no message behind');
    assert.equal((await raw.attachment.findUnique({ where: { id: othersUpload.id } })).entityType, 'CHAT_PENDING');

    // A reply can carry files too.
    const replyFile = await staffUpload(ids.projectA, 'reply.png', 'image/png', PNG);
    const replyResponse = await staffSend({ content: 'See the reply file', parentId: internalMessage.id, attachmentIds: [replyFile.id] });
    assert.equal(replyResponse.statusCode, 201, replyResponse.body);

    // Staff list: threads and their replies carry their files (one batched query).
    const staffList = await app.inject({ method: 'GET', url: `/api/chat/projects/${ids.projectA}/messages` });
    assert.equal(staffList.statusCode, 200, staffList.body);
    const listed = new Map(staffList.json().map((message) => [message.id, message]));
    assert.equal(listed.get(internalMessage.id).attachments.length, 1);
    assert.equal(listed.get(clientMessage.id).attachments.length, 2);
    assert.deepEqual(listed.get(internalMessage.id).replies.map((reply) => reply.attachments.map((file) => file.id)), [[replyFile.id]]);

    // ── Client A: only CLIENT messages and their files ─────────────────────
    const portalList = await app.inject({ method: 'GET', url: `/api/client-portal/projects/${ids.projectA}/messages`, headers: asClientA });
    assert.equal(portalList.statusCode, 200, portalList.body);
    const portalMessages = portalList.json();
    assert.deepEqual(portalMessages.map((message) => message.id), [clientMessage.id], 'INTERNAL messages are never listed');
    assert.deepEqual(portalMessages[0].attachments.map((file) => file.id).sort(), [clientShot.id, clientVideo.id].sort());
    assert.ok(!JSON.stringify(portalMessages).includes(internalShot.id), 'INTERNAL file ids never reach the client');
    assert.ok(!JSON.stringify(portalMessages).includes('/uploads/'), 'no storage path reaches the client');

    const download = (fileId, headers) => app.inject({ method: 'GET', url: `/api/client-portal/chat-attachments/${fileId}`, headers });
    const ownFile = await download(clientShot.id, asClientA);
    assert.equal(ownFile.statusCode, 200, ownFile.body);
    assert.deepEqual(ownFile.rawPayload, PNG);
    const ranged = await app.inject({ method: 'GET', url: `/api/client-portal/chat-attachments/${clientVideo.id}`, headers: { ...asClientA, range: 'bytes=0-3' } });
    assert.equal(ranged.statusCode, 206, 'recorded video seeks with byte ranges');
    assert.equal((await download(internalShot.id, asClientA)).statusCode, 404, 'file on an INTERNAL message');
    assert.equal((await download(othersUpload.id, asClientA)).statusCode, 404, 'unsent (pending) file');
    assert.equal((await download(`missing-${suffix}`, asClientA)).statusCode, 404);
    // ── Client B: nothing of client A's project ───────────────────────────
    assert.equal((await download(clientShot.id, asClientB)).statusCode, 404, 'another client\'s file');
    assert.equal((await app.inject({ method: 'GET', url: `/api/client-portal/projects/${ids.projectA}/messages`, headers: asClientB })).statusCode, 404);
    // ── A trashed or cancelled project's files are gone from the portal too ─
    await raw.project.update({ where: { id: ids.projectA }, data: { deletedAt: new Date() } });
    assert.equal((await download(clientShot.id, asClientA)).statusCode, 404, 'file of a trashed project');
    await raw.project.update({ where: { id: ids.projectA }, data: { deletedAt: null, status: 'CANCELLED' } });
    assert.equal((await download(clientShot.id, asClientA)).statusCode, 404, 'file of a cancelled project');
    await raw.project.update({ where: { id: ids.projectA }, data: { status: 'STARTING_UP' } });
    assert.equal((await download(clientShot.id, asClientA)).statusCode, 200, 'restored project serves its files again');

    // ── Client A sends files: always CLIENT, claim is theirs only ─────────
    const clientUpload = async (projectId, headers, name, type, bytes) => {
      const { payload, contentType } = await multipartBody(name, type, bytes);
      return app.inject({ method: 'POST', url: `/api/client-portal/projects/${projectId}/chat-uploads`, payload, headers: { ...headers, 'content-type': contentType } });
    };
    assert.equal((await clientUpload(ids.projectB, asClientA, 'x.png', 'image/png', PNG)).statusCode, 404, 'no uploads to another client\'s project');
    const rejected = await clientUpload(ids.projectA, asClientA, 'fake.png', 'image/png', Buffer.from('not a png'));
    assert.equal(rejected.statusCode, 400, 'the upload policy (magic bytes) applies');
    const clientPending = await clientUpload(ids.projectA, asClientA, 'screenshot.png', 'image/png', PNG);
    assert.equal(clientPending.statusCode, 201, clientPending.body);
    const clientPendingFile = clientPending.json();
    assert.equal(clientPendingFile.url, undefined, 'a pending upload has no download URL yet');

    const claimStaffFile = await app.inject({ method: 'POST', url: `/api/client-portal/projects/${ids.projectA}/messages`, headers: asClientA, payload: { content: 'x', attachmentIds: [othersUpload.id] } });
    assert.equal(claimStaffFile.statusCode, 409, 'a client cannot claim a staff member\'s pending upload');

    emitted.length = 0;
    const clientSend = await app.inject({ method: 'POST', url: `/api/client-portal/projects/${ids.projectA}/messages`, headers: asClientA, payload: { content: '', attachmentIds: [clientPendingFile.id] } });
    assert.equal(clientSend.statusCode, 201, clientSend.body);
    const clientSent = clientSend.json();
    assert.equal(clientSent.visibility, 'CLIENT');
    assert.deepEqual(clientSent.attachments.map((file) => file.id), [clientPendingFile.id]);
    const staffEvent = emitted.find((entry) => entry.room === `project:${ids.projectA}`);
    assert.equal(staffEvent.payload.attachments[0].id, clientPendingFile.id, 'staff see the client\'s file in realtime');
    assert.equal((await download(clientPendingFile.id, asClientA)).statusCode, 200);
    assert.equal((await download(clientPendingFile.id, asClientB)).statusCode, 404);

    // ── Deleting a message removes its files ──────────────────────────────
    const deleted = await app.inject({ method: 'DELETE', url: `/api/chat/projects/${ids.projectA}/messages/${clientMessage.id}` });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal(await raw.attachment.count({ where: { id: { in: [clientShot.id, clientVideo.id] } } }), 0);
    assert.equal((await download(clientShot.id, asClientA)).statusCode, 404);

    // ── Pending purge: only unsent uploads older than 24 hours ────────────
    await raw.attachment.update({ where: { id: othersUpload.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    const staleRow = await raw.attachment.findUnique({ where: { id: othersUpload.id } });
    const purge = await purgeStalePendingChatUploads(raw);
    assert.ok(purge.purged >= 1, JSON.stringify(purge));
    assert.equal(await raw.attachment.findUnique({ where: { id: othersUpload.id } }), null, 'stale pending upload purged');
    await assert.rejects(fs.access(path.join(UPLOAD_DIR, staleRow.filename)), 'its bytes are removed');
    assert.ok(await raw.attachment.findUnique({ where: { id: otherProjectUpload.id } }), 'a fresh pending upload is kept');
    assert.ok(await raw.attachment.findUnique({ where: { id: internalShot.id } }), 'sent files are never purged');
  } finally {
    await app?.close();
    const files = await raw.attachment.findMany({ where: { organizationId: ids.org }, select: { filename: true } });
    await Promise.all(files.map((file) => fs.rm(path.join(UPLOAD_DIR, file.filename), { force: true })));
    await raw.attachment.deleteMany({ where: { organizationId: ids.org } });
    await raw.chatMessage.deleteMany({ where: { projectId: { in: [ids.projectA, ids.projectB] }, parentId: { not: null } } });
    await raw.chatMessage.deleteMany({ where: { projectId: { in: [ids.projectA, ids.projectB] } } });
    await raw.activity.deleteMany({ where: { projectId: { in: [ids.projectA, ids.projectB] } } });
    await raw.project.deleteMany({ where: { id: { in: [ids.projectA, ids.projectB] } } });
    await raw.contact.deleteMany({ where: { id: { in: [ids.contactA, ids.contactB] } } });
    await raw.user.deleteMany({ where: { id: { in: [ids.staff, ids.staff2, ids.portalA, ids.portalB] } } });
    await raw.client.deleteMany({ where: { id: { in: [ids.clientA, ids.clientB] } } });
    await purgeFixtureAuditEvents(raw, { ids: [ids.org] });
    await raw.organization.deleteMany({ where: { id: ids.org } });
    await raw.$disconnect();
  }
});
