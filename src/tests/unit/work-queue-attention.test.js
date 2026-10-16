import test from 'node:test';
import assert from 'node:assert/strict';
import { WORK_QUEUE_SOURCES, buildWorkQueue } from '../../services/work-queue.service.js';
import { listWorkspaceChatAttentionForQueue } from '../../services/workspace-chat.service.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

const actor = { id: 'recipient', organizationId: 'org', role: 'TEAM', name: 'Recipient', isActive: true };
const source = WORK_QUEUE_SOURCES.find(row => row.key === 'workspace_chat_attention');
const now = new Date('2026-10-16T12:00:00Z');
function fixture(items = []) {
  const calls = [];
  const db = { user: { findFirst: async () => actor }, $queryRaw: async sql => { calls.push(sql); return items; } };
  return { db, calls };
}
const item = index => ({ id: `attention-${index}`, recipientId: actor.id, createdAt: new Date('2026-10-15T12:00:00Z'), clientId: 'client', clientName: 'Client', projectId: 'project', projectName: 'Project' });
test('own attention queue is generic and identical for me/everyone; SQL is parameterized and filters before limit', async () => {
  const f = fixture([item(1)]), options = { user: actor, now, sources: [source], filters: { owner: 'everyone', clientId: 'client', projectId: 'project' } };
  const queue = await buildWorkQueue(createScopedPrisma(f.db, 'org'), options);
  assert.equal(queue.partial, false);assert.equal(queue.counts.needs_action, 1);
  assert.deepEqual(queue.rows[0], { type: 'workspace_attention', id: 'attention-1', title: 'A teammate requested your attention', sourceUrl: '/messages', client: { id: 'client', name: 'Client' }, project: { id: 'project', name: 'Project' }, owner: { id: actor.id, name: actor.name, role: actor.role }, state: 'PENDING', nextAction: 'Open Team messages to review and acknowledge', dueAt: null, dueKind: null, ageDays: 1, view: 'needs_action' });
  assert.deepEqual((await buildWorkQueue(f.db, { ...options, filters: { ...options.filters, owner: 'me' } })).rows, queue.rows);
  const sql = f.calls[0];assert.deepEqual(JSON.parse(sql.values[0]), { organizationId: 'org', actorId: actor.id, clientId: 'client', projectId: 'project' });assert.equal(sql.values[1], 101);
  assert.ok(sql.text.indexOf('WHERE') < sql.text.indexOf('LIMIT'));
  assert.match(sql.text, /u\."isActive" AND u\.role IN \('ADMIN','TEAM'\)/);
  assert.match(sql.text, /cm\."leftAt" IS NULL/);assert.match(sql.text, /p\."clientId"=ch\."clientId"/);
  assert.doesNotMatch(sql.text.split('FROM')[0], /content|intentHash|ch\.name/);
});
test('attention source reports cap101 and failure honestly without private diagnostics', async () => {
  const f = fixture(Array.from({ length: 101 }, (_, i) => item(i)));
  const queue = await buildWorkQueue(f.db, { user: actor, now, sources: [source] });
  assert.equal(queue.rows.length, 100);assert.equal(queue.total, 100);assert.equal(queue.counts.needs_action, 100);assert.deepEqual(queue.truncatedSources, ['workspace_chat_attention']);
  const exact = await buildWorkQueue(fixture(Array.from({ length: 100 }, (_, i) => item(i))).db, { user: actor, now, sources: [source] });assert.deepEqual(exact.truncatedSources, []);
  f.db.$queryRaw = async () => { throw Error('PRIVATE CHANNEL BODY'); };
  const failed = await buildWorkQueue(f.db, { user: actor, now, sources: [source] });assert.equal(failed.partial, true);assert.deepEqual(failed.failedSources, ['workspace_chat_attention']);assert.equal(failed.total, 0);assert.doesNotMatch(JSON.stringify(failed), /PRIVATE CHANNEL/);
});
test('stored staff authority and bounded selector reject invalid requests before SQL', async () => {
  for (const current of [{ ...actor, role: 'CLIENT' }, { ...actor, role: 'BOT' }, { ...actor, isActive: false }, null]) {
    const f = fixture();f.db.user.findFirst = async () => current;
    await assert.rejects(listWorkspaceChatAttentionForQueue(f.db, actor), { code: 'ROLE_DENIED' });assert.equal(f.calls.length, 0);
  }
  for (const limit of [0, 102, 1.5]) await assert.rejects(listWorkspaceChatAttentionForQueue(fixture().db, actor, { limit }), { code: 'INVALID_INPUT' });
});
