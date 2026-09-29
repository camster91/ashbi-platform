// Chat media (docs/chat-media.md): pending uploads, atomic claims, batched
// attachment loading and the 24-hour purge of unsent uploads.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import chatRoutes from '../../routes/chat.routes.js';
import {
  CHAT_PENDING_ENTITY,
  ChatAttachmentError,
  MAX_CHAT_ATTACHMENTS,
  PENDING_CHAT_UPLOAD_TTL_MS,
  claimPendingChatAttachments,
  loadChatAttachments,
  normaliseAttachmentIds,
  purgeStalePendingChatUploads,
  toStaffAttachmentPayload,
} from '../../services/chat-attachment.service.js';
import { purgePendingChatUploads } from '../../jobs/chat-upload-cleanup.js';
import { chatMessageCreateSchema, clientPortalMessageSchema } from '../../validators/schemas.js';

const STAFF = { id: 'c123456789012345678901234', name: 'Avery', organizationId: 'org-a', role: 'TEAM' };
const PROJECT = 'c123456789012345678901235';

test('message schemas accept files without text, and cap attachments at 10', () => {
  assert.equal(chatMessageCreateSchema.safeParse({ content: '' }).success, false, 'empty message');
  assert.equal(chatMessageCreateSchema.safeParse({ content: '   ' }).success, false, 'whitespace only');
  assert.equal(chatMessageCreateSchema.safeParse({ attachmentIds: ['a1'] }).success, true, 'files only');
  assert.equal(chatMessageCreateSchema.safeParse({ content: 'hi' }).success, true);
  const eleven = Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, (_, i) => `a${i}`);
  assert.equal(chatMessageCreateSchema.safeParse({ content: 'hi', attachmentIds: eleven }).success, false);
  assert.equal(clientPortalMessageSchema.safeParse({ content: '' }).success, false);
  assert.equal(clientPortalMessageSchema.safeParse({ attachmentIds: ['a1'] }).success, true);
  assert.equal(clientPortalMessageSchema.safeParse({ content: 'hi', attachmentIds: eleven }).success, false);
  // A portal message cannot choose its visibility.
  assert.equal('visibility' in clientPortalMessageSchema.parse({ content: 'hi', visibility: 'INTERNAL' }), false);
});

test('attachment ids are de-duplicated and capped', () => {
  assert.deepEqual(normaliseAttachmentIds(undefined), []);
  assert.deepEqual(normaliseAttachmentIds(['a', 'a', 'b', '', 3]), ['a', 'b']);
  assert.throws(
    () => normaliseAttachmentIds(Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, (_, i) => `id-${i}`)),
    (err) => err instanceof ChatAttachmentError && err.statusCode === 400,
  );
});

test('a claim only takes pending uploads of this uploader and project, all or nothing', async () => {
  const calls = [];
  const tx = { attachment: { updateMany: async (args) => { calls.push(args); return { count: 1 }; } } };
  await assert.rejects(
    claimPendingChatAttachments(tx, { attachmentIds: ['a1', 'a2'], projectId: 'p1', uploadedById: 'u1', messageId: 'm1' }),
    (err) => err instanceof ChatAttachmentError && err.statusCode === 409 && err.code === 'ATTACHMENT_NOT_PENDING',
  );
  assert.deepEqual(calls[0].where, { id: { in: ['a1', 'a2'] }, entityType: CHAT_PENDING_ENTITY, entityId: 'p1', uploadedById: 'u1' });
  assert.deepEqual(calls[0].data, { entityType: 'CHAT', entityId: 'm1' });
  assert.equal(await claimPendingChatAttachments(tx, { attachmentIds: [], projectId: 'p1', uploadedById: 'u1', messageId: 'm1' }), 0);
  assert.equal(calls.length, 1, 'no query for a message without files');
});

test('attachments of a whole page load in one query, grouped by message', async () => {
  const queries = [];
  const prisma = {
    attachment: {
      findMany: async (args) => {
        queries.push(args);
        return [
          { id: 'f1', entityId: 'm1', filename: 'x.png' },
          { id: 'f2', entityId: 'm2', filename: 'y.png' },
          { id: 'f3', entityId: 'm1', filename: 'z.png' },
        ];
      },
    },
  };
  const byMessage = await loadChatAttachments(prisma, ['m1', 'm2', 'm1', 'm3']);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].where, { entityType: 'CHAT', entityId: { in: ['m1', 'm2', 'm3'] } });
  assert.deepEqual(byMessage.get('m1').map((file) => file.id), ['f1', 'f3']);
  assert.equal(byMessage.has('m3'), false);
  assert.equal((await loadChatAttachments(prisma, [])).size, 0);
  assert.equal(queries.length, 1, 'an empty page does not query');
});

