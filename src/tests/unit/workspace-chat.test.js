import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { createWorkspaceMcp } from '../../integrations/workspace-mcp.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import workspaceChatRoutes from '../../routes/workspace-chat.routes.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import {
  createWorkspaceChatChannel, listWorkspaceChatChannels, listWorkspaceChatPeople,
  postWorkspaceChatMessage, getWorkspaceChatMessages, setWorkspaceChatMember,
  markWorkspaceChatRead,
  listWorkspaceChatAttention, acknowledgeWorkspaceChatAttention, getWorkspaceChatMessageIntent,
} from '../../services/workspace-chat.service.js';

const actor = { id: 'a', organizationId: 'org', role: 'ADMIN', isActive: true, name: 'Alex' };
function database() {
  let records = {
    user: [actor, { ...actor, id: 'b', name: 'Bianca', role: 'TEAM' }, { ...actor, id: 'foreign', organizationId: 'other' }, { ...actor, id: 'bot', role: 'BOT' }].map(row => ({ ...row })),
    client: [{ id: 'c', organizationId: 'org', deletedAt: null }],
    project: [{ id: 'p', organizationId: 'org', clientId: 'c', deletedAt: null }],
    workspaceChatChannel: [], workspaceChatMember: [], workspaceChatMessage: [], workspaceChatAttention: [], auditEvent: [],
  };
  const calls = [];
  function related(model, row, key) {
    if (key === 'members') return records.workspaceChatMember.filter(m => m.channelId === row.id);
    if (key === 'client') return records.client.find(c => c.id === row.clientId);
    if (key === 'project') return records.project.find(p => p.id === row.projectId);
    if (key === 'channel') return records.workspaceChatChannel.find(c => c.id === row.channelId);
    if (key === 'message') return records.workspaceChatMessage.find(m => m.id === row.messageId);
    if (key === 'recipient') return records.user.find(u => u.id === row.recipientId);
    if (key === 'user' || key === 'author' || key === 'createdBy') return records.user.find(u => u.id === row[`${key}Id`]);
    return row[key];
  }
  function matches(model, row, where = {}) {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(w => matches(model, row, w));
      if (key === 'OR') return value.some(w => matches(model, row, w));
      const actual = related(model, row, key);
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('in' in value) return value.in.includes(actual);
        if ('lt' in value) return actual < value.lt;
        if ('gt' in value) return actual > value.gt;
        if ('some' in value) return actual.some(m => matches('workspaceChatMember', m, value.some));
        if (key === 'id_organizationId') return matches(model, row, value);
        return actual != null && matches(key, actual, value);
      }
      return actual instanceof Date && value instanceof Date ? +actual === +value : actual === value;
    });
  }
  function decorate(model, row, args) {
    if (!row) return null;
    if (args.select) return Object.fromEntries(Object.keys(args.select).map(k => [k, row[k]]));
    const result = { ...row };
    if (args.include?.members) result.members = records.workspaceChatMember.filter(m => m.channelId === row.id && !m.leftAt).map(m => ({ userId: m.userId, leftAt: m.leftAt, user: records.user.find(u => u.id === m.userId) }));
    if (args.include?.author) { const u = records.user.find(u => u.id === row.authorId); result.author = { id: u.id, name: u.name }; }
    if (args.include?.project) result.project = records.project.find(p => p.id === row.projectId) ?? null;
    if (args.include?.attention) result.attention = records.workspaceChatAttention.filter(a => a.messageId === row.id).map(a => ({ ...a, recipient: records.user.find(u => u.id === a.recipientId) }));
    if (args.include?.channel) result.channel = decorate('workspaceChatChannel', records.workspaceChatChannel.find(c => c.id === row.channelId), args.include.channel);
    if (args.include?.message) result.message = decorate('workspaceChatMessage', records.workspaceChatMessage.find(m => m.id === row.messageId), args.include.message);
    return result;
  }
  const db = Object.fromEntries(Object.keys(records).map(model => [model, {
    async findFirst(args = {}) { calls.push([model, 'findFirst', args]); return decorate(model, records[model].find(row => matches(model, row, args.where)), args); },
    async findMany(args = {}) {
      calls.push([model, 'findMany', args]);
      let rows = records[model].filter(row => matches(model, row, args.where));
      if (args.orderBy) rows.sort((a, b) => { for (const order of args.orderBy) { const [key, dir] = Object.entries(order)[0]; if (a[key] < b[key]) return dir === 'asc' ? -1 : 1; if (a[key] > b[key]) return dir === 'asc' ? 1 : -1; } return 0; });
      return rows.slice(0, args.take ?? rows.length).map(row => decorate(model, row, args));
    },
    async create(args) { calls.push([model, 'create', args]); if (model === 'auditEvent' && db.failAudit) throw Error('audit down'); const row = { id: `${model}-${records[model].length}`, createdAt: new Date(), updatedAt: new Date(), archivedAt: null, leftAt: null, acknowledgedAt: null, ...args.data }; records[model].push(row); return decorate(model, row, args); },
    async createMany(args) { for (const row of args.data) await db[model].create({ data: row }); return { count: args.data.length }; },
    async updateMany(args) { calls.push([model, 'updateMany', args]); const rows = records[model].filter(row => matches(model, row, args.where)); for (const row of rows) Object.assign(row, args.data); return { count: rows.length }; },
  }]));
  db.$transaction = async (operation, options) => { assert.equal(options.isolationLevel, 'Serializable'); const prior = structuredClone(records); try { return await operation(db); } catch (error) { records = prior; throw error; } };
  return { db, calls, rows: () => records };
}
const rejectCode = code => error => error.code === code;
async function direct(fixture) { return (await createWorkspaceChatChannel(fixture.db, actor, { kind: 'DIRECT', memberIds: ['b'] })).channel; }

