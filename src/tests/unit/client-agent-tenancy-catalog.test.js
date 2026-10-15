import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedPrisma, tenantModelPolicy } from '../../utils/prisma-tenant-proxy.js';
import { tenantRelationMap } from '../../utils/tenant-relations.js';
import { AUDIT_EVENT_CATALOG, recordAuditEvent } from '../../services/audit-event.service.js';
import { validateDomainEventPayload } from '../../services/domain-event-catalog.js';
import { recordDomainEvent } from '../../services/domain-event.service.js';
import { outboxStore } from '../helpers/domain-event-fake.js';

function fakeDb() {
  const writes = [];
  const rows = { client: ['client-a'], user: ['staff-a'], clientAgentConversation: ['conversation-a'], clientAgentRun: ['run-a'] };
  const db = Object.fromEntries(Object.entries(rows).map(([name, ids]) => [name, {
    findFirst: async ({ where }) => ids.includes(where.id) && where.organizationId === 'org-a' ? { id: where.id } : null,
    findMany: async args => { writes.push({ name, method: 'findMany', args }); return []; },
    create: async args => { writes.push({ name, method: 'create', args }); return { id: 'created', ...args.data }; },
    updateMany: async args => { writes.push({ name, method: 'updateMany', args }); return { count: 1 }; },
  }]));
  return { db, writes, scoped: createScopedPrisma(db, 'org-a') };
}
test('agent models are directly tenant scoped and expose exact composite relation metadata', () => {
  for (const model of ['clientagentconversation', 'clientagentrun']) assert.equal(tenantModelPolicy[model], 'direct');
  const metadata = tenantRelationMap();
  assert.deepEqual(metadata.get('clientagentconversation').relations.createdBy.fkFields, ['createdById', 'organizationId']);
  assert.deepEqual(metadata.get('clientagentrun').relations.conversation.fkFields, ['conversationId', 'organizationId']);
  assert.deepEqual(metadata.get('clientagentrun').relations.requestedBy.fkFields, ['requestedById', 'organizationId']);
});
test('agent reads and bulk updates force current organization', async () => {
  const { scoped, writes } = fakeDb();
  for (const model of ['clientAgentConversation', 'clientAgentRun']) {
    await scoped[model].findMany({ where: { organizationId: 'foreign' } });
    await scoped[model].updateMany({ where: { organizationId: 'foreign' }, data: { updatedAt: new Date() } });
  }
  assert.equal(writes.length, 4);
  for (const write of writes) assert.equal(write.args.where.organizationId, 'org-a');
});
test('conversation creates require canonical same-organization client and creator', async () => {
  const { scoped, writes } = fakeDb();
  for (const data of [{ title: 'Missing parents' }, { clientId: 'client-b', createdById: 'staff-a' },
    { clientId: 'client-a', createdById: 'staff-b' }]) await assert.rejects(scoped.clientAgentConversation.create({ data }), /required|does not belong/);
  assert.equal(writes.length, 0);
  await scoped.clientAgentConversation.create({ data: { organizationId: 'foreign', clientId: 'client-a', createdById: 'staff-a', title: 'Shared' } });
  assert.equal(writes[0].args.data.organizationId, 'org-a');
});
test('run creates require same-organization conversation and requester via scalar and composite references', async () => {
  const { scoped, writes } = fakeDb();
  for (const data of [{ prompt: 'Missing parents' }, { conversationId: 'conversation-b', requestedById: 'staff-a' },
    { conversationId: 'conversation-a', requestedById: 'staff-b' }]) await assert.rejects(scoped.clientAgentRun.create({ data }), /required|does not belong/);
  await scoped.clientAgentRun.create({ data: { conversation: { connect: { id_organizationId: { id: 'conversation-a', organizationId: 'org-a' } } },
    requestedBy: { connect: { id_organizationId: { id: 'staff-a', organizationId: 'org-a' } } }, prompt: 'Question' } });
  assert.equal(writes.length, 1);
  await assert.rejects(scoped.clientAgentRun.create({ data: { conversation: { connect: { id_organizationId: { id: 'conversation-a', organizationId: 'foreign' } } },
    requestedById: 'staff-a' } }), /unavailable in this workspace/);
  assert.equal(writes.length, 1);
});
test('agent parent reassignment and nested parent creation cannot cross tenants', async () => {
  const { scoped, writes } = fakeDb();
  await assert.rejects(scoped.clientAgentConversation.updateMany({ where: {}, data: { clientId: 'client-b' } }), /does not belong/);
  await assert.rejects(scoped.clientAgentRun.updateMany({ where: {}, data: { conversationId: 'conversation-b' } }), /does not belong/);
  await assert.rejects(scoped.clientAgentRun.create({ data: { conversation: { create: { title: 'Nested' } }, requestedById: 'staff-a' } }), /nested conversation creation/);
  assert.equal(writes.length, 0);
});
test('agent audit actions retain only exact identifiers and revision, never transcript or instructions', async () => {
  const rows = [];
  const db = { auditEvent: { create: async ({ data }) => { rows.push(data); return { id: 'audit-a', ...data }; } } };
  const actions = {
    'client_agent_conversation.created': { clientId: 'client-a', revision: 0 },
    'client_agent_conversation.archived': { clientId: 'client-a', revision: 1 },
    'client_agent_run.requested': { clientId: 'client-a', conversationId: 'conversation-a', runId: 'run-a' },
    'client_agent_run.cancelled': { clientId: 'client-a', conversationId: 'conversation-a', runId: 'run-a' },
  };
  for (const [action, metadata] of Object.entries(actions)) {
    assert.ok(AUDIT_EVENT_CATALOG[action]);
    const row = await recordAuditEvent(db, { organizationId: 'org-a', actorUserId: 'staff-a', actorType: 'USER',
      action, entityId: 'entity-a', metadata: { ...metadata, title: 'private title', prompt: 'private question', response: 'private response', instructions: 'private instructions' } });
    assert.deepEqual(row.metadata, metadata);
  }
  assert.equal(rows.length, 4); assert.doesNotMatch(JSON.stringify(rows), /private|prompt|response|instructions|title/);
});
test('run request domain event is strict, ID-only, versioned and usable by the transactional producer', async () => {
  const payload = { clientId: 'client-a', conversationId: 'conversation-a', runId: 'run-a', requestedById: 'staff-a' };
  assert.deepEqual(validateDomainEventPayload('client_agent.run_requested', payload), payload);
  for (const patch of [{ prompt: 'private' }, { response: 'private' }, { instructions: 'private' }, { requestedById: 'staff@example.invalid' }, { runId: '' }]) {
    assert.throws(() => validateDomainEventPayload('client_agent.run_requested', { ...payload, ...patch }), /Invalid/);
  }
  const store = outboxStore(); const tx = { domainEvent: store.domainEvent, $executeRaw: store.$executeRaw };
  const input = { organizationId: 'org-a', type: 'client_agent.run_requested', aggregateId: 'run-a',
    idempotencyKey: 'client-agent-run:run-a:requested', payload };
  const saved = await recordDomainEvent(tx, input);
  assert.equal(saved.event.aggregateType, 'client_agent_run'); assert.equal(saved.event.schemaVersion, 1);
  assert.equal((await recordDomainEvent(tx, input)).duplicate, true);
});