test('the staff message list batch-loads files for messages and replies (no per-message requests)', async () => {
  const attachmentQueries = [];
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = STAFF; });
  const threads = [
    { id: 'm2', content: 'second', metadata: null, replies: [{ id: 'r1', parentId: 'm2', content: 'reply', metadata: null }] },
    { id: 'm1', content: 'first', metadata: null, replies: [] },
    { id: 'm0', content: '', metadata: null, removedAt: new Date(), replies: [] },
  ];
  // Newest activity first: the reply r1 is the latest, then m1, then m0.
  const activity = [
    { id: 'r1', parentId: 'm2', createdAt: new Date('2026-09-29T10:03:00Z') },
    { id: 'm2', parentId: null, createdAt: new Date('2026-09-29T10:02:30Z') },
    { id: 'm1', parentId: null, createdAt: new Date('2026-09-29T10:02:00Z') },
    { id: 'm0', parentId: null, createdAt: new Date('2026-09-29T10:01:00Z') },
  ];
  const prisma = {
    project: { findFirst: async () => ({ id: PROJECT }) },
    // The grouped activity query returns thread roots, newest activity first.
    $queryRaw: async () => {
      const latest = new Map();
      for (const row of activity) if (!latest.has(row.parentId ?? row.id)) latest.set(row.parentId ?? row.id, row.createdAt);
      return [...latest].map(([rootId, lastActivityAt]) => ({ rootId, lastActivityAt }));
    },
    chatMessage: {
      findMany: async (args) => threads.filter((thread) => args.where.id.in.includes(thread.id)),
    },
    attachment: {
      findMany: async (args) => {
        attachmentQueries.push(args);
        return [
          { id: 'f1', entityId: 'm1', filename: 'a.png', originalName: 'a.png', mimeType: 'image/png', size: 3, path: '/uploads/a.png' },
          { id: 'f2', entityId: 'r1', filename: 'b.webm', originalName: 'b.webm', mimeType: 'video/webm', size: 4, path: '/uploads/b.webm' },
          { id: 'f3', entityId: 'm0', filename: 'c.png', originalName: 'c.png', mimeType: 'image/png', size: 5, path: '/uploads/c.png' },
        ];
      },
    },
  };
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(chatRoutes, { prefix: '/api' });
  try {
    const response = await app.inject({ method: 'GET', url: `/api/projects/${PROJECT}/messages` });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(attachmentQueries.length, 1, 'one attachment query per page');
    assert.deepEqual(attachmentQueries[0].where.entityId.in.sort(), ['m0', 'm1', 'm2', 'r1']);
    const [removed, first, second] = response.json(); // oldest activity first
    assert.deepEqual(first.attachments.map((file) => file.url), ['/api/attachments/uploads/a.png']);
    assert.deepEqual(second.attachments, []);
    assert.equal(second.replies[0].attachments[0].id, 'f2');
    assert.deepEqual(removed.attachments, [], 'a deleted message shows no files');
    assert.equal(second.lastActivityAt, '2026-09-29T10:03:00.000Z', 'thread activity survives the attachment load');
  } finally {
    await app.close();
  }
});

test('a refused claim leaves no activity or realtime event behind', async () => {
  const events = [];
  const activities = [];
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = STAFF; });
  app.decorate('notify', async () => {});
  app.decorate('io', { to: (room) => ({ emit: (event) => events.push({ room, event }) }) });
  const prisma = {
    project: { findFirst: async () => ({ id: PROJECT, clientId: 'client-a' }) },
    chatMessage: { create: async ({ data }) => ({ id: 'm-new', ...data, author: STAFF, reactions: [], replies: [] }) },
    attachment: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
    activity: { create: async ({ data }) => activities.push(data) },
    user: { findMany: async () => [] },
  };
  prisma.$transaction = async (work) => work(prisma);
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(chatRoutes, { prefix: '/api' });
  try {
    const response = await app.inject({ method: 'POST', url: `/api/projects/${PROJECT}/messages`, payload: { content: 'with file', attachmentIds: ['gone'] } });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().code, 'ATTACHMENT_NOT_PENDING');
    assert.deepEqual(events, []);
    assert.deepEqual(activities, []);
  } finally {
    await app.close();
  }
});

