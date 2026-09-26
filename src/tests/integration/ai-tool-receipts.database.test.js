// Real-database proof for governed AI tool receipts (#413 slice 2,
// docs/ai-tool-registry.md): the executor through the tenant proxy, the
// receipt-immutability trigger and the CHECK constraints the Prisma schema
// cannot express. Runs only when TENANT_INTEGRATION_DATABASE_URL points at a
// disposable, fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { createToolExecutor } = await import('../../ai/tools/executor.js');
const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

test('AI tool actions stay in their tenant and receipts are immutable once terminal', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const orgA = `tool-org-a-${suffix}`;
  const orgB = `tool-org-b-${suffix}`;
  const executor = createToolExecutor({ governance: { assertAllowed: async () => {} }, logger: quiet });

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Tool Tenant A', slug: `tool-a-${suffix}` },
      { id: orgB, name: 'Tool Tenant B', slug: `tool-b-${suffix}` },
    ] });
    const users = {};
    for (const [key, org, role] of [['adminA', orgA, 'ADMIN'], ['teamA', orgA, 'TEAM'], ['adminB', orgB, 'ADMIN']]) {
      users[key] = await raw.user.create({ data: { organizationId: org, email: `${key}-${suffix}@example.com`, name: key, password: 'x', role } });
    }
    const clientA = await raw.client.create({ data: { organizationId: orgA, name: 'Client A' } });
    const clientB = await raw.client.create({ data: { organizationId: orgB, name: 'Client B' } });
    const projectA = await raw.project.create({ data: { organizationId: orgA, clientId: clientA.id, name: 'Website A' } });
    const projectB = await raw.project.create({ data: { organizationId: orgB, clientId: clientB.id, name: 'Website B' } });

    const ctx = (key) => ({
      prisma: createScopedPrisma(raw, users[key].organizationId),
      user: { id: users[key].id, organizationId: users[key].organizationId, role: users[key].role },
      requestId: `req-${key}`,
    });

    // Another tenant's project is not found; nothing is stored.
    await assert.rejects(
      executor.invoke(ctx('teamA'), { tool: 'create_task', input: { projectId: projectB.id, title: 'x' }, idempotencyKey: 'int-cross-0001' }),
      { code: 'RECORD_NOT_FOUND' },
    );

    const { action } = await executor.invoke(ctx('teamA'), {
      tool: 'create_task', input: { projectId: projectA.id, title: 'Integration task' }, idempotencyKey: 'int-task-0001', source: 'assistant',
    });
    assert.equal(action.organizationId, orgA);
    assert.equal(action.status, 'PENDING_CONFIRMATION');
    assert.deepEqual(action.inputScope, { projectId: projectA.id });

    // Tenant B cannot see or approve it.
    await assert.rejects(executor.approve(ctx('adminB'), action.id), { code: 'NOT_FOUND' });

    const { action: receipt } = await executor.approve(ctx('adminA'), action.id, { reauthenticated: true });
    assert.equal(receipt.status, 'EXECUTED');
    assert.equal(receipt.outcome, 'succeeded');
    assert.equal(receipt.approverId, users.adminA.id);
    const task = await raw.task.findUnique({ where: { id: receipt.result.taskId } });
    assert.equal(task.projectId, projectA.id);

    // The receipt can no longer be rewritten by any role.
    await assert.rejects(
      raw.aiBridgeAction.update({ where: { id: action.id }, data: { approverId: 'someone-else' } }),
      /immutable/,
    );
    await assert.rejects(
      raw.$executeRawUnsafe('UPDATE "ai_bridge_actions" SET "status" = \'PENDING_CONFIRMATION\' WHERE "id" = $1', action.id),
      /immutable/,
    );

    // Closed vocabularies.
    const base = {
      organizationId: orgA, userId: users.teamA.id, action: 'create_task', input: {}, inputHash: 'h', preview: {},
      expiresAt: new Date(Date.now() + 60_000),
    };
    await assert.rejects(raw.aiBridgeAction.create({ data: { ...base, idempotencyKey: 'int-bad-status', status: 'DONE' } }), /status_check|check constraint/);
    await assert.rejects(raw.aiBridgeAction.create({ data: { ...base, idempotencyKey: 'int-bad-outcome', outcome: 'maybe' } }), /outcome_check|check constraint/);
    await assert.rejects(raw.aiBridgeAction.create({ data: { ...base, idempotencyKey: 'int-bad-source', source: 'model' } }), /source_check|check constraint/);

    const events = await raw.auditEvent.findMany({ where: { organizationId: orgA }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(events.map((event) => event.action), ['ai.tool_denied', 'ai.tool_prepared', 'ai.tool_approved', 'ai.tool_executed']);
    const deniedB = await raw.auditEvent.findMany({ where: { organizationId: orgB } });
    assert.equal(deniedB.length, 0, 'the refused approval by B is not an event about A, and has no action row in B');
  } finally {
    await raw.task.deleteMany({ where: { project: { organizationId: { in: [orgA, orgB] } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    // Deleting users cascades their actions (the trigger only blocks updates).
    await raw.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    if (await purgeFixtureAuditEvents(raw, { ids: [orgA, orgB] })) {
      await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await raw.$disconnect();
  }
});
