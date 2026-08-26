import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as pipeline from '../../services/dealPipeline.service.js';
import * as schemas from '../../validators/schemas.js';

function proposalHarness(overrides = {}) {
  const calls = { created: [], reads: [] };
  const deal = {
    id: 'deal-1',
    title: 'Packaging system',
    value: 12000,
    currency: 'CAD',
    clientId: 'client-1',
    proposal: null,
    ...overrides,
  };
  const prisma = {
    pipelineDeal: {
      findFirst: async (args) => {
        calls.reads.push(args);
        return deal;
      },
    },
    proposal: {
      create: async (args) => {
        calls.created.push(args);
        return { id: 'proposal-1', status: 'DRAFT', ...args.data };
      },
      findFirst: async () => ({ id: 'proposal-race', status: 'DRAFT' }),
    },
  };
  return { calls, deal, prisma };
}

test('deal proposal draft input requires human-entered scope and accepts no currency override', () => {
  assert.equal(typeof schemas.dealProposalDraftSchema?.safeParse, 'function');
  const base = {
    title: 'Packaging system proposal',
    lineItems: [{ description: 'Reviewed packaging scope', quantity: 1, unitPrice: 12000 }],
  };
  assert.equal(schemas.dealProposalDraftSchema.safeParse(base).success, true);
  assert.equal(schemas.dealProposalDraftSchema.safeParse({ title: base.title, lineItems: [] }).success, false);
  assert.equal(schemas.dealProposalDraftSchema.safeParse({ ...base, currency: 'USD' }).success, false);
});

test('manual proposal creation requires an explicit CAD or USD currency', () => {
  const base = {
    clientId: 'cm12345678901234567890123',
    title: 'Packaging proposal',
    lineItems: [{ description: 'Reviewed scope', quantity: 1, unitPrice: 12000 }],
  };
  assert.equal(schemas.proposalCreateSchema.safeParse(base).success, false);
  assert.equal(schemas.proposalCreateSchema.safeParse({ ...base, currency: 'EUR' }).success, false);
  assert.equal(schemas.proposalCreateSchema.safeParse({ ...base, currency: 'CAD' }).success, true);
  assert.equal(schemas.proposalCreateSchema.safeParse({ ...base, currency: 'USD' }).success, true);
});

test('draft proposal updates retain reviewed line items, discount, and currency', () => {
  const input = {
    lineItems: [{ description: 'Reviewed scope', quantity: 2, unitPrice: 3000 }],
    discount: 500,
    currency: 'CAD',
  };
  const result = schemas.proposalUpdateSchema.safeParse(input);
  assert.equal(result.success, true);
  assert.deepEqual(result.data, input);
});

test('a deal creates one unsent proposal draft with the verified deal client and currency', async () => {
  assert.equal(typeof pipeline.createDraftProposalFromDeal, 'function');
  const { calls, prisma } = proposalHarness();
  const result = await pipeline.createDraftProposalFromDeal(prisma, 'deal-1', 'user-1', {
    title: 'Packaging system proposal',
    notes: 'Draft only. Human review required.',
    lineItems: [{ description: 'Reviewed packaging scope', quantity: 1, unitPrice: 12000 }],
  });

  assert.equal(result.idempotent, false);
  assert.equal(result.proposal.status, 'DRAFT');
  assert.deepEqual(calls.created[0].data, {
    dealId: 'deal-1',
    clientId: 'client-1',
    createdById: 'user-1',
    title: 'Packaging system proposal',
    notes: 'Draft only. Human review required.',
    validUntil: null,
    currency: 'CAD',
    subtotal: 12000,
    discount: 0,
    total: 12000,
    lineItems: {
      create: [{ description: 'Reviewed packaging scope', quantity: 1, unitPrice: 12000, total: 12000 }],
    },
  });
  assert.equal('status' in calls.created[0].data, false);
});

test('replaying deal proposal promotion returns the existing draft without a duplicate write', async () => {
  assert.equal(typeof pipeline.createDraftProposalFromDeal, 'function');
  const existing = { id: 'proposal-existing', status: 'DRAFT', currency: 'USD' };
  const { calls, prisma } = proposalHarness({ currency: 'USD', proposal: existing });

  const result = await pipeline.createDraftProposalFromDeal(prisma, 'deal-1', 'user-1', {
    title: 'Ignored replay title',
    lineItems: [{ description: 'Ignored replay scope', quantity: 1, unitPrice: 5000 }],
  });

  assert.deepEqual(result, { proposal: existing, idempotent: true });
  assert.equal(calls.created.length, 0);
});

test('a legacy deal with unassigned currency cannot create a proposal', async () => {
  assert.equal(typeof pipeline.createDraftProposalFromDeal, 'function');
  const { calls, prisma } = proposalHarness({ currency: null });

  await assert.rejects(
    pipeline.createDraftProposalFromDeal(prisma, 'deal-1', 'user-1', {
      title: 'Proposal',
      lineItems: [{ description: 'Reviewed scope', quantity: 1, unitPrice: 5000 }],
    }),
    (error) => error.code === 'DEAL_CURRENCY_UNASSIGNED' && error.statusCode === 409,
  );
  assert.equal(calls.created.length, 0);
});

test('proposal and invoice persistence preserve deal currency without a USD fallback', () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
  const proposalModel = schema.match(/model Proposal \{[\s\S]*?\n\}/)?.[0] || '';
  const dealModel = schema.match(/model PipelineDeal \{[\s\S]*?\n\}/)?.[0] || '';
  const migrationPath = path.join(process.cwd(), 'prisma', 'migrations', '20260826235900_deal_proposal_currency', 'migration.sql');
  const routes = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'pipeline.routes.js'), 'utf8');
  const invoices = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'invoice.routes.js'), 'utf8');
  const portal = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'portal.routes.js'), 'utf8');

  assert.match(proposalModel, /currency\s+String\?/);
  assert.match(proposalModel, /dealId\s+String\?\s+@unique/);
  assert.match(dealModel, /proposal\s+Proposal\?/);
  assert.equal(fs.existsSync(migrationPath), true);
  assert.match(routes, /createDraftProposalFromDeal\(request\.prisma, id, request\.user\.id, request\.body\)/);
  assert.match(invoices, /\['CAD', 'USD'\]\.includes\(proposal\.currency\)/);
  assert.match(invoices, /currency:\s*proposal\.currency/);
  assert.doesNotMatch(invoices.slice(invoices.indexOf("fastify.post('/from-proposal/:proposalId'"), invoices.indexOf('// ─── GET /client/:viewToken')), /fastify\.prisma/);
  assert.match(portal, /currency:\s*proposal\.currency/);
});
