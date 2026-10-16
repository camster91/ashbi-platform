import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { createWorkspaceChatChannel, postWorkspaceChatMessage, setWorkspaceChatMember, acknowledgeWorkspaceChatAttention, listWorkspaceChatAttentionForQueue } from '../../services/workspace-chat.service.js';
import { WORK_QUEUE_SOURCES, buildWorkQueue } from '../../services/work-queue.service.js';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('PostgreSQL own queue attention enforces current audience, canonical filters before cap and truthful counts', { skip: !url && 'Disposable database is not configured', timeout: 150_000 }, async () => {
  assertDisposableDatabase({ NODE_ENV: 'test', DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const organizations = [], source = WORK_QUEUE_SOURCES.find(row => row.key === 'workspace_chat_attention');
  try {
    for (let i = 0; i < 2; i++) organizations.push(await raw.organization.create({ data: { name: 'Attention queue fixture', slug: `attention-queue-${randomUUID()}` } }));
    const org = organizations[0].id;
    const user = (organizationId, role) => raw.user.create({ data: { organizationId, role, name: 'Queue fixture', email: `${randomUUID()}@e2e.example.test`, password: randomUUID() } });
    const admin = await user(org, 'ADMIN'), team = await user(org, 'TEAM'), other = await user(org, 'ADMIN'), foreign = await user(organizations[1].id, 'TEAM');
    const clients = [], projects = [];
    for (let i = 0; i < 2; i++) { clients.push(await raw.client.create({ data: { organizationId: org, name: `Client ${i}` } }));projects.push(await raw.project.create({ data: { organizationId: org, clientId: clients[i].id, name: `Project ${i}` } })); }
    const first = (await createWorkspaceChatChannel(raw, admin, { kind: 'PROJECT', name: 'PRIVATE CHANNEL TITLE', projectId: projects[0].id, memberIds: [team.id] })).channel;
    const second = (await createWorkspaceChatChannel(raw, admin, { kind: 'PROJECT', name: 'Other project', projectId: projects[1].id, memberIds: [team.id] })).channel;
    const direct = (await createWorkspaceChatChannel(raw, admin, { kind: 'DIRECT', memberIds: [team.id] })).channel;
    for (const room of [first, second, direct]) await postWorkspaceChatMessage(raw, admin, room.id, { content: 'PRIVATE MESSAGE BODY', idempotencyKey: randomUUID(), attentionRecipientIds: [team.id] });
    const db = createScopedPrisma(raw, org);
    const queue = (actor = team, filters = {}) => buildWorkQueue(db, { user: actor, filters, sources: [source] });
    assert.equal((await queue()).total, 3);assert.equal((await queue(team, { owner: 'everyone' })).total, 3);assert.equal((await queue(team, { owner: 'me' })).total, 3);
    assert.equal((await queue(admin)).total, 0);assert.equal((await queue(other)).total, 0);
    assert.equal((await listWorkspaceChatAttentionForQueue(raw, foreign)).items.length, 0);
    const filtered = await queue(team, { clientId: clients[0].id, projectId: projects[0].id });assert.equal(filtered.total, 1);
    assert.equal((await queue(team, { clientId: clients[1].id, projectId: projects[0].id })).total, 0);
    assert.doesNotMatch(JSON.stringify(filtered), /PRIVATE MESSAGE BODY|PRIVATE CHANNEL TITLE|intentHash|messageId/);
    assert.equal(filtered.rows[0].sourceUrl, '/messages');
    await setWorkspaceChatMember(raw, admin, first.id, team.id, false);assert.equal((await queue()).total, 2);
    await setWorkspaceChatMember(raw, admin, first.id, team.id, true);assert.equal((await queue()).total, 3);
    await raw.workspaceChatChannel.update({ where: { id: first.id }, data: { archivedAt: new Date() } });assert.equal((await queue()).total, 2);
    await raw.workspaceChatChannel.update({ where: { id: first.id }, data: { archivedAt: null } });
    await raw.project.update({ where: { id: projects[0].id }, data: { clientId: clients[1].id } });assert.equal((await queue()).total, 2);
    await raw.project.update({ where: { id: projects[0].id }, data: { clientId: clients[0].id } });
    await raw.client.update({ where: { id: clients[0].id }, data: { deletedAt: new Date() } });assert.equal((await queue()).total, 2);
    await raw.client.update({ where: { id: clients[0].id }, data: { deletedAt: null } });
    // Actor revocation after the preliminary Prisma authority read is also
    // enforced by the SQL statement itself, before a row/count can escape.
    const revokedBetweenReads = { user: raw.user, $queryRaw: async (...args) => { await raw.user.update({ where: { id: team.id }, data: { isActive: false } });return raw.$queryRaw(...args); } };
    assert.equal((await listWorkspaceChatAttentionForQueue(revokedBetweenReads, team)).items.length, 0);
    await raw.user.update({ where: { id: team.id }, data: { isActive: true, role: 'CLIENT' } });
    await assert.rejects(listWorkspaceChatAttentionForQueue(raw, team), { code: 'ROLE_DENIED' });
    await raw.user.update({ where: { id: team.id }, data: { role: 'TEAM' } });
    const pending = (await queue(team, { projectId: projects[0].id })).rows[0];
    await acknowledgeWorkspaceChatAttention(db, team, first.id, pending.id);assert.equal((await queue(team, { projectId: projects[0].id })).total, 0);
    // A larger unrelated/direct cohort sorts before the requested project;
    // filter before LIMIT must still return its entire 100+1 sentinel page.
    async function batch(room, prefix, count) {
      const rows = Array.from({ length: count }, (_, i) => ({ messageId: `${prefix}-m-${i}-${randomUUID()}`, attentionId: `${prefix}-a-${String(i).padStart(3, '0')}-${randomUUID()}` }));
      await raw.$transaction(async tx => {
        await tx.workspaceChatMessage.createMany({ data: rows.map(row => ({ id: row.messageId, organizationId: org, channelId: room.id, authorId: admin.id, content: 'PRIVATE BULK BODY', attentionRecipientIds: [team.id], intentHash: 'a'.repeat(64) })) });
        await tx.workspaceChatAttention.createMany({ data: rows.map(row => ({ id: row.attentionId, organizationId: org, channelId: room.id, messageId: row.messageId, recipientId: team.id })) });
      });return rows;
    }
    await batch(direct, 'aaa-unrelated', 105);
    const own = await batch(first, 'zzz-filtered', 101);
    const capped = await queue(team, { projectId: projects[0].id });assert.equal(capped.total, 100);assert.equal(capped.counts.needs_action, 100);assert.deepEqual(capped.truncatedSources, ['workspace_chat_attention']);assert.equal(capped.partial, false);
    assert.ok(capped.rows.every(row => row.project.id === projects[0].id));
    await raw.workspaceChatAttention.update({ where: { id: own[0].attentionId }, data: { acknowledgedAt: new Date() } });
    const exact = await queue(team, { projectId: projects[0].id });assert.equal(exact.total, 100);assert.deepEqual(exact.truncatedSources, []);
  } finally {
    const ids = organizations.map(row => row.id);
    if (ids.length) {
      await raw.workspaceChatMessage.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.workspaceChatMember.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.workspaceChatChannel.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.project.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.client.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.user.deleteMany({ where: { organizationId: { in: ids } } });
      if (await purgeFixtureAuditEvents(raw, { ids })) await raw.organization.deleteMany({ where: { id: { in: ids } } });
    }
    await raw.$disconnect();
  }
});