test('recipient HTTP acknowledgement works through request tenancy and remains idempotent', async t => {
  const f = database(), channel = await direct(f);
  const posted = await postWorkspaceChatMessage(f.db, actor, channel.id, { content: 'Scoped attention', idempotencyKey: 'scoped-attention', attentionRecipientIds: ['b'] });
  const attentionId = posted.message.attention[0].id;
  const recipient = { ...actor, id: 'b', role: 'TEAM' };
  const app = Fastify();
  app.decorate('authenticate', async r => { r.user = recipient; r.prisma = createScopedPrisma(f.db, recipient.organizationId); });
  await app.register(workspaceChatRoutes, { prefix: '/api/workspace-chat' });
  await app.ready(); t.after(() => app.close());
  const url = `/api/workspace-chat/channels/${channel.id}/attention/${attentionId}/ack`;
  f.db.failAudit = true;
  const failed = await app.inject({ method: 'POST', url, payload: {} });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json().code, 'AUDIT_UNAVAILABLE');
  assert.equal(f.rows().workspaceChatAttention.find(row => row.id === attentionId).acknowledgedAt, null);
  f.db.failAudit = false;
  const first = await app.inject({ method: 'POST', url, payload: {} });
  assert.equal(first.statusCode, 200, first.body);
  const replay = await app.inject({ method: 'POST', url, payload: {} });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(first.json().attention.acknowledgedAt, replay.json().attention.acknowledgedAt);
  assert.equal(f.rows().auditEvent.filter(row => row.action === 'workspace_chat.attention_acknowledged').length, 1);
  assert.equal((await listWorkspaceChatAttention(createScopedPrisma(f.db, 'org'), recipient)).pendingCount, 0);
});

test('human attention is explicit, normalized, atomic with message and replay-sensitive', async () => {
  const f = database(), channel = await direct(f);
  const input = { content: '@Bianca review this', idempotencyKey: 'attention-001', attentionRecipientIds: ['b', 'b'] };
  const first = await postWorkspaceChatMessage(f.db, actor, channel.id, input);
  assert.equal(first.message.attention.length, 1);
  assert.match(first.message.intentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.message.attentionRecipientIds, ['b']);
  assert.equal((await postWorkspaceChatMessage(f.db, actor, channel.id, { ...input, attentionRecipientIds: ['b'] })).duplicate, true);
  assert.equal(f.rows().workspaceChatAttention.length, 1);
  await assert.rejects(postWorkspaceChatMessage(f.db, actor, channel.id, { ...input, attentionRecipientIds: [] }), rejectCode('CHAT_CONFLICT'));
  await postWorkspaceChatMessage(f.db, actor, channel.id, { content: '@Bianca plain text only', idempotencyKey: 'attention-002' });
  assert.equal(f.rows().workspaceChatAttention.length, 1);
  const recovered = await getWorkspaceChatMessageIntent(f.db, actor, channel.id, input.idempotencyKey);
  assert.equal(recovered.message.id, first.message.id);
  await assert.rejects(getWorkspaceChatMessageIntent(f.db, { ...actor, id: 'b', role: 'TEAM' }, channel.id, input.idempotencyKey), rejectCode('RECORD_NOT_FOUND'));
});

