import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import chatRoutes from '../../routes/chat.routes.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

// Project chat against a real PostgreSQL schema (built with
// `prisma migrate deploy`): the self-referencing reply FK is ON DELETE NO
// ACTION, so deleting a message that has replies used to fail with a 500
// (M2). It now leaves a tombstone; listing returns top-level messages with
// replies nested; visibility defaults to INTERNAL at the database level (C3).
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('chat delete keeps threads intact and lists top-level messages with nested replies', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    org: `chat-org-${suffix}`, client: `chat-client-${suffix}`, project: `chat-project-${suffix}`,
    author: `chat-author-${suffix}`, other: `chat-other-${suffix}`,
  };
  let app;
  try {
    await raw.organization.create({ data: { id: ids.org, name: 'Chat tenant', slug: `chat-${suffix}` } });
    await raw.client.create({ data: { id: ids.client, name: 'Chat client', organizationId: ids.org } });
    await raw.project.create({ data: { id: ids.project, name: 'Chat project', clientId: ids.client, organizationId: ids.org } });
    await raw.user.createMany({ data: [
      { id: ids.author, email: `author-${suffix}@example.com`, name: `Author${suffix.slice(0, 6)}`, password: 'x', role: 'TEAM', organizationId: ids.org },
      { id: ids.other, email: `other-${suffix}@example.com`, name: `Other${suffix.slice(0, 6)}`, password: 'x', role: 'TEAM', organizationId: ids.org },
    ] });

    let currentUser = ids.author;
    const emitted = [];
    app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.user = { id: currentUser, name: 'Tester', organizationId: ids.org, role: 'TEAM' };
    });
    app.decorate('notify', async () => {});
    app.decorate('io', { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) });
    const scoped = createScopedPrisma(raw, ids.org);
    app.addHook('onRequest', async (request) => { request.prisma = scoped; });
    await app.register(chatRoutes, { prefix: '/api' });

    const post = async (payload) => {
      const response = await app.inject({ method: 'POST', url: `/api/projects/${ids.project}/messages`, payload });
      assert.equal(response.statusCode, 201, response.body);
      return response.json();
    };

    const root = await post({ content: 'Root message' });
    assert.equal(root.visibility, 'INTERNAL', 'database default is INTERNAL');
    currentUser = ids.other;
    const replyMessage = await post({ content: 'A reply from someone else', parentId: root.id });
    currentUser = ids.author;
    const lonely = await post({ content: 'No replies here' });

    // A reply under a client-visible message keeps its own (default INTERNAL)
    // visibility and is not part of the client's conversation.
    const clientRoot = await post({ content: 'Hi Dana', visibility: 'CLIENT' });
    const aside = await post({ content: 'Internal aside', parentId: clientRoot.id });
    assert.equal(aside.visibility, 'INTERNAL');
    const portalRows = await raw.chatMessage.findMany({ where: { projectId: ids.project, visibility: 'CLIENT', removedAt: null } });
    assert.deepEqual(portalRows.map((row) => row.id), [clientRoot.id]);
    await raw.chatMessage.delete({ where: { id: aside.id } });
    await raw.chatMessage.delete({ where: { id: clientRoot.id } });
    emitted.length = 0;

    const listed = await app.inject({ method: 'GET', url: `/api/projects/${ids.project}/messages` });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.deepEqual(listed.json().map((message) => message.id), [root.id, lonely.id], 'replies are not listed top-level');
    assert.deepEqual(listed.json()[0].replies.map((message) => message.id), [replyMessage.id]);

    const deletedRoot = await app.inject({ method: 'DELETE', url: `/api/projects/${ids.project}/messages/${root.id}` });
    assert.equal(deletedRoot.statusCode, 200, deletedRoot.body);
    assert.equal(deletedRoot.json().tombstoned, true);
    const tomb = await raw.chatMessage.findUnique({ where: { id: root.id } });
    assert.ok(tomb.removedAt);
    assert.equal(tomb.content, '');
    assert.ok(await raw.chatMessage.findUnique({ where: { id: replyMessage.id } }), 'other people\'s replies survive');

    const deletedLonely = await app.inject({ method: 'DELETE', url: `/api/projects/${ids.project}/messages/${lonely.id}` });
    assert.equal(deletedLonely.statusCode, 200, deletedLonely.body);
    assert.equal(await raw.chatMessage.findUnique({ where: { id: lonely.id } }), null);

    const again = await app.inject({ method: 'DELETE', url: `/api/projects/${ids.project}/messages/${root.id}` });
    assert.equal(again.statusCode, 404);

    const afterDelete = await app.inject({ method: 'GET', url: `/api/projects/${ids.project}/messages?limit=abc` });
    assert.equal(afterDelete.statusCode, 400);
    const page = await app.inject({ method: 'GET', url: `/api/projects/${ids.project}/messages?limit=1000` });
    assert.equal(page.statusCode, 200);
    assert.deepEqual(page.json().map((message) => [message.id, message.content]), [[root.id, '']]);

    assert.ok(emitted.every((entry) => entry.room === `project:${ids.project}`), 'internal chat never reaches the client room');
  } finally {
    await app?.close();
    await raw.chatMessage.deleteMany({ where: { projectId: ids.project, parentId: { not: null } } });
    await raw.chatMessage.deleteMany({ where: { projectId: ids.project } });
    await raw.activity.deleteMany({ where: { projectId: ids.project } });
    await raw.project.deleteMany({ where: { id: ids.project } });
    await raw.user.deleteMany({ where: { id: { in: [ids.author, ids.other] } } });
    await raw.client.deleteMany({ where: { id: ids.client } });
    await purgeFixtureAuditEvents(raw, { ids: [ids.org] });
    await raw.organization.deleteMany({ where: { id: ids.org } });
    await raw.$disconnect();
  }
});
