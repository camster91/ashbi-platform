import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as schemas from '../../validators/schemas.js';

const service = await import('../../services/manualInvoice.service.js').catch(() => ({}));

function validInput(overrides = {}) {
  return {
    creationRequestId: '123e4567-e89b-42d3-a456-426614174000',
    clientId: 'client-1',
    projectId: 'project-1',
    currency: 'USD',
    taxType: 'GST',
    taxRate: 5,
    taxReviewed: true,
    discountAmount: 100,
    lineItems: [
      { description: 'Custom web application', itemType: 'LABOR', quantity: 2, unitPrice: 500 },
    ],
    ...overrides,
  };
}

function invoiceHarness({ client = { id: 'client-1' }, project = { id: 'project-1' } } = {}) {
  const calls = { creates: [], clientReads: [], projectReads: [], invoiceNumbers: 0 };
  const prisma = {
    client: {
      findUnique: async (args) => {
        calls.clientReads.push(args);
        return client;
      },
    },
    project: {
      findFirst: async (args) => {
        calls.projectReads.push(args);
        return project;
      },
    },
    invoice: {
      findUnique: async () => null,
      create: async (args) => {
        calls.creates.push(args);
        return { id: 'invoice-1', status: 'DRAFT', ...args.data };
      },
    },
  };
  const invoiceNumberFactory = async () => {
    calls.invoiceNumbers += 1;
    return 'INV-2026-0002';
  };
  return { calls, prisma, invoiceNumberFactory };
}

test('manual invoice input requires explicit currency and reviewed tax without requiring title or due date', () => {
  const base = validInput({ projectId: undefined });
  assert.equal(schemas.createInvoiceSchema.safeParse(base).success, true);
  assert.equal(schemas.createInvoiceSchema.safeParse({ ...base, creationRequestId: undefined }).success, false);
  assert.equal(schemas.createInvoiceSchema.safeParse({ ...base, currency: undefined }).success, false);
  assert.equal(schemas.createInvoiceSchema.safeParse({ ...base, currency: 'EUR' }).success, false);
  assert.equal(schemas.createInvoiceSchema.safeParse({ ...base, taxReviewed: false }).success, false);
  assert.equal(schemas.createInvoiceSchema.safeParse({ ...base, taxType: 'NONE', taxRate: 13 }).success, false);
  assert.equal(schemas.createInvoiceSchema.safeParse({ ...base, taxType: 'NONE', taxRate: 0 }).success, true);
  assert.equal(schemas.createInvoiceSchema.safeParse({ ...base, guessedTax: true }).success, false);
});

test('manual invoice creation stores a currency-safe reviewed internal draft only', async () => {
  assert.equal(typeof service.createManualInvoiceDraft, 'function');
  const { calls, prisma, invoiceNumberFactory } = invoiceHarness();
  const now = new Date('2026-08-26T18:00:00.000Z');

  const invoice = await service.createManualInvoiceDraft({
    prisma,
    actorUserId: 'user-1',
    input: validInput(),
    invoiceNumberFactory,
    now,
  });

  assert.equal(invoice.status, 'DRAFT');
  assert.deepEqual(calls.clientReads[0], { where: { id: 'client-1' }, select: { id: true } });
  assert.deepEqual(calls.projectReads[0], {
    where: { id: 'project-1', clientId: 'client-1' },
    select: { id: true },
  });
  assert.deepEqual(calls.creates[0].data, {
    creationRequestId: '123e4567-e89b-42d3-a456-426614174000',
    invoiceNumber: 'INV-2026-0002',
    title: null,
    clientId: 'client-1',
    projectId: 'project-1',
    currency: 'USD',
    subtotal: 1000,
    discountAmount: 100,
    taxRate: 5,
    taxType: 'GST',
    tax: 45,
    total: 945,
    notes: null,
    internalNotes: null,
    dueDate: null,
    issueDate: now,
    isRecurring: false,
    recurringInterval: null,
    createdById: 'user-1',
    lineItems: {
      create: [{
        description: 'Custom web application', itemType: 'LABOR', quantity: 2,
        unitPrice: 500, total: 1000, position: 0,
      }],
    },
  });
  assert.equal('taxReviewed' in calls.creates[0].data, false);
  assert.equal('stripePaymentLink' in calls.creates[0].data, false);
  assert.equal('sentAt' in calls.creates[0].data, false);
});