test('attention denies self, nonmember, foreign, bot, inactive and removed recipients', async () => {
  for (const target of ['a', 'foreign', 'bot', 'missing', 'inactive', 'removed']) {
    const f = database(), channel = await direct(f);
    let recipientId = target;
    if (target === 'inactive' || target === 'removed') {
      recipientId = 'b';
      if (target === 'inactive') f.rows().user.find(row => row.id === 'b').isActive = false;
      else f.rows().workspaceChatMember.find(row => row.userId === 'b').leftAt = new Date();
    }
    await assert.rejects(postWorkspaceChatMessage(f.db, actor, channel.id, { content: 'request', idempotencyKey: 'attention-001', attentionRecipientIds: [recipientId] }), rejectCode(target === 'a' ? 'INVALID_INPUT' : 'RECORD_NOT_FOUND'));
    assert.equal(f.rows().workspaceChatMessage.length, 0);
    assert.equal(f.rows().workspaceChatAttention.length, 0);
  }
});

test('attention insert or audit failure rolls back both message and recipients', async () => {
  for (const failure of ['attention', 'audit']) {
    const f = database(), channel = await direct(f);
    if (failure === 'audit') f.db.failAudit = true;
    else f.db.workspaceChatAttention.createMany = async () => { throw Error('attention failed'); };
    await assert.rejects(postWorkspaceChatMessage(f.db, actor, channel.id, { content: 'request', idempotencyKey: 'attention-001', attentionRecipientIds: ['b'] }));
    assert.equal(f.rows().workspaceChatMessage.length, 0); assert.equal(f.rows().workspaceChatAttention.length, 0);
  }
});

test('recipient alone can acknowledge, idempotent replay preserves timestamp and audit', async () => {
  const f = database(), channel = await direct(f), recipient = { ...actor, id: 'b', role: 'TEAM' };
  const posted = await postWorkspaceChatMessage(f.db, actor, channel.id, { content: 'request', idempotencyKey: 'attention-001', attentionRecipientIds: ['b'] });
  const attention = posted.message.attention[0];
  assert.equal((await listWorkspaceChatAttention(f.db, actor)).pendingCount, 0);
  assert.equal((await listWorkspaceChatAttention(f.db, recipient)).pendingCount, 1);
  await assert.rejects(acknowledgeWorkspaceChatAttention(f.db, actor, channel.id, attention.id), rejectCode('RECORD_NOT_FOUND'));
  const before = f.rows().auditEvent.length;
  const first = await acknowledgeWorkspaceChatAttention(f.db, recipient, channel.id, attention.id);
  const replay = await acknowledgeWorkspaceChatAttention(f.db, recipient, channel.id, attention.id);
  assert.equal(+first.attention.acknowledgedAt, +replay.attention.acknowledgedAt);
  assert.equal(f.rows().auditEvent.length, before + 1);
  assert.equal((await listWorkspaceChatAttention(f.db, recipient)).pendingCount, 0);
});

test('current channel membership and canonical client/project bind inbox and acknowledgement', async () => {
  for (const revoked of ['membership', 'project', 'client', 'actor']) {
    const f = database(), recipient = { ...actor, id: 'b', role: 'TEAM' };
    const channel = (await createWorkspaceChatChannel(f.db, actor, { kind: 'PROJECT', name: 'Review', projectId: 'p', memberIds: ['b'] })).channel;
    const posted = await postWorkspaceChatMessage(f.db, actor, channel.id, { content: 'request', idempotencyKey: 'attention-001', attentionRecipientIds: ['b'] });
    if (revoked === 'membership') f.rows().workspaceChatMember.find(row => row.userId === 'b').leftAt = new Date();
    if (revoked === 'project') f.rows().project[0].clientId = 'moved-client';
    if (revoked === 'client') f.rows().client[0].deletedAt = new Date();
    if (revoked === 'actor') f.rows().user.find(row => row.id === 'b').isActive = false;
    if (revoked === 'actor') await assert.rejects(listWorkspaceChatAttention(f.db, recipient), rejectCode('ROLE_DENIED'));
    else assert.equal((await listWorkspaceChatAttention(f.db, recipient)).pendingCount, 0);
    await assert.rejects(acknowledgeWorkspaceChatAttention(f.db, recipient, channel.id, posted.message.attention[0].id), rejectCode(revoked === 'actor' ? 'ROLE_DENIED' : 'RECORD_NOT_FOUND'));
  }
});

