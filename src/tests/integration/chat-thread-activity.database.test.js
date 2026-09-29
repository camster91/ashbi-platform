import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import chatRoutes from '../../routes/chat.routes.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

// Chat threads are one level deep and paged by latest activity (Codex P2 on
// #480): a thread with a new reply stays visible even when its first message
// is older than the page, a reply to a reply joins its thread, and the
// visibility migration flattens replies that were nested before.
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

function scopedFlatten() {
  const sql = readFileSync(new URL('../../../prisma/migrations/20260927030000_chat_message_visibility/migration.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('WITH RECURSIVE chain AS');
  const statement = sql.slice(start, sql.indexOf(';', start));
  assert.match(statement, /WHERE m\."id" = c\."id"/);
  return statement.replace('WHERE m."id" = c."id"', 'WHERE m."projectId" = $1 AND m."id" = c."id"');
}

test('threads are one level deep and ordered by latest activity', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const s = randomUUID();
  const ids = { org: `thr-org-${s}`, client: `thr-client-${s}`, project: `thr-project-${s}`, user: `thr-user-${s}` };
  let app;
  try {
    await raw.organization.create({ data: { id: ids.org, name: 'Threads', slug: `thr-${s}` } });
    await raw.client.create({ data: { id: ids.client, name: 'Thread client', organizationId: ids.org } });
    await raw.project.create({ data: { id: ids.project, name: 'Thread project', clientId: ids.client, organizationId: ids.org } });
    await raw.user.create({ data: { id: ids.user, email: `${ids.user}@example.com`, name: 'Staff', password: 'x', role: 'TEAM', organizationId: ids.org } });

    // Message ids stay within the API's 50-character id limit.
  const mid = (id) => `m${s.slice(0, 8)}-${id}`;
  const at = (minutes) => new Date(Date.UTC(2026, 8, 1, 12, minutes));
    const message = (id, minutes, extra = {}) => raw.chatMessage.create({ data: {
      id: mid(id), content: id, projectId: ids.project, authorId: ids.user, createdAt: at(minutes), ...extra,
    } });
    await message('old-thread', 0);
    await message('middle', 1);
    await message('newest', 2);
    await message('late-reply', 3, { parentId: mid('old-thread') });

    app = Fastify();
    app.decorate('authenticate', async (request) => { request.user = { id: ids.user, name: 'Staff', organizationId: ids.org, role: 'TEAM' }; });
    app.decorate('notify', async () => {});
    app.decorate('io', { to: () => ({ emit: () => {} }) });
    const scoped = createScopedPrisma(raw, ids.org);
    app.addHook('onRequest', async (request) => { request.prisma = scoped; });
    await app.register(chatRoutes, { prefix: '/api' });

    // Page of 2 by activity: the late reply brings its old thread back.
    const page = await app.inject({ method: 'GET', url: `/api/projects/${ids.project}/messages?limit=2` });
    assert.equal(page.statusCode, 200, page.body);
    const threads = page.json();
    assert.deepEqual(threads.map((t) => t.content), ['newest', 'old-thread']);
    assert.deepEqual(threads[1].replies.map((r) => r.content), ['late-reply']);

    // Several newest messages in one thread still yield `limit` distinct threads.
    await message('burst-1', 4, { parentId: mid('old-thread') });
    await message('burst-2', 5, { parentId: mid('old-thread') });
    const distinct = (await app.inject({ method: 'GET', url: `/api/projects/${ids.project}/messages?limit=2` })).json();
    assert.deepEqual(distinct.map((t) => t.content), ['newest', 'old-thread'], 'two threads, not one');

    // A reply to a reply joins the thread (one level).
    const nested = await app.inject({
      method: 'POST', url: `/api/projects/${ids.project}/messages`,
      payload: { content: 'reply to the reply', parentId: mid('late-reply') },
    });
    assert.equal(nested.statusCode, 201, nested.body);
    assert.equal(nested.json().parentId, mid('old-thread'));

    // Data nested before this release is flattened by the migration.
    await message('legacy-root', 10);
    await message('legacy-child', 11, { parentId: mid('legacy-root') });
    await message('legacy-grandchild', 12, { parentId: mid('legacy-child') });
    await raw.$executeRawUnsafe(scopedFlatten(), ids.project);
    const grandchild = await raw.chatMessage.findUnique({ where: { id: mid('legacy-grandchild') } });
    assert.equal(grandchild.parentId, mid('legacy-root'));
    const history = (await app.inject({ method: 'GET', url: `/api/projects/${ids.project}/messages` })).json();
    const legacy = history.find((t) => t.content === 'legacy-root');
    assert.deepEqual(legacy.replies.map((r) => r.content), ['legacy-child', 'legacy-grandchild'], 'no reply is unreachable');
  } finally {
    await app?.close();
    await raw.chatMessage.updateMany({ where: { projectId: ids.project }, data: { parentId: null } });
    await raw.chatMessage.deleteMany({ where: { projectId: ids.project } });
    await raw.activity.deleteMany({ where: { projectId: ids.project } });
    await raw.project.deleteMany({ where: { id: ids.project } });
    await raw.user.deleteMany({ where: { id: ids.user } });
    await raw.client.deleteMany({ where: { id: ids.client } });
    await purgeFixtureAuditEvents(raw, { ids: [ids.org] });
    await raw.organization.deleteMany({ where: { id: ids.org } });
    await raw.$disconnect();
  }
});
