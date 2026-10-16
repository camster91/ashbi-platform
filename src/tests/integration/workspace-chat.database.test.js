import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  createWorkspaceChatChannel, listWorkspaceChatChannels, getWorkspaceChatMessages,
  postWorkspaceChatMessage, setWorkspaceChatMember,
  listWorkspaceChatAttention, acknowledgeWorkspaceChatAttention, getWorkspaceChatMessageIntent,
} from '../../services/workspace-chat.service.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('workspace chat PostgreSQL tenant, membership, linkage, concurrent replay and fresh role boundaries', { skip: !url && 'Disposable database is not configured', timeout: 150_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `chat-${key}-${randomUUID()}`);
  const users = [], clients = [], projects = [];
  try {
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Workspace chat fixture' } });
      users.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Chat admin', password: randomUUID(), role: 'ADMIN' } }));
      clients.push(await raw.client.create({ data: { organizationId, name: 'Chat client' } }));
      projects.push(await raw.project.create({ data: { organizationId, clientId: clients.at(-1).id, name: 'Chat project' } }));
    }
    const teammate = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Chat team', password: randomUUID(), role: 'TEAM' } });
    const otherAdmin = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Other admin', password: randomUUID(), role: 'ADMIN' } });
    const dmInputs = [{ kind: 'DIRECT', memberIds: [teammate.id] }, { kind: 'DIRECT', memberIds: [users[0].id] }];
    const dmResults = await Promise.all([createWorkspaceChatChannel(raw, users[0], dmInputs[0]), createWorkspaceChatChannel(raw, teammate, dmInputs[1])]);
    const dm = dmResults[0].channel;
    assert.equal(dm.id, dmResults[1].channel.id);
    assert.equal(await raw.workspaceChatChannel.count({ where: { organizationId: orgs[0], kind: 'DIRECT' } }), 1);
    await assert.rejects(getWorkspaceChatMessages(raw, otherAdmin, dm.id), { statusCode: 404 });
    await assert.rejects(getWorkspaceChatMessages(raw, users[1], dm.id), { statusCode: 404 });
    await assert.rejects(createWorkspaceChatChannel(raw, users[0], { kind: 'DIRECT', memberIds: [users[1].id] }), { statusCode: 400 });
    await assert.rejects(setWorkspaceChatMember(raw, users[0], dm.id, otherAdmin.id, true), { statusCode: 409 });
    const channel = (await createWorkspaceChatChannel(raw, users[0], { kind: 'PROJECT', name: 'Project discussion', projectId: projects[0].id, memberIds: [teammate.id] })).channel;
    assert.equal(channel.clientId, clients[0].id);
    await assert.rejects(createWorkspaceChatChannel(raw, users[0], { kind: 'PROJECT', name: 'Foreign', projectId: projects[1].id }), { statusCode: 404 });
    await assert.rejects(raw.workspaceChatChannel.create({ data: { organizationId: orgs[0], kind: 'PROJECT', name: 'Bad binding', clientId: clients[1].id, projectId: projects[0].id, createdById: users[0].id } }));
    await assert.rejects(raw.workspaceChatMember.create({ data: { organizationId: orgs[0], channelId: channel.id, userId: users[1].id } }));
    await assert.rejects(raw.workspaceChatMessage.create({ data: { organizationId: orgs[0], channelId: channel.id, authorId: otherAdmin.id, content: 'Not a member' } }));
    const input = { content: 'One persisted message', idempotencyKey: randomUUID(), attentionRecipientIds: [teammate.id] };
    const posts = await Promise.all([postWorkspaceChatMessage(raw, users[0], channel.id, input), postWorkspaceChatMessage(raw, users[0], channel.id, input)]);
    assert.equal(posts[0].message.id, posts[1].message.id);
    assert.equal(posts.filter(p => p.duplicate).length, 1);
    assert.equal(await raw.workspaceChatMessage.count({ where: { channelId: channel.id } }), 1);
    assert.equal(await raw.workspaceChatAttention.count({ where: { channelId: channel.id } }), 1);
    assert.equal((await listWorkspaceChatAttention(raw, teammate)).items.length, 1);
    assert.equal((await listWorkspaceChatAttention(raw, otherAdmin)).items.length, 0);
    assert.equal((await listWorkspaceChatAttention(raw, users[1])).items.length, 0);
    const attention = posts[0].message.attention[0];
    await assert.rejects(acknowledgeWorkspaceChatAttention(raw, users[0], channel.id, attention.id), { statusCode: 404 });
    const acknowledgements = await Promise.all([acknowledgeWorkspaceChatAttention(raw, teammate, channel.id, attention.id), acknowledgeWorkspaceChatAttention(raw, teammate, channel.id, attention.id)]);
    assert.equal(+acknowledgements[0].attention.acknowledgedAt, +acknowledgements[1].attention.acknowledgedAt);
    assert.equal(await raw.auditEvent.count({ where: { entityId: attention.id, action: 'workspace_chat.attention_acknowledged' } }), 1);
    assert.equal((await listWorkspaceChatAttention(raw, teammate)).pendingCount, 0);
    assert.equal((await getWorkspaceChatMessageIntent(raw, users[0], channel.id, input.idempotencyKey)).message.id, posts[0].message.id);
    await assert.rejects(getWorkspaceChatMessageIntent(raw, teammate, channel.id, input.idempotencyKey), { statusCode: 404 });
    await assert.rejects(postWorkspaceChatMessage(raw, users[0], channel.id, { ...input, attentionRecipientIds: [] }), { statusCode: 409 });
    await assert.rejects(raw.workspaceChatAttention.update({ where: { id: attention.id }, data: { acknowledgedAt: null } }));
    await assert.rejects(raw.workspaceChatAttention.update({ where: { id: attention.id }, data: { recipientId: users[0].id } }));
    await assert.rejects(raw.workspaceChatMessage.create({ data: { organizationId: orgs[0], channelId: channel.id, authorId: users[0].id, content: 'Incomplete attention', attentionRecipientIds: [teammate.id], intentHash: 'a'.repeat(64) } }));
    const failedIntent = randomUUID();
    const failAudit = { $transaction: (operation, options) => raw.$transaction(tx => operation(new Proxy(tx, {
      get(target, field) { return field === 'auditEvent' ? new Proxy(target.auditEvent, { get(delegate, method) { return method === 'create' ? async () => { throw Error('Synthetic audit outage'); } : Reflect.get(delegate, method); } }) : Reflect.get(target, field); },
    })), options) };
    await assert.rejects(postWorkspaceChatMessage(failAudit, users[0], channel.id, { ...input, idempotencyKey: failedIntent }), { code: 'AUDIT_UNAVAILABLE' });
    assert.equal(await raw.workspaceChatMessage.count({ where: { channelId: channel.id, clientKey: failedIntent } }), 0);
    assert.equal(await raw.workspaceChatAttention.count({ where: { channelId: channel.id } }), 1);
    await assert.rejects(postWorkspaceChatMessage(raw, users[0], channel.id, { ...input, content: 'Changed' }), { statusCode: 409 });
    const dmMessage = await postWorkspaceChatMessage(raw, users[0], dm.id, { content: 'DM only', idempotencyKey: randomUUID() });
    await assert.rejects(postWorkspaceChatMessage(raw, users[0], channel.id, { content: 'Wrong parent', parentId: dmMessage.message.id, idempotencyKey: randomUUID() }), { statusCode: 404 });
    await assert.rejects(raw.workspaceChatMessage.create({ data: { organizationId: orgs[0], channelId: channel.id, authorId: users[0].id, content: 'Wrong DB parent', parentId: dmMessage.message.id } }));
    await setWorkspaceChatMember(raw, users[0], channel.id, teammate.id, false);
    await assert.rejects(acknowledgeWorkspaceChatAttention(raw, teammate, channel.id, attention.id), { statusCode: 404 });
    await assert.rejects(getWorkspaceChatMessages(raw, teammate, channel.id), { statusCode: 404 });
    await assert.rejects(postWorkspaceChatMessage(raw, teammate, channel.id, { content: 'Revoked', idempotencyKey: randomUUID() }), { statusCode: 404 });
    await assert.rejects(raw.workspaceChatMessage.create({ data: { organizationId: orgs[0], channelId: channel.id, authorId: teammate.id, content: 'Revoked DB post' } }));
    await setWorkspaceChatMember(raw, users[0], channel.id, teammate.id, true);
    assert.equal((await getWorkspaceChatMessages(raw, teammate, channel.id)).items[0].content, input.content);
    const distinct = await Promise.all(['Concurrent A', 'Concurrent B', 'Concurrent C'].map(content => postWorkspaceChatMessage(raw, users[0], channel.id, { content, idempotencyKey: randomUUID() })));
    assert.equal(new Set(distinct.map(result => result.message.id)).size, 3);
    const race = await Promise.allSettled([
      postWorkspaceChatMessage(raw, teammate, channel.id, { content: 'Race with revocation', idempotencyKey: randomUUID(), attentionRecipientIds: [users[0].id] }),
      setWorkspaceChatMember(raw, users[0], channel.id, teammate.id, false),
    ]);
    assert.equal(race[1].status, 'fulfilled');
    await assert.rejects(setWorkspaceChatMember(raw, users[0], channel.id, users[0].id, false), { statusCode: 409 });
    assert.ok((await listWorkspaceChatChannels(raw, users[0])).items.some(item => item.id === channel.id));
    if (race[0].status === 'rejected') assert.equal(race[0].reason.statusCode, 404);
    await assert.rejects(postWorkspaceChatMessage(raw, teammate, channel.id, { content: 'After revocation', idempotencyKey: randomUUID() }), { statusCode: 404 });
    assert.equal(await raw.workspaceChatMessage.count({ where: { channelId: channel.id, content: 'Race with revocation' } }), race[0].status === 'fulfilled' ? 1 : 0);
    assert.equal(await raw.workspaceChatAttention.count({ where: { channelId: channel.id, recipientId: users[0].id } }), race[0].status === 'fulfilled' ? 1 : 0);
    const history = (await getWorkspaceChatMessages(raw, users[0], channel.id)).items;
    assert.ok(history.some(message => message.content === input.content));
    const audit = await raw.auditEvent.findMany({ where: { organizationId: orgs[0], action: 'workspace_chat.message_created' } });
    assert.equal(audit.length, 5 + (race[0].status === 'fulfilled' ? 1 : 0));
    assert.ok(audit.every(row => !JSON.stringify(row.metadata).includes('persisted message')));
    await setWorkspaceChatMember(raw, users[0], channel.id, teammate.id, true);
    const recipientRace = await Promise.allSettled([
      postWorkspaceChatMessage(raw, users[0], channel.id, { content: 'Recipient revocation race', idempotencyKey: randomUUID(), attentionRecipientIds: [teammate.id] }),
      setWorkspaceChatMember(raw, users[0], channel.id, teammate.id, false),
    ]);
    assert.equal(recipientRace[1].status, 'fulfilled');
    if (recipientRace[0].status === 'rejected') assert.equal(recipientRace[0].reason.statusCode, 404);
    assert.equal(await raw.workspaceChatMessage.count({ where: { channelId: channel.id, content: 'Recipient revocation race' } }), recipientRace[0].status === 'fulfilled' ? 1 : 0);
    assert.equal(await raw.workspaceChatAttention.count({ where: { channelId: channel.id, recipientId: teammate.id } }), recipientRace[0].status === 'fulfilled' ? 2 : 1);
    assert.equal((await listWorkspaceChatAttention(raw, teammate)).pendingCount, 0);
    const movedClient = await raw.client.create({ data: { organizationId: orgs[0], name: 'Reassigned project client' } });
    await raw.project.update({ where: { id: projects[0].id }, data: { clientId: movedClient.id } });
    await assert.rejects(getWorkspaceChatMessages(raw, users[0], channel.id), { statusCode: 404 });
    await assert.rejects(postWorkspaceChatMessage(raw, users[0], channel.id, { content: 'Wrong old client', idempotencyKey: randomUUID() }), { statusCode: 404 });
    assert.ok(!(await listWorkspaceChatChannels(raw, users[0])).items.some(item => item.id === channel.id));
    await assert.rejects(raw.workspaceChatMessage.create({ data: { organizationId: orgs[0], channelId: channel.id, authorId: users[0].id, content: 'Wrong old client raw post' } }));
    await raw.project.update({ where: { id: projects[0].id }, data: { clientId: clients[0].id } });
    await raw.client.update({ where: { id: clients[0].id }, data: { deletedAt: new Date() } });
    await assert.rejects(getWorkspaceChatMessages(raw, users[0], channel.id), { statusCode: 404 });
    assert.ok(!(await listWorkspaceChatChannels(raw, users[0])).items.some(item => item.id === channel.id));
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'CLIENT' } });
    await assert.rejects(listWorkspaceChatChannels(raw, users[0]), { statusCode: 403 });
  } finally {
    await raw.workspaceChatMessage.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.workspaceChatMember.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.workspaceChatChannel.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