test('recipient membership is reread after channel lock, before any child write', async () => {
  const f = database(), channel = await direct(f), originalLock = f.db.workspaceChatChannel.updateMany;
  f.db.workspaceChatChannel.updateMany = async args => { const result = await originalLock(args); f.rows().workspaceChatMember.find(row => row.userId === 'b').leftAt = new Date(); return result; };
  await assert.rejects(postWorkspaceChatMessage(f.db, actor, channel.id, { content: 'request', idempotencyKey: 'attention-001', attentionRecipientIds: ['b'] }), rejectCode('RECORD_NOT_FOUND'));
  assert.equal(f.rows().workspaceChatMessage.length, 0);
});

test('fresh stored staff role is required, bot and inactive identities refused', async () => {
  for (const changes of [{ role: 'CLIENT' }, { role: 'BOT' }, { isActive: false }, { organizationId: 'other' }]) {
    const f = database(); Object.assign(f.rows().user[0], changes);
    await assert.rejects(listWorkspaceChatChannels(f.db, actor), rejectCode('ROLE_DENIED'));
  }
  const f = database(); const people = await listWorkspaceChatPeople(f.db, actor);
  assert.deepEqual(people.items.map(p => p.id), ['a', 'b']);
  assert.deepEqual(Object.keys(people.items[0]).sort(), ['id', 'name', 'role']);
});
test('direct identity is normalized, creator included, repeated creation returns same channel', async () => {
  const f = database(); const first = await direct(f);
  const second = await createWorkspaceChatChannel(f.db, { ...actor, id: 'b', role: 'TEAM' }, { kind: 'DIRECT', memberIds: ['a', 'a'] });
  assert.equal(second.channel.id, first.id);
  assert.equal(f.rows().workspaceChatChannel.length, 1);
  assert.equal(f.rows().workspaceChatMember.length, 2);
  assert.equal(f.rows().auditEvent.length, 1);
  assert.deepEqual(f.rows().auditEvent[0].metadata, { kind: 'DIRECT', memberCount: 2 });
});
test('member IDs must identify active staff in same organization and kind constraints hold', async () => {
  const f = database();
  for (const member of ['foreign', 'bot', 'missing']) await assert.rejects(createWorkspaceChatChannel(f.db, actor, { kind: 'DIRECT', memberIds: [member] }), rejectCode('INVALID_INPUT'));
  await assert.rejects(createWorkspaceChatChannel(f.db, actor, { kind: 'DIRECT', memberIds: [] }), rejectCode('INVALID_INPUT'));
  await assert.rejects(createWorkspaceChatChannel(f.db, { ...actor, id: 'b', role: 'TEAM' }, { kind: 'COMPANY', name: 'General' }), rejectCode('ROLE_DENIED'));
});
test('project/client associations canonical and deleted clients refused', async () => {
  const f = database();
  await assert.rejects(createWorkspaceChatChannel(f.db, actor, { kind: 'PROJECT', name: 'Project', projectId: 'p', clientId: 'other' }), rejectCode('RECORD_NOT_FOUND'));
  const result = await createWorkspaceChatChannel(f.db, actor, { kind: 'PROJECT', name: 'Project', projectId: 'p' });
  assert.equal(result.channel.clientId, 'c');
  f.rows().client[0].deletedAt = new Date();
  assert.deepEqual((await listWorkspaceChatChannels(f.db, actor)).items, []);
  await assert.rejects(getWorkspaceChatMessages(f.db, actor, result.channel.id), rejectCode('RECORD_NOT_FOUND'));
});
test('membership required even for admin, and removed member cannot read or post', async () => {
  const f = database(); const c = await direct(f);
  await assert.rejects(getWorkspaceChatMessages(f.db, actor, 'foreign-channel'), rejectCode('RECORD_NOT_FOUND'));
  f.rows().workspaceChatMember.find(m => m.userId === 'a').leftAt = new Date();
  await assert.rejects(getWorkspaceChatMessages(f.db, actor, c.id), rejectCode('RECORD_NOT_FOUND'));
  await assert.rejects(postWorkspaceChatMessage(f.db, actor, c.id, { content: 'hello', idempotencyKey: 'key-00001' }), rejectCode('RECORD_NOT_FOUND'));
});
test('reassigned projects hide old-client channel and deny reads and posts', async () => {
  const f = database();
  const c = (await createWorkspaceChatChannel(f.db, actor, { kind: 'PROJECT', name: 'Project', projectId: 'p' })).channel;
  f.rows().client.push({ id: 'next-client', organizationId: 'org', deletedAt: null });
  f.rows().project[0].clientId = 'next-client';
  assert.deepEqual((await listWorkspaceChatChannels(f.db, actor)).items, []);
  await assert.rejects(getWorkspaceChatMessages(f.db, actor, c.id), rejectCode('RECORD_NOT_FOUND'));
  await assert.rejects(postWorkspaceChatMessage(f.db, actor, c.id, { content: 'Moved', idempotencyKey: 'key-00001' }), rejectCode('RECORD_NOT_FOUND'));
  assert.equal(f.rows().workspaceChatMessage.length, 0);
});
test('message, read and membership writes obtain channel lock before touching children', async () => {
  const f = database();
  const c = (await createWorkspaceChatChannel(f.db, actor, { kind: 'COMPANY', name: 'General', memberIds: ['b'] })).channel;
  for (const operation of [
    () => postWorkspaceChatMessage(f.db, actor, c.id, { content: 'Hello', idempotencyKey: 'key-00001' }),
    () => markWorkspaceChatRead(f.db, actor, c.id),
    () => setWorkspaceChatMember(f.db, actor, c.id, 'b', false),
  ]) {
    f.calls.length = 0; await operation();
    const writes = f.calls.filter(([, method]) => ['create', 'updateMany', 'createMany'].includes(method));
    assert.equal(writes[0][0], 'workspaceChatChannel');
    assert.equal(writes[0][1], 'updateMany');
    assert.equal(writes.filter(([model]) => model === 'workspaceChatChannel').length, 1);
    assert.ok(writes[0][2].where.members.some.userId === actor.id);
  }
});
test('channel pages advance past filtered project rows and use stable id cursors', async () => {
  const f = database();
  const moved = (await createWorkspaceChatChannel(f.db, actor, { kind: 'PROJECT', name: 'Moved project', projectId: 'p' })).channel;
  const first = (await createWorkspaceChatChannel(f.db, actor, { kind: 'COMPANY', name: 'First' })).channel;
  const last = (await createWorkspaceChatChannel(f.db, actor, { kind: 'COMPANY', name: 'Last' })).channel;
  f.rows().project[0].clientId = 'another-client';
  const empty = await listWorkspaceChatChannels(f.db, actor, { limit: '1' });
  assert.deepEqual(empty.items, []); assert.equal(empty.nextCursor, moved.id);
  const middle = await listWorkspaceChatChannels(f.db, actor, { limit: 1, after: empty.nextCursor });
  assert.deepEqual(middle.items.map(channel => channel.id), [first.id]); assert.equal(middle.nextCursor, first.id);
  // Activity changes must not alter page ordering or duplicate prior rows.
  f.rows().workspaceChatChannel.find(channel => channel.id === first.id).updatedAt = new Date('2099-01-01');
  const final = await listWorkspaceChatChannels(f.db, actor, { limit: 1, after: middle.nextCursor });
  assert.deepEqual(final.items.map(channel => channel.id), [last.id]); assert.equal(final.nextCursor, null);
  for (const input of [{ limit: 101 }, { limit: 0 }, { after: '' }, { unknown: true }]) await assert.rejects(listWorkspaceChatChannels(f.db, actor, input), rejectCode('INVALID_INPUT'));
});
test('messages use actor identity, idempotent retries and content-sensitive conflict', async () => {
  const f = database(); const c = await direct(f); const input = { content: '  hello  ', idempotencyKey: 'key-00001' };
  const posted = await postWorkspaceChatMessage(f.db, actor, c.id, input);
  assert.equal(posted.message.content, 'hello'); assert.equal(posted.message.authorId, 'a'); assert.equal(posted.duplicate, false);
  const repeated = await postWorkspaceChatMessage(f.db, actor, c.id, input); assert.equal(repeated.duplicate, true);
  assert.equal(f.rows().workspaceChatMessage.length, 1);
  await assert.rejects(postWorkspaceChatMessage(f.db, actor, c.id, { ...input, content: 'changed' }), rejectCode('CHAT_CONFLICT'));
  await assert.rejects(postWorkspaceChatMessage(f.db, { ...actor, id: 'b', role: 'TEAM' }, c.id, input), rejectCode('CHAT_CONFLICT'));
  assert.deepEqual(f.rows().auditEvent.at(-1).metadata, { channelId: c.id, parentId: null, attentionCount: 0 });
});
test('reply parent must belong to the same channel and organization', async () => {
  const f = database(); const c = await direct(f);
  f.rows().workspaceChatMessage.push({ id: 'other-message', organizationId: 'other', channelId: 'other-channel' });
  await assert.rejects(postWorkspaceChatMessage(f.db, actor, c.id, { content: 'reply', parentId: 'other-message', idempotencyKey: 'key-00002' }), rejectCode('RECORD_NOT_FOUND'));
});
test('membership changes cannot strand retained history or remove the final channel manager', async () => {
  const f = database();
  const { channel } = await createWorkspaceChatChannel(f.db, actor, { kind: 'COMPANY', name: 'Retained history', memberIds: ['b'] });
  await assert.rejects(setWorkspaceChatMember(f.db, actor, channel.id, actor.id, false), rejectCode('CHAT_CONFLICT'));
  await setWorkspaceChatMember(f.db, actor, channel.id, 'b', false);
  await assert.rejects(setWorkspaceChatMember(f.db, actor, channel.id, actor.id, false), rejectCode('CHAT_CONFLICT'));
  assert.equal((await listWorkspaceChatChannels(f.db, actor)).items.length, 1);
  await setWorkspaceChatMember(f.db, actor, channel.id, 'b', true);
  f.rows().user.find(person => person.id === 'b').role = 'ADMIN';
  await setWorkspaceChatMember(f.db, actor, channel.id, actor.id, false);
  assert.equal((await listWorkspaceChatChannels(f.db, { ...actor, id: 'b' })).items.length, 1);
});

