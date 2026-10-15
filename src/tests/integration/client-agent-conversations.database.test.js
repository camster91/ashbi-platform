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
import { permanentlyDeleteTrashedItem } from '../../services/trash-purge.service.js';
import { createClientAgentConversation, listClientAgentConversations,
  readClientAgentConversation, archiveClientAgentConversation } from '../../services/client-agent-conversation.service.js';
import { startClientAgentRun, readClientAgentRun, getClientAgentRunByIntent,
  cancelClientAgentRun } from '../../services/client-agent-run.service.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('migrated client agent conversations preserve tenant, intent, outbox and permanent-claim boundaries', {
  skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120_000,
}, async t => {
  // This suite never inherits DATABASE_URL or connects to a shared database.
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(suffix => `agent-conversations-${suffix}-${randomUUID()}`);
  try {
    for (const id of orgs) await raw.organization.create({ data: { id, slug: id, name: 'Agent conversation fixture' } });
    const user = (role, organizationId = orgs[0]) => raw.user.create({ data: {
      organizationId, role, name: 'Agent fixture', email: `${randomUUID()}@e2e.example.test`, password: randomUUID(),
    } });
    const admin = await user('ADMIN'), staff = await user('TEAM'), colleague = await user('TEAM');
    const portal = await user('CLIENT'), foreign = await user('ADMIN', orgs[1]);
    const client = await raw.client.create({ data: { organizationId: orgs[0], name: 'Agent fixture client' } });
    const foreignClient = await raw.client.create({ data: { organizationId: orgs[1], name: 'Foreign fixture client' } });
    await raw.project.create({ data: { organizationId: orgs[0], clientId: client.id, name: 'Shareable fixture project' } });
    await raw.clientAgentProfile.create({ data: { organizationId: orgs[0], clientId: client.id,
      createdById: admin.id, updatedById: admin.id, name: 'Fixture manager', enabled: true, pluginIds: ['client-work'] } });
    const scoped = createScopedPrisma(raw, orgs[0]);
    const foreignScoped = createScopedPrisma(raw, orgs[1]);
    const conversation = () => createClientAgentConversation(scoped, staff, client.id, { title: 'Shared fixture conversation' });
    const input = () => ({ question: 'Which projects are active?', idempotencyKey: randomUUID() });
    const start = (document, fields = input(), actor = staff) => startClientAgentRun(scoped, actor, client.id, document.id, fields);
    const process = (run, chat) => runTenantJob(raw, orgs[0], db => processClientAgentRun(db,
      { organizationId: orgs[0], runId: run.id }, { chat }));

    await t.test('staff share transcripts; portal, foreign tenant and current demotion are denied', async () => {
      const doc = await conversation();
      assert.equal((await readClientAgentConversation(scoped, colleague, client.id, doc.id)).conversation.id, doc.id);
      assert.equal((await listClientAgentConversations(scoped, colleague, client.id)).scope, 'SHARED_STAFF');
      await assert.rejects(readClientAgentConversation(scoped, portal, client.id, doc.id), { statusCode: 403 });
      await assert.rejects(readClientAgentConversation(foreignScoped, foreign, client.id, doc.id), { statusCode: 404 });
      await raw.user.update({ where: { id: colleague.id }, data: { role: 'CLIENT' } });
      try {
        await assert.rejects(readClientAgentConversation(scoped, colleague, client.id, doc.id), { statusCode: 403 });
      } finally { await raw.user.update({ where: { id: colleague.id }, data: { role: 'TEAM' } }); }
    });

    await t.test('database rejects foreign client, creator, conversation and requester bindings', async () => {
      const doc = await conversation();
      const base = { organizationId: orgs[0], clientId: client.id, title: 'Forged fixture', createdById: staff.id };
      await assert.rejects(raw.clientAgentConversation.create({ data: { ...base, clientId: foreignClient.id } }));
      await assert.rejects(raw.clientAgentConversation.create({ data: { ...base, createdById: foreign.id } }));
      const run = { organizationId: orgs[0], conversationId: doc.id, requestedById: staff.id,
        idempotencyKey: randomUUID(), inputHash: 'a'.repeat(64), prompt: 'Fixture question', status: 'QUEUED' };
      await assert.rejects(raw.clientAgentRun.create({ data: { ...run, organizationId: orgs[1], requestedById: foreign.id } }));
      await assert.rejects(raw.clientAgentRun.create({ data: { ...run, requestedById: foreign.id } }));
    });

    await t.test('concurrent intent creates one run, one outbox fact and one audit; changed payload conflicts', async () => {
      const doc = await conversation(), fields = input();
      const race = await Promise.allSettled([start(doc, fields), start(doc, fields)]);
      const completed = race.filter(item => item.status === 'fulfilled').map(item => item.value);
      assert.ok(completed.length >= 1, 'one producer commits');
      for (const item of race.filter(item => item.status === 'rejected')) assert.equal(item.reason.statusCode, 409);
      const saved = await start(doc, fields);
      assert.ok(completed.every(item => item.id === saved.id));
      assert.equal(await raw.clientAgentRun.count({ where: { conversationId: doc.id } }), 1);
      assert.equal(await raw.domainEvent.count({ where: { organizationId: orgs[0], aggregateId: saved.id, type: 'client_agent.run_requested' } }), 1);
      assert.equal(await raw.auditEvent.count({ where: { organizationId: orgs[0], entityId: saved.id, action: 'client_agent_run.requested' } }), 1);
      const fact = await raw.domainEvent.findFirst({ where: { organizationId: orgs[0], aggregateId: saved.id } });
      assert.doesNotMatch(JSON.stringify(fact.payload), /Which projects|question|prompt|response/);
      await assert.rejects(start(doc, { ...fields, question: 'A changed question' }), { statusCode: 409 });
      await assert.rejects(start(doc), { statusCode: 409 });
      await assert.rejects(raw.clientAgentRun.create({ data: { organizationId: orgs[0], conversationId: doc.id,
        requestedById: staff.id, idempotencyKey: randomUUID(), inputHash: 'b'.repeat(64), prompt: 'Second active run', status: 'QUEUED' } }));
      assert.equal((await getClientAgentRunByIntent(scoped, staff, client.id, doc.id, fields.idempotencyKey)).id, saved.id);
      await assert.rejects(getClientAgentRunByIntent(scoped, colleague, client.id, doc.id, fields.idempotencyKey), { statusCode: 404 });
      assert.equal((await readClientAgentRun(scoped, colleague, client.id, doc.id, saved.id)).id, saved.id);
      await assert.rejects(cancelClientAgentRun(scoped, colleague, client.id, doc.id, saved.id), { statusCode: 403 });
      assert.equal((await cancelClientAgentRun(scoped, staff, client.id, doc.id, saved.id)).status, 'CANCELLED');
    });

    await t.test('duplicate worker attempts infer once and persist one shared response', async () => {
      const doc = await conversation(), saved = await start(doc);
      let calls = 0;
      const chat = async options => {
        calls++; assert.equal(options.feature, 'client_agent_run');
        assert.equal(JSON.parse(options.prompt).snapshot.client.id, client.id);
        return 'The shareable fixture project is active.';
      };
      await Promise.all([process(saved, chat), process(saved, chat)]);
      await process(saved, chat);
      assert.equal(calls, 1);
      const stored = await readClientAgentRun(scoped, colleague, client.id, doc.id, saved.id);
      assert.equal(stored.status, 'SUCCEEDED'); assert.equal(stored.response, 'The shareable fixture project is active.');
    });

    await t.test('administrator cancellation while inference runs blocks late settlement', async () => {
      const doc = await conversation(), saved = await start(doc);
      const outcome = await process(saved, async () => {
        await cancelClientAgentRun(scoped, admin, client.id, doc.id, saved.id);
        return 'This late response must not be saved';
      });
      assert.equal(outcome.status, 'CANCELLED');
      const stored = await raw.clientAgentRun.findUnique({ where: { id: saved.id } });
      assert.equal(stored.status, 'CANCELLED'); assert.equal(stored.response, null);
      assert.equal(stored.claimToken, null);
    });

    await t.test('archiving, profile pause and staff revocation before claim prevent dispatch', async () => {
      for (const mode of ['archive', 'pause', 'revoke']) {
        const doc = await conversation(), saved = await start(doc);
        if (mode === 'archive') await archiveClientAgentConversation(scoped, staff, client.id, doc.id, { revision: doc.revision });
        if (mode === 'pause') await raw.clientAgentProfile.updateMany({ where: { organizationId: orgs[0], clientId: client.id }, data: { enabled: false } });
        if (mode === 'revoke') await raw.user.update({ where: { id: staff.id }, data: { isActive: false } });
        let calls = 0;
        try {
          const outcome = await process(saved, async () => { calls++; return 'Must not dispatch'; });
          assert.equal(outcome.status, 'FAILED'); assert.equal(calls, 0);
        } finally {
          if (mode === 'pause') await raw.clientAgentProfile.updateMany({ where: { organizationId: orgs[0], clientId: client.id }, data: { enabled: true } });
          if (mode === 'revoke') await raw.user.update({ where: { id: staff.id }, data: { isActive: true } });
        }
      }
    });

    await t.test('ambiguous dispatch outcome stays UNKNOWN and replay never spends again', async () => {
      const doc = await conversation(), saved = await start(doc);
      let calls = 0;
      const chat = async () => { calls++; throw Error('Private ambiguous upstream failure'); };
      assert.equal((await process(saved, chat)).status, 'UNKNOWN');
      assert.equal((await process(saved, chat)).status, 'UNKNOWN'); assert.equal(calls, 1);
      const stored = await raw.clientAgentRun.findUnique({ where: { id: saved.id } });
      assert.equal(stored.errorCode, 'RUN_PROVIDER_OUTCOME_UNKNOWN'); assert.equal(stored.response, null);
      assert.doesNotMatch(JSON.stringify(stored), /Private ambiguous/);
    });

    await t.test('explicit permanent client deletion removes its active and archived conversations and runs', async () => {
      const purgeClient = await raw.client.create({ data: { organizationId: orgs[0], name: 'Client purge fixture' } });
      await raw.clientAgentProfile.create({ data: { organizationId: orgs[0], clientId: purgeClient.id,
        createdById: admin.id, updatedById: admin.id, name: 'Purge fixture manager', enabled: true, pluginIds: ['client-work'] } });
      const createForPurge = title => createClientAgentConversation(scoped, staff, purgeClient.id, { title });
      const active = await createForPurge('Active purge fixture');
      const archived = await createForPurge('Archived purge fixture');
      const queued = await startClientAgentRun(scoped, staff, purgeClient.id, active.id, input());
      const cancelled = await startClientAgentRun(scoped, staff, purgeClient.id, archived.id, input());
      await cancelClientAgentRun(scoped, staff, purgeClient.id, archived.id, cancelled.id);
      await archiveClientAgentConversation(scoped, staff, purgeClient.id, archived.id, { revision: archived.revision });
      const conversationIds = [active.id, archived.id], runIds = [queued.id, cancelled.id];
      const otherConversationIds = (await raw.clientAgentConversation.findMany({
        where: { organizationId: orgs[0], clientId: client.id }, select: { id: true }, orderBy: { id: 'asc' },
      })).map(row => row.id);
      const deletedAt = new Date();
      await raw.client.update({ where: { id: purgeClient.id }, data: { deletedAt } });
      const ledger = await raw.trashedItem.create({ data: { organizationId: orgs[0], entity: 'CLIENT',
        recordId: purgeClient.id, data: { id: purgeClient.id }, deletedAt,
        expiresAt: new Date(+deletedAt + 30 * 24 * 60 * 60 * 1000) } });
      // A reversible trash operation retains transcripts; only the existing
      // explicit permanent-delete transaction removes the complete chain.
      assert.equal(await raw.clientAgentConversation.count({ where: { id: { in: conversationIds } } }), 2);
      assert.equal(await raw.clientAgentRun.count({ where: { id: { in: runIds } } }), 2);
      const result = await permanentlyDeleteTrashedItem({ scopedPrisma: scoped, rawPrisma: raw, trashId: ledger.id });
      assert.equal(result.deleted, true);
      assert.equal(await raw.client.count({ where: { id: purgeClient.id } }), 0);
      assert.equal(await raw.trashedItem.count({ where: { id: ledger.id } }), 0);
      assert.equal(await raw.clientAgentConversation.count({ where: { id: { in: conversationIds } } }), 0);
      assert.equal(await raw.clientAgentRun.count({ where: { id: { in: runIds } } }), 0);
      assert.deepEqual((await raw.clientAgentConversation.findMany({ where: { organizationId: orgs[0], clientId: client.id },
        select: { id: true }, orderBy: { id: 'asc' } })).map(row => row.id), otherConversationIds);
      assert.equal(await raw.client.count({ where: { id: foreignClient.id, organizationId: orgs[1] } }), 1);
      assert.equal(await raw.user.count({ where: { id: staff.id, organizationId: orgs[0] } }), 1);
    });
  } finally {
    try {
      await raw.domainEvent.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.clientAgentRun.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.clientAgentConversation.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.clientAgentProfile.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
      if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    } finally { await raw.$disconnect(); }
  }
});