test('replaying the same manual invoice request returns the existing draft without another write', async () => {
  assert.equal(typeof service.createManualInvoiceDraft, 'function');
  const existing = { id: 'invoice-existing', status: 'DRAFT', currency: 'CAD' };
  const { calls, prisma, invoiceNumberFactory } = invoiceHarness();
  prisma.invoice.findUnique = async () => existing;

  const invoice = await service.createManualInvoiceDraft({
    prisma,
    actorUserId: 'user-1',
    input: validInput({ currency: 'CAD' }),
    invoiceNumberFactory,
  });

  assert.equal(invoice, existing);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.invoiceNumbers, 0);
  assert.equal(calls.clientReads.length, 0);
});

test('simultaneous manual invoice retries recover the one winning draft', async () => {
  assert.equal(typeof service.createManualInvoiceDraft, 'function');
  const concurrent = { id: 'invoice-concurrent', status: 'DRAFT', currency: 'USD' };
  const { prisma, invoiceNumberFactory } = invoiceHarness();
  let reads = 0;
  prisma.invoice.findUnique = async () => {
    reads += 1;
    return reads === 1 ? null : concurrent;
  };
  prisma.invoice.create = async () => {
    const error = new Error('Unique constraint');
    error.code = 'P2002';
    throw error;
  };

  const invoice = await service.createManualInvoiceDraft({
    prisma,
    actorUserId: 'user-1',
    input: validInput(),
    invoiceNumberFactory,
  });

  assert.equal(invoice, concurrent);
  assert.equal(reads, 2);
});

test('manual invoice creation key is unique at the database boundary', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'prisma/migrations/20260827001000_invoice_creation_request_id/migration.sql',
    'utf8',
  );
  const invoiceModel = schema.match(/model Invoice \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(invoiceModel, /creationRequestId\s+String\?\s+@unique/);
  assert.match(migration, /CREATE UNIQUE INDEX "invoices_creationRequestId_key"/);
});

test('manual invoice creation rejects a client outside the authenticated tenant scope', async () => {
  assert.equal(typeof service.createManualInvoiceDraft, 'function');
  const { calls, prisma, invoiceNumberFactory } = invoiceHarness({ client: null });

  await assert.rejects(
    service.createManualInvoiceDraft({
      prisma,
      actorUserId: 'user-1',
      input: validInput({ projectId: undefined }),
      invoiceNumberFactory,
    }),
    (error) => error.code === 'INVOICE_CLIENT_NOT_FOUND' && error.statusCode === 404,
  );
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.invoiceNumbers, 0);
});

test('manual invoice creation rejects a project that is not owned by the selected client', async () => {
  assert.equal(typeof service.createManualInvoiceDraft, 'function');
  const { calls, prisma, invoiceNumberFactory } = invoiceHarness({ project: null });

  await assert.rejects(
    service.createManualInvoiceDraft({
      prisma,
      actorUserId: 'user-1',
      input: validInput(),
      invoiceNumberFactory,
    }),
    (error) => error.code === 'INVOICE_PROJECT_CLIENT_MISMATCH' && error.statusCode === 409,
  );
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.invoiceNumbers, 0);
});

test('manual invoice route uses only the authenticated tenant scope for business records', () => {
  const routes = readFileSync('src/routes/invoice.routes.js', 'utf8');
  const start = routes.indexOf("fastify.post('/',");
  const end = routes.indexOf('// ─── PUT /:id', start);
  const createRoute = routes.slice(start, end);

  assert.match(createRoute, /createManualInvoiceDraft\(\{/);
  assert.match(createRoute, /prisma:\s*request\.prisma/);
  assert.doesNotMatch(createRoute, /fastify\.prisma/);
});
