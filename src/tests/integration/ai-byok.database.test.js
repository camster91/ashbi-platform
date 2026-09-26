// Real-database proof for organization BYOK AI connections (#413): tenant
// isolation through the scoped Prisma proxy, the CHECK constraints the Prisma
// schema cannot express, and metering + budget audit through the governance
// module. Runs only when TENANT_INTEGRATION_DATABASE_URL points at a
// disposable, fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'integration-credentials-key';

const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { createAiGovernance, createByokProvider, computeMonthToDateUsage } = await import('../../ai/governance.js');
const { AiBudgetExceededError } = await import('../../ai/errors.js');
const { encrypt } = await import('../../utils/crypto.js');
const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const KEY = 'sk-integration-secret-key-4242';

test('BYOK connections stay inside their tenant and calls are metered against the budget', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const orgA = `byok-org-a-${suffix}`;
  const orgB = `byok-org-b-${suffix}`;
  const previousPrices = process.env.AI_MODEL_PRICES;
  process.env.AI_MODEL_PRICES = JSON.stringify({ 'model-a': { input: 1_000_000, output: 1_000_000 } }); // 1 cent per token

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'BYOK Tenant A', slug: `byok-a-${suffix}` },
      { id: orgB, name: 'BYOK Tenant B', slug: `byok-b-${suffix}` },
    ] });
    const tenantA = createScopedPrisma(raw, orgA);
    const tenantB = createScopedPrisma(raw, orgB);

    // A scoped write cannot forge another tenant's organizationId.
    const connection = await tenantA.aiProviderConnection.create({ data: {
      organizationId: orgB, baseUrl: 'https://llm.example.com', encryptedApiKey: encrypt(KEY), keyLast4: '4242',
      allowedModels: ['model-a'], defaultModel: 'model-a', monthlyBudgetCents: 3,
    } });
    assert.equal(connection.organizationId, orgA);
    assert.equal(connection.status, 'active');

    // Organization B cannot see or change it.
    assert.equal(await tenantB.aiProviderConnection.findFirst({ where: { id: connection.id } }), null);
    await assert.rejects(tenantB.aiProviderConnection.update({ where: { organizationId: orgA }, data: { encryptedApiKey: null, status: 'revoked' } }));
    assert.equal((await raw.aiProviderConnection.findUnique({ where: { id: connection.id } })).status, 'active');
    // Nor attach usage to A's connection.
    await assert.rejects(tenantB.aiUsageRecord.create({ data: { connectionId: connection.id, model: 'model-a', success: true } }), /Tenancy Error/);

    // Constraints the Prisma schema cannot express.
    await assert.rejects(raw.aiProviderConnection.create({ data: {
      organizationId: orgB, baseUrl: 'https://x.example.com', defaultModel: 'm', monthlyBudgetCents: 1,
    } }), /key_state_check/);
    await assert.rejects(raw.aiProviderConnection.create({ data: {
      organizationId: orgB, baseUrl: 'https://x.example.com', defaultModel: 'm', monthlyBudgetCents: 1, status: 'paused', encryptedApiKey: 'v1:x',
    } }), /check constraint/);
    // One connection per organization.
    await assert.rejects(raw.aiProviderConnection.create({ data: {
      organizationId: orgA, baseUrl: 'https://x.example.com', defaultModel: 'm', monthlyBudgetCents: 1, encryptedApiKey: 'v1:x',
    } }), /Unique constraint|P2002/);

    // Governance end to end: two metered calls (2 cents each), then the budget stops the third.
    const requests = [];
    const governance = createAiGovernance({
      prisma: raw,
      getContext: () => ({ organizationId: orgA, requestId: 'req-int', feature: '/api/ai/ask' }),
      createProvider: (options) => createByokProvider({
        ...options,
        isProduction: false,
        fetchImpl: async (url, init) => {
          requests.push({ url, authorization: init.headers.Authorization });
          return { ok: true, status: 200, json: async () => ({ model: 'model-a', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
        },
      }),
      platformProvider: () => { throw new Error('platform provider must not be used'); },
    });
    assert.equal(await governance.chat({ prompt: 'one' }), 'ok');
    assert.equal(await governance.chat({ prompt: 'two' }), 'ok');
    await assert.rejects(governance.chat({ prompt: 'three' }), AiBudgetExceededError);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].authorization, `Bearer ${KEY}`);

    const usage = await computeMonthToDateUsage(tenantA, orgA);
    assert.equal(usage.calls, 2);
    assert.equal(usage.spentCents, 4);
    assert.equal((await computeMonthToDateUsage(tenantB, orgB)).calls, 0);
    assert.equal(await tenantB.aiUsageRecord.count({}), 0);

    const events = await raw.auditEvent.findMany({ where: { organizationId: orgA }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(events.map((event) => event.action), ['ai.budget_alert', 'ai.budget_exceeded']);
    assert.equal(JSON.stringify(events).includes(KEY), false);
  } finally {
    if (previousPrices === undefined) delete process.env.AI_MODEL_PRICES;
    else process.env.AI_MODEL_PRICES = previousPrices;
    if (await purgeFixtureAuditEvents(raw, { ids: [orgA, orgB] })) {
      // Connections and usage records cascade with the organization.
      await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await raw.$disconnect();
  }
});