test('pending uploads go through the upload policy and are capped per uploader', async () => {
  const created = [];
  let pendingCount = 0;
  const app = Fastify();
  await app.register(multipart);
  app.decorate('authenticate', async (request) => { request.user = STAFF; });
  const prisma = {
    project: { findFirst: async ({ where }) => (where.id === PROJECT ? { id: PROJECT, organizationId: 'org-a' } : null) },
    attachment: {
      count: async () => pendingCount,
      create: async ({ data }) => { created.push(data); return { id: 'att-1', createdAt: new Date(), ...data }; },
    },
  };
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(chatRoutes, { prefix: '/api' });
  const upload = async (bytes, name = 'shot.png', type = 'image/png', projectId = PROJECT) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    const encoded = new Request('http://localhost/', { method: 'POST', body: form });
    return app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/uploads`,
      payload: Buffer.from(await encoded.arrayBuffer()),
      headers: { 'content-type': encoded.headers.get('content-type') },
    });
  };
  try {
    assert.equal((await upload(Buffer.from('not really a png'))).statusCode, 400, 'magic bytes are checked');
    assert.equal((await upload(Buffer.from([0x89, 0x50]), 'x.exe', 'application/octet-stream')).statusCode, 400);
    assert.equal((await upload(Buffer.from('x'), 'a.png', 'image/png', 'c999999999999999999999999')).statusCode, 404);
    assert.equal(created.length, 0);
    pendingCount = 30;
    const capped = await upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
    assert.equal(capped.statusCode, 409);
    assert.equal(capped.json().code, 'TOO_MANY_PENDING_UPLOADS');
    assert.equal(created.length, 0);
  } finally {
    await app.close();
  }
});

test('the purge deletes only stale pending uploads, row before bytes, and keeps failures for retry', async () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const rows = [
    { id: 'stale', path: '/uploads/stale.png', entityType: CHAT_PENDING_ENTITY, createdAt: new Date(now.getTime() - PENDING_CHAT_UPLOAD_TTL_MS - 1) },
    { id: 'claimed-meanwhile', path: '/uploads/claimed.png', entityType: CHAT_PENDING_ENTITY, createdAt: new Date(now.getTime() - PENDING_CHAT_UPLOAD_TTL_MS - 2) },
    { id: 'locked', path: '/uploads/locked.png', entityType: CHAT_PENDING_ENTITY, createdAt: new Date(now.getTime() - PENDING_CHAT_UPLOAD_TTL_MS - 3) },
  ];
  const findArgs = [];
  const unlinked = [];
  const prisma = {
    attachment: {
      findMany: async (args) => { findArgs.push(args); return rows; },
      deleteMany: async ({ where }) => {
        assert.equal(where.entityType, CHAT_PENDING_ENTITY, 'only still-pending rows are deleted');
        if (where.id === 'claimed-meanwhile') return { count: 0 };
        if (where.id === 'locked') throw new Error('foreign key');
        return { count: 1 };
      },
    },
  };
  const result = await purgeStalePendingChatUploads(prisma, { now, unlink: async (p) => unlinked.push(p) });
  assert.deepEqual(findArgs[0].where, { entityType: CHAT_PENDING_ENTITY, createdAt: { lt: new Date(now.getTime() - PENDING_CHAT_UPLOAD_TTL_MS) } });
  assert.deepEqual(unlinked, ['/uploads/stale.png'], 'a file claimed meanwhile, or whose row could not be deleted, stays on disk');
  assert.deepEqual({ examined: result.examined, purged: result.purged, failed: result.failed }, { examined: 3, purged: 1, failed: 1 });
  await assert.rejects(purgePendingChatUploads(prisma, { now, unlink: async () => {} }), /retained for retry/);
});

test('staff attachment payload points at the authenticated download route', () => {
  const payload = toStaffAttachmentPayload({ id: 'f1', filename: 'u 1.png', originalName: 'shot.png', mimeType: 'image/png', size: 1, path: '/uploads/quarantine/u 1.png' });
  assert.equal(payload.url, '/api/attachments/uploads/u%201.png');
  assert.equal(payload.quarantined, true);
});
