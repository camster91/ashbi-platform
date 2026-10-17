import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { createClientAgentRunService, reviewClientAgentRun, readClientAgentRun, listClientAgentRunAttentionForQueue } from '../../services/client-agent-run.service.js';
import { readClientAgentConversation } from '../../services/client-agent-conversation.service.js';
import { createWorkspaceChatChannel, postWorkspaceChatMessage, setWorkspaceChatMember } from '../../services/workspace-chat.service.js';
import { installWorkspaceAccountManager, updateWorkspaceAccountManager, requestWorkspaceAccountManager } from '../../services/workspace-account-manager.service.js';
import { WORK_QUEUE_SOURCES, buildWorkQueue } from '../../services/work-queue.service.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('PostgreSQL own agent-run attention preserves audience, immutable outcome, concurrent review and filter-before-cap', {
  skip: !url && 'Disposable PostgreSQL is not configured; actual constraints await CI', timeout: 150_000,
}, async t => {
  assertDisposableDatabase({ ...process.env, NODE_ENV: 'test', DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = [];
  try {
    for (let i = 0; i < 2; i++) orgs.push(await raw.organization.create({ data: { name: 'Run attention fixture', slug: `run-attention-${randomUUID()}` } }));
    const org = orgs[0].id;
    const person = (role, organizationId = org) => raw.user.create({ data: { role, organizationId, name: 'Fixture', email: `${randomUUID()}@e2e.example.test`, password: randomUUID() } });
    const team = await person('TEAM'), admin = await person('ADMIN'), other = await person('TEAM'), foreign = await person('ADMIN', orgs[1].id);
    const client = await raw.client.create({ data: { organizationId: org, name: 'Client' } });
    const client2 = await raw.client.create({ data: { organizationId: org, name: 'Other client' } });
    const project = await raw.project.create({ data: { organizationId: org, clientId: client.id, name: 'Project' } });
    const db = createScopedPrisma(raw, org), source = WORK_QUEUE_SOURCES.find(row => row.key === 'agent_runs');
    const queue = (user = team, filters = {}) => buildWorkQueue(db, { user, filters, sources: [source] });
    const conversation = () => raw.clientAgentConversation.create({ data: { organizationId: org, clientId: client.id, title: 'PRIVATE CONVERSATION', createdById: team.id } });
    const doc = await conversation();
    const makeRun = (status, requestedById = team.id, conversationId = doc.id, id) => raw.clientAgentRun.create({ data: {
      ...(id ? { id } : {}), organizationId: org, conversationId, requestedById, status,
      idempotencyKey: randomUUID(), inputHash: 'a'.repeat(64), prompt: 'PRIVATE PROMPT',
      ...(status === 'RUNNING' ? { claimToken: randomUUID(), startedAt: new Date(), deadlineAt: new Date(Date.now() + 60000) } : {}),
      ...(['SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED'].includes(status) ? { finishedAt: new Date() } : {}),
      ...(status === 'SUCCEEDED' ? { response: 'PRIVATE ANSWER' } : {}),
    } });
    const failed = await makeRun('FAILED'), unknown = await makeRun('UNKNOWN');
    await makeRun('SUCCEEDED');await makeRun('CANCELLED');await makeRun('FAILED', other.id);
    const active = await makeRun('QUEUED');
    await t.test('only own failed/unknown runs project; record, route and status are not leaked or mutated', async () => {
      const q = await queue();assert.deepEqual(q.rows.map(row => row.id).sort(), [failed.id, unknown.id].sort());
      assert.equal((await queue(team, { owner: 'me' })).total, 2);assert.equal((await queue(team, { owner: 'everyone' })).total, 2);assert.equal((await queue(admin)).total, 0);
      assert.equal((await queue(team, { clientId: client2.id })).total, 0);assert.equal((await queue(team, { projectId: project.id })).total, 0);
      assert.doesNotMatch(JSON.stringify(q), /PRIVATE PROMPT|PRIVATE ANSWER|PRIVATE CONVERSATION/);
      await assert.rejects(reviewClientAgentRun(db, admin, client.id, doc.id, failed.id), { code: 'RECORD_NOT_FOUND' });
      await assert.rejects(reviewClientAgentRun(db, foreign, client.id, doc.id, failed.id));
      await assert.rejects(reviewClientAgentRun(db, team, client2.id, doc.id, failed.id), { code: 'RECORD_NOT_FOUND' });
      await assert.rejects(reviewClientAgentRun(db, team, client.id, doc.id, active.id), { code: 'RUN_NOT_REVIEWABLE' });
    });
    await t.test('concurrent requests converge, refresh persists and immutable terminal output remains untouched', async () => {
      const noAudit = createClientAgentRunService({ recordAudit: async () => null });
      await assert.rejects(noAudit.review(db, team, client.id, doc.id, failed.id), { code: 'RUN_AUDIT_UNAVAILABLE' });
      assert.equal(await raw.clientAgentRunReview.count({ where: { runId: failed.id } }), 0, 'audit failure rolls back the attention insert');
      const before = await raw.clientAgentRun.findUnique({ where: { id: unknown.id } });
      const results = await Promise.all([reviewClientAgentRun(db, team, client.id, doc.id, unknown.id), reviewClientAgentRun(db, team, client.id, doc.id, unknown.id)]);
      assert.equal(results[0].attentionReviewedAt.getTime(), results[1].attentionReviewedAt.getTime());
      assert.deepEqual(await raw.clientAgentRun.findUnique({ where: { id: unknown.id } }), before);
      assert.equal(await raw.clientAgentRunReview.count({ where: { runId: unknown.id } }), 1);
      assert.equal(await raw.auditEvent.count({ where: { organizationId: org, entityId: unknown.id, action: 'client_agent_run.reviewed' } }), 1);
      assert.equal((await readClientAgentRun(createScopedPrisma(raw, org), team, client.id, doc.id, unknown.id)).status, 'UNKNOWN');
      const reloaded = await readClientAgentConversation(db, team, client.id, doc.id);
      assert.ok(reloaded.runs.find(row => row.id === unknown.id).attentionReviewedAt);
      assert.equal((await queue()).total, 1);
      await assert.rejects(raw.clientAgentRunReview.update({ where: { runId: unknown.id }, data: { reviewedAt: new Date(Date.now() + 1000) } }));
      await assert.rejects(raw.clientAgentRun.update({ where: { id: unknown.id }, data: { status: 'FAILED' } }));
      await assert.rejects(raw.clientAgentRunReview.create({ data: { runId: failed.id, organizationId: orgs[1].id } }));
      await assert.rejects(raw.clientAgentRunReview.create({ data: { runId: active.id, organizationId: org } }));
    });
    await t.test('stored authority/parent changes suppress rows and deny acknowledgement', async () => {
      for (const data of [{ role: 'CLIENT' }, { isActive: false }]) {
        await raw.user.update({ where: { id: team.id }, data });
        await assert.rejects(listClientAgentRunAttentionForQueue(db, team), { code: 'ROLE_DENIED' });
        await assert.rejects(reviewClientAgentRun(db, team, client.id, doc.id, failed.id), { code: 'ROLE_DENIED' });
        await raw.user.update({ where: { id: team.id }, data: { role: 'TEAM', isActive: true } });
      }
      const revokedBetweenReads = { user: raw.user, $queryRaw: async (...args) => { await raw.user.update({ where: { id: team.id }, data: { isActive: false } });return raw.$queryRaw(...args); } };
      assert.equal((await listClientAgentRunAttentionForQueue(revokedBetweenReads, team)).items.length, 0);
      await raw.user.update({ where: { id: team.id }, data: { isActive: true } });
      await raw.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });assert.equal((await queue()).total, 0);
      await assert.rejects(reviewClientAgentRun(db, team, client.id, doc.id, failed.id));
      await raw.client.update({ where: { id: client.id }, data: { deletedAt: null } });
      await raw.clientAgentConversation.update({ where: { id: doc.id }, data: { archivedAt: new Date() } });assert.equal((await queue()).total, 0);
      await raw.clientAgentConversation.update({ where: { id: doc.id }, data: { archivedAt: null } });
    });
    await t.test('source-bound run obeys current membership, project-client pairing and project filter before cap', async () => {
      const profile = await raw.clientAgentProfile.create({ data: { organizationId: org, clientId: client.id, name: 'Fixture', createdById: admin.id, updatedById: admin.id, enabled: true, pluginIds: ['client-work'] } });
      const channel = (await createWorkspaceChatChannel(db, admin, { kind: 'PROJECT', projectId: project.id, name: 'PRIVATE CHANNEL', memberIds: [team.id] })).channel;
      let binding = (await installWorkspaceAccountManager(db, admin, channel.id, { profileId: profile.id })).binding;
      binding = (await updateWorkspaceAccountManager(db, admin, channel.id, binding.id, { revision: binding.revision, enabled: true })).binding;
      const message = (await postWorkspaceChatMessage(db, team, channel.id, { content: 'PRIVATE REQUEST', idempotencyKey: randomUUID() })).message;
      const invocation = (await requestWorkspaceAccountManager(db, team, channel.id, { bindingId: binding.id, sourceMessageId: message.id, idempotencyKey: randomUUID() })).invocation;
      await raw.$transaction(async tx => {
        await tx.workspaceAccountManagerInvocation.update({ where: { id: invocation.id }, data: { deliveryState: 'SUPPRESSED', deliveryCode: 'RUN_FAILED', suppressedAt: new Date() } });
        await tx.clientAgentRun.update({ where: { id: invocation.runId }, data: { status: 'FAILED', finishedAt: new Date() } });
      });
      const unrelatedIds = Array.from({ length: 105 }, (_, i) => `aaa-unrelated-${i}-${randomUUID()}`);
      await raw.clientAgentRun.createMany({ data: unrelatedIds.map(id => ({ id, organizationId: org, conversationId: doc.id,
        requestedById: team.id, status: 'FAILED', finishedAt: new Date(), idempotencyKey: randomUUID(), inputHash: 'a'.repeat(64), prompt: 'PRIVATE UNRELATED PROMPT' })) });
      const filtered = await queue(team, { projectId: project.id, clientId: client.id });assert.equal(filtered.total, 1);assert.equal(filtered.rows[0].id, invocation.runId);
      assert.deepEqual(filtered.truncatedSources, []);
      await raw.clientAgentRun.deleteMany({ where: { id: { in: unrelatedIds } } });
      await setWorkspaceChatMember(db, admin, channel.id, team.id, false);assert.equal((await queue(team, { projectId: project.id })).total, 0);
      await assert.rejects(reviewClientAgentRun(db, team, client.id, invocation.conversationId, invocation.runId), { code: 'RECORD_NOT_FOUND' });
      await setWorkspaceChatMember(db, admin, channel.id, team.id, true);
      await raw.project.update({ where: { id: project.id }, data: { clientId: client2.id } });assert.equal((await queue(team, { projectId: project.id })).total, 0);
      await assert.rejects(reviewClientAgentRun(db, team, client.id, invocation.conversationId, invocation.runId));
      await raw.project.update({ where: { id: project.id }, data: { clientId: client.id } });
      await raw.workspaceChatChannel.update({ where: { id: channel.id }, data: { archivedAt: new Date() } });assert.equal((await queue(team, { projectId: project.id })).total, 0);
      await raw.workspaceChatChannel.update({ where: { id: channel.id }, data: { archivedAt: null } });
      await reviewClientAgentRun(db, team, client.id, invocation.conversationId, invocation.runId);assert.equal((await queue(team, { projectId: project.id })).total, 0);
    });
    await t.test('101 sentinel is stable and run deletion cascades only its review', async () => {
      const bulk = [];
      for (let i = 0; i < 101; i++) bulk.push(await makeRun('FAILED', team.id, doc.id, `attention-${String(i).padStart(3, '0')}-${randomUUID()}`));
      // A different-client filter is applied before LIMIT, never after a capped private scan.
      assert.equal((await queue(team, { clientId: client2.id })).total, 0);
      const capped = await queue();assert.equal(capped.total, 100);assert.deepEqual(capped.truncatedSources, ['agent_runs']);
      await reviewClientAgentRun(db, team, client.id, doc.id, failed.id);
      await reviewClientAgentRun(db, team, client.id, doc.id, bulk[0].id);
      assert.equal((await queue()).total, 100);assert.deepEqual((await queue()).truncatedSources, []);
      await raw.clientAgentRun.delete({ where: { id: bulk[0].id } });
      assert.equal(await raw.clientAgentRunReview.count({ where: { runId: bulk[0].id } }), 0);
      assert.equal(await raw.clientAgentRunReview.count({ where: { runId: unknown.id } }), 1);
    });
  } finally {
    const ids = orgs.map(row => row.id);
    if (ids.length) {
      await raw.domainEvent.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.workspaceAccountManagerInvocation.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.clientAgentRun.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.clientAgentConversation.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.workspaceAccountManagerBinding.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.workspaceChatMessage.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.workspaceChatMember.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.workspaceChatChannel.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.clientAgentProfile.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.project.deleteMany({ where: { organizationId: { in: ids } } });await raw.client.deleteMany({ where: { organizationId: { in: ids } } });
      await raw.user.deleteMany({ where: { organizationId: { in: ids } } });
      if (await purgeFixtureAuditEvents(raw, { ids })) await raw.organization.deleteMany({ where: { id: { in: ids } } });
    }
    await raw.$disconnect();
  }
});
