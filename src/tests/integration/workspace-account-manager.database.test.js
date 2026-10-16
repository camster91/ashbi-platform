import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { runTenantJob } from '../../jobs/tenant-iteration.js';
import { processClientAgentRun } from '../../jobs/client-agent-run.js';
import { createWorkspaceChatChannel, postWorkspaceChatMessage, setWorkspaceChatMember } from '../../services/workspace-chat.service.js';
import { installWorkspaceAccountManager, updateWorkspaceAccountManager, requestWorkspaceAccountManager,
  listWorkspaceAccountManagerInvocations, readWorkspaceAccountManagerInvocation, getWorkspaceAccountManagerByIntent } from '../../services/workspace-account-manager.service.js';
import { listClientAgentConversations, readClientAgentConversation, archiveClientAgentConversation } from '../../services/client-agent-conversation.service.js';
import { readClientAgentRun, cancelClientAgentRun } from '../../services/client-agent-run.service.js';
const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('migrated workspace pilot source privacy, raw SQL integrity and provider-stub delivery lifecycle', {
  skip: !url && 'Disposable PostgreSQL is not configured', timeout: 150000,
}, async t => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const organizationId = 'workspace-pilot-'+randomUUID();
  try {
    await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Workspace pilot fixture' } });
    const actor = role => raw.user.create({ data: { organizationId, role, name: 'Pilot fixture', email: randomUUID()+'@e2e.example.test', password: randomUUID() } });
    const admin = await actor('ADMIN'), staff = await actor('TEAM'), outsider = await actor('ADMIN');
    const client = await raw.client.create({ data: { organizationId, name: 'Synthetic pilot client' } });
    const project = await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Synthetic pilot project' } });
    const profile = await raw.clientAgentProfile.create({ data: { organizationId, clientId: client.id, createdById: admin.id, updatedById: admin.id, name: 'Pilot profile', enabled: true, pluginIds: ['client-work'] } });
    const db = createScopedPrisma(raw, organizationId);
    const channel = (await createWorkspaceChatChannel(db, admin, { kind: 'PROJECT', name: 'Private fixture', projectId: project.id, memberIds: [staff.id] })).channel;
    let binding = (await installWorkspaceAccountManager(db, admin, channel.id, { profileId: profile.id })).binding;
    assert.equal(binding.enabled, false);
    binding = (await updateWorkspaceAccountManager(db, admin, channel.id, binding.id, { revision: binding.revision, enabled: true })).binding;
    const request = async () => {
      const source = (await postWorkspaceChatMessage(db, staff, channel.id, { content: 'One selected private source '+randomUUID(), idempotencyKey: randomUUID() })).message;
      const input = { bindingId: binding.id, sourceMessageId: source.id, idempotencyKey: randomUUID() };
      return { input, source, invocation: (await requestWorkspaceAccountManager(db, staff, channel.id, input)).invocation };
    };
    const process = (invocation, chat) => runTenantJob(raw, organizationId, scoped => processClientAgentRun(scoped, { organizationId, runId: invocation.runId }, { chat }));
    await t.test('one source/run/outbox on duplicate request, shared list excludes before pagination, outsider denied', async () => {
      const { input, invocation } = await request();
      assert.equal((await requestWorkspaceAccountManager(db, staff, channel.id, input)).invocation.id, invocation.id);
      assert.equal(await raw.workspaceAccountManagerInvocation.count({ where: { organizationId } }), 1);
      assert.equal(await raw.domainEvent.count({ where: { organizationId, aggregateId: invocation.runId } }), 1);
      assert.deepEqual((await listClientAgentConversations(db, outsider, client.id, { limit: 1 })).items, []);
      for (const operation of [
        () => listWorkspaceAccountManagerInvocations(db, outsider, channel.id),
        () => readWorkspaceAccountManagerInvocation(db, outsider, channel.id, invocation.id),
        () => readClientAgentConversation(db, outsider, client.id, invocation.conversationId),
        () => readClientAgentRun(db, outsider, client.id, invocation.conversationId, invocation.runId),
        () => getWorkspaceAccountManagerByIntent(db, outsider, channel.id, input.idempotencyKey),
      ]) await assert.rejects(operation(), { statusCode: 404 });
      let calls = 0;
      const chat = async options => { calls++;assert.deepEqual(JSON.parse(options.prompt).memorySnapshot.turns, []);return 'Typed private draft'; };
      await process(invocation, chat);await process(invocation, chat);assert.equal(calls, 1);
      const card = (await readWorkspaceAccountManagerInvocation(db, staff, channel.id, invocation.id)).invocation;
      assert.equal(card.deliveryState, 'DELIVERED');assert.equal(card.response, 'Typed private draft');
      assert.equal(await raw.workspaceChatMessage.count({ where: { channelId: channel.id } }), 1);
      await assert.rejects(raw.workspaceAccountManagerInvocation.update({ where: { id: card.id }, data: { sourceMessageId: 'forged' } }));
    });
    await t.test('membership revoked during provider latency suppresses answer and blocks retained transcript', async () => {
      const { invocation, input } = await request();
      const result = await process(invocation, async () => {
        await setWorkspaceChatMember(db, admin, channel.id, staff.id, false);
        return 'THIS PRIVATE LATE ANSWER MUST NEVER BE PERSISTED';
      });
      assert.equal(result.status, 'FAILED');
      const stored = await raw.clientAgentRun.findUnique({ where: { id: invocation.runId } });assert.equal(stored.response, null);
      assert.equal((await raw.workspaceAccountManagerInvocation.findUnique({ where: { id: invocation.id } })).deliveryState, 'SUPPRESSED');
      await assert.rejects(getWorkspaceAccountManagerByIntent(db, staff, channel.id, input.idempotencyKey), { statusCode: 404 });
      await assert.rejects(readClientAgentRun(db, staff, client.id, invocation.conversationId, invocation.runId), { statusCode: 404 });
      await setWorkspaceChatMember(db, admin, channel.id, staff.id, true);
    });
    await t.test('pause during provider latency suppresses; cancellation blocks late answer', async () => {
      const first = await request();
      await process(first.invocation, async () => {
        binding = (await updateWorkspaceAccountManager(db, admin, channel.id, binding.id, { revision: binding.revision, enabled: false })).binding;
        return 'Paused answer';
      });
      assert.equal((await raw.clientAgentRun.findUnique({ where: { id: first.invocation.runId } })).response, null);
      binding = (await updateWorkspaceAccountManager(db, admin, channel.id, binding.id, { revision: binding.revision, enabled: true })).binding;
      const second = await request();
      assert.equal((await process(second.invocation, async () => {
        await cancelClientAgentRun(db, staff, client.id, second.invocation.conversationId, second.invocation.runId);
        return 'Cancelled answer';
      })).status, 'CANCELLED');
      assert.equal((await raw.clientAgentRun.findUnique({ where: { id: second.invocation.runId } })).response, null);
    });
    await t.test('private conversation archive during inference suppresses paired delivery and answer', async () => {
      const { invocation } = await request();
      const document = await raw.clientAgentConversation.findUnique({ where: { id: invocation.conversationId } });
      await process(invocation, async () => {
        await archiveClientAgentConversation(db, staff, client.id, invocation.conversationId, { revision: document.revision });
        return 'Archived late answer';
      });
      assert.equal((await raw.clientAgentRun.findUnique({ where: { id: invocation.runId } })).response, null);
      assert.equal((await raw.workspaceAccountManagerInvocation.findUnique({ where: { id: invocation.id } })).deliveryState, 'SUPPRESSED');
      assert.equal(await raw.auditEvent.count({ where: { organizationId, entityId: invocation.runId, action: 'workspace_agent.suppressed' } }), 1);
    });
    await t.test('raw SQL cannot orphan a source run or remap source audience', async () => {
      const { invocation } = await request();
      await assert.rejects(raw.clientAgentConversation.update({ where: { id: invocation.conversationId }, data: { sourceChannelId: null, sourceBindingId: null } }));
      await assert.rejects(raw.$transaction(async tx => {
        const conversation = await tx.clientAgentConversation.create({ data: { organizationId, clientId: client.id, createdById: staff.id, title: 'Orphan fixture', sourceChannelId: channel.id, sourceBindingId: binding.id } });
        await tx.clientAgentRun.create({ data: { organizationId, conversationId: conversation.id, requestedById: staff.id, prompt: 'Orphan', inputHash: 'a'.repeat(64), idempotencyKey: randomUUID(), profileRevision: profile.revision } });
      }));
    });
  } finally {
    try {
      await raw.domainEvent.deleteMany({ where: { organizationId } });
      await raw.workspaceAccountManagerInvocation.deleteMany({ where: { organizationId } });
      await raw.clientAgentRun.deleteMany({ where: { organizationId } });
      await raw.clientAgentConversation.deleteMany({ where: { organizationId } });
      await raw.workspaceAccountManagerBinding.deleteMany({ where: { organizationId } });
      await raw.workspaceChatMessage.deleteMany({ where: { organizationId } });
      await raw.workspaceChatMember.deleteMany({ where: { organizationId } });
      await raw.workspaceChatChannel.deleteMany({ where: { organizationId } });
      await raw.clientAgentProfile.deleteMany({ where: { organizationId } });
      await raw.project.deleteMany({ where: { organizationId } });await raw.client.deleteMany({ where: { organizationId } });
      await raw.user.deleteMany({ where: { organizationId } });
      if (await purgeFixtureAuditEvents(raw, { ids: [organizationId] })) await raw.organization.delete({ where: { id: organizationId } });
    } finally { await raw.$disconnect(); }
  }
});