test('audit failure rolls back channel, memberships and messages', async () => {
  const f = database(); f.db.failAudit = true;
  await assert.rejects(direct(f), rejectCode('AUDIT_UNAVAILABLE'));
  assert.equal(f.rows().workspaceChatChannel.length, 0); assert.equal(f.rows().workspaceChatMember.length, 0);
  f.db.failAudit = false; const c = await direct(f); f.db.failAudit = true;
  await assert.rejects(postWorkspaceChatMessage(f.db, actor, c.id, { content: 'hello', idempotencyKey: 'key-00001' }), rejectCode('AUDIT_UNAVAILABLE'));
  assert.equal(f.rows().workspaceChatMessage.length, 0);
});
test('direct membership cannot change; eligible rejoined staff can see retained channel history', async () => {
  const f = database(); const c = await direct(f);
  await assert.rejects(setWorkspaceChatMember(f.db, actor, c.id, 'b', false), rejectCode('CHAT_CONFLICT'));
  const company = (await createWorkspaceChatChannel(f.db, actor, { kind: 'COMPANY', name: 'General', memberIds: ['b'] })).channel;
  await postWorkspaceChatMessage(f.db, actor, company.id, { content: 'Retained history', idempotencyKey: 'key-00001' });
  await setWorkspaceChatMember(f.db, actor, company.id, 'b', false);
  await setWorkspaceChatMember(f.db, actor, company.id, 'b', true);
  assert.equal((await getWorkspaceChatMessages(f.db, { ...actor, id: 'b', role: 'TEAM' }, company.id)).items[0].content, 'Retained history');
  await setWorkspaceChatMember(f.db, actor, company.id, 'b', false);
  f.rows().user.find(u => u.id === 'b').isActive = false;
  await assert.rejects(setWorkspaceChatMember(f.db, actor, company.id, 'b', true), rejectCode('RECORD_NOT_FOUND'));
});
test('messages paginate older records with stable equal-time ID ordering', async () => {
  const f = database(); const c = await direct(f);
  const createdAt = new Date('2026-01-01');
  for (const id of ['m1', 'm2', 'm3']) f.rows().workspaceChatMessage.push({ id, organizationId: 'org', channelId: c.id, authorId: 'a', content: id, createdAt });
  const first = await getWorkspaceChatMessages(f.db, actor, c.id, { limit: 2 });
  assert.deepEqual(first.items.map(m => m.id), ['m2', 'm3']); assert.equal(first.nextCursor, 'm2');
  const second = await getWorkspaceChatMessages(f.db, actor, c.id, { limit: 2, after: first.nextCursor });
  assert.deepEqual(second.items.map(m => m.id), ['m1']); assert.equal(second.nextCursor, null);
});
test('route strict inputs reject author spoofing, invalid keys, unknown fields and unsafe limits', async t => {
  const f = database(); const c = await direct(f); const app = Fastify();
  app.decorate('authenticate', async r => { r.user = actor; r.prisma = f.db; });
  await app.register(workspaceChatRoutes, { prefix: '/api/workspace-chat' }); await app.ready(); t.after(() => app.close());
  for (const payload of [{ content: 'x', idempotencyKey: 'key-00001', authorId: 'b' }, { content: 'x' }, { content: 'x', idempotencyKey: 'short' }, { content: ' '.repeat(10), idempotencyKey: 'key-00001' }]) {
    const r = await app.inject({ method: 'POST', url: `/api/workspace-chat/channels/${c.id}/messages`, payload }); assert.equal(r.statusCode, 400);
  }
  assert.equal((await app.inject(`/api/workspace-chat/channels/${c.id}/messages?limit=51`)).statusCode, 400);
  assert.equal((await app.inject('/api/workspace-chat/channels?limit=101')).statusCode, 400);
  assert.equal((await app.inject('/api/workspace-chat/channels?unexpected=field')).statusCode, 400);
  assert.equal((await app.inject('/api/workspace-chat/attention?limit=51')).statusCode, 400);
  assert.equal((await app.inject(`/api/workspace-chat/channels/${c.id}/messages/by-intent/short`)).statusCode, 400);
  const pending = await postWorkspaceChatMessage(f.db, actor, c.id, { content: 'Attention', idempotencyKey: 'route-attention', attentionRecipientIds: ['b'] });
  const ackUrl = `/api/workspace-chat/channels/${c.id}/attention/${pending.message.attention[0].id}/ack`;
  assert.equal((await app.inject({ method: 'POST', url: ackUrl, payload: { recipientId: 'b' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: ackUrl, payload: {} })).statusCode, 404);
  f.db.workspaceChatChannel.findFirst = async () => { throw Error('password=secret-provider-text'); };
  const failed = await app.inject(`/api/workspace-chat/channels/${c.id}/messages`); assert.equal(failed.statusCode, 503); assert.doesNotMatch(failed.body, /secret|password/);
});


test('real MCP discovery and reads preserve channel membership boundaries', async () => {
  const f = database(), c = await direct(f);
  await postWorkspaceChatMessage(f.db, actor, c.id, { content: 'Private team record', idempotencyKey: 'mcp-message-1' });
  const context = { prisma: f.db, user: actor, scopes: ['workspace:read'] };
  const service = createWorkspaceTools(), server = createWorkspaceMcp(service, context);
  const client = new Client({ name: 'messages-test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right); await client.connect(left);
  try {
    const catalog = await client.listTools();
    assert.equal(catalog.tools.find(t => t.name === 'list_workspace_chat_attention').annotations.readOnlyHint, true);
    assert.equal(catalog.tools.find(t => t.name === 'get_workspace_chat_messages').annotations.readOnlyHint, true);
    const channels = await client.callTool({ name: 'list_workspace_chat_channels', arguments: {} });
    assert.equal(channels.structuredContent.output.items[0].id, c.id);
    const messages = await client.callTool({ name: 'get_workspace_chat_messages', arguments: { channelId: c.id } });
    assert.equal(messages.structuredContent.output.items[0].content, 'Private team record');
    const attention = await client.callTool({ name: 'list_workspace_chat_attention', arguments: {} });
    assert.deepEqual(attention.structuredContent.output.items, []);
    assert.equal(attention.structuredContent.output.countScope, 'page');
    const outsider = { ...context, user: { ...actor, id: 'foreign', organizationId: 'other' } };
    await assert.rejects(service.call(outsider, 'get_workspace_chat_messages', { channelId: c.id }), { code: 'RECORD_NOT_FOUND' });
    assert.equal(service.list({ ...context, scopes: ['workspace:actions'] }).some(t => t.name === 'get_workspace_chat_messages'), false);
  } finally { await client.close(); await server.close(); }
});
