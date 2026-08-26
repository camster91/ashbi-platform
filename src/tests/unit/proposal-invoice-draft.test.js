import test from 'node:test';
import assert from 'node:assert/strict';
import * as schemas from '../../validators/schemas.js';

const service = await import('../../services/proposalInvoice.service.js').catch(() => ({}));

function invoiceHarness(overrides = {}) {
  const calls = { created: [], reads: [], invoiceNumbers: 0 };
  const proposal = {
    id: 'proposal-1',
    title: 'Packaging system',
    status: 'APPROVED',
    currency: 'CAD',
    clientId: 'client-1',
    projectId: 'project-1',
    discount: 100,
    lineItems: [
      { description: 'Packaging design', quantity: 1, unitPrice: 1000, total: 1000 },
    ],
    ...overrides,
  };
  const prisma = {
    proposal: {
      findUnique: async (args) => {
        calls.reads.push({ model: 'proposal', args });
        return proposal;
      },
    },
    invoice: {
      findUnique: async (args) => {
        calls.reads.push({ model: 'invoice', args });
        return null;
      },
      create: async (args) => {
        calls.created.push(args);
        return { id: 'invoice-1', status: 'DRAFT', ...args.data };
      },
    },
  };
  const invoiceNumberFactory = async () => {
    calls.invoiceNumbers += 1;
    return 'INV-2026-0001';
  };
  return { calls, prisma, proposal, invoiceNumberFactory };
}

test('proposal invoice input requires an explicit reviewed tax decision', () => {
  assert.equal(typeof schemas.proposalInvoiceDraftSchema?.safeParse, 'function');
  assert.equal(schemas.proposalInvoiceDraftSchema.safeParse({}).success, false);
  assert.equal(schemas.proposalInvoiceDraftSchema.safeParse({
    taxType: 'HST', taxRate: 13, taxReviewed: false,
  }).success, false);
  assert.equal(schemas.proposalInvoiceDraftSchema.safeParse({
    taxType: 'NONE', taxRate: 13, taxReviewed: true,
  }).success, false);
  assert.equal(schemas.proposalInvoiceDraftSchema.safeParse({
    taxType: 'HST', taxRate: 13, taxReviewed: true,
  }).success, true);
  assert.equal(schemas.proposalInvoiceDraftSchema.safeParse({
    taxType: 'NONE', taxRate: 0, taxReviewed: true,
  }).success, true);
  assert.equal(schemas.proposalInvoiceDraftSchema.safeParse({
    taxType: 'NONE', taxRate: 0, taxReviewed: true, currency: 'USD',
  }).success, false);
});

test('approved proposal creates an internal draft with reviewed tax and exact currency', async () => {
  assert.equal(typeof service.createDraftInvoiceFromProposal, 'function');
  const { calls, prisma, invoiceNumberFactory } = invoiceHarness();

  const invoice = await service.createDraftInvoiceFromProposal({
    prisma,
    proposalId: 'proposal-1',
    actorUserId: 'user-1',
    taxDecision: { taxType: 'GST', taxRate: 5, taxReviewed: true },
    invoiceNumberFactory,
  });

  assert.equal(invoice.status, 'DRAFT');
  assert.deepEqual(calls.created[0].data, {
    invoiceNumber: 'INV-2026-0001',
    title: 'Invoice for: Packaging system',
    clientId: 'client-1',
    projectId: 'project-1',
    proposalId: 'proposal-1',
    currency: 'CAD',
    subtotal: 1000,
    discountAmount: 100,
    taxRate: 5,
    taxType: 'GST',
    tax: 45,
    total: 945,
    notes: 'Invoice for proposal: Packaging system',
    createdById: 'user-1',
    lineItems: {
      create: [{
        description: 'Packaging design', itemType: 'LABOR', quantity: 1,
        unitPrice: 1000, total: 1000, position: 0,
      }],
    },
  });
  assert.equal('stripePaymentLink' in calls.created[0].data, false);
  assert.equal('sentAt' in calls.created[0].data, false);
  assert.equal(calls.invoiceNumbers, 1);
});

test('replaying proposal conversion returns the existing invoice without another write', async () => {
  assert.equal(typeof service.createDraftInvoiceFromProposal, 'function');
  const existing = { id: 'invoice-existing', status: 'DRAFT', currency: 'USD' };
  const { calls, prisma, invoiceNumberFactory } = invoiceHarness({ currency: 'USD' });
  prisma.invoice.findUnique = async () => existing;

  const invoice = await service.createDraftInvoiceFromProposal({
    prisma,
    proposalId: 'proposal-1',
    actorUserId: 'user-1',
    taxDecision: { taxType: 'NONE', taxRate: 0, taxReviewed: true },
    invoiceNumberFactory,
  });

  assert.equal(invoice, existing);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.invoiceNumbers, 0);
});

test('proposal conversion refuses unresolved legacy currency evidence', async () => {
  assert.equal(typeof service.createDraftInvoiceFromProposal, 'function');
  const { calls, prisma, invoiceNumberFactory } = invoiceHarness({ currency: null });

  await assert.rejects(
    service.createDraftInvoiceFromProposal({
      prisma,
      proposalId: 'proposal-1',
      actorUserId: 'user-1',
      taxDecision: { taxType: 'NONE', taxRate: 0, taxReviewed: true },
      invoiceNumberFactory,
    }),
    (error) => error.code === 'PROPOSAL_CURRENCY_UNASSIGNED' && error.statusCode === 409,
  );
  assert.equal(calls.created.length, 0);
});
