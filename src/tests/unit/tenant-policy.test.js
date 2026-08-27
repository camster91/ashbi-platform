import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createScopedPrisma, tenantModelPolicy } from '../../utils/prisma-tenant-proxy.js';

test('every Prisma schema model has an explicit tenant policy', async () => {
  const schema = await readFile(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
  const schemaModels = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)]
    .map((match) => match[1].toLowerCase())
    .sort();
  assert.deepEqual(Object.keys(tenantModelPolicy).sort(), schemaModels);
  assert.equal(Object.values(tenantModelPolicy).includes('unscoped'), false);
});

test('formerly ownerless application roots require indexed organization ownership', async () => {
  const schema = await readFile(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
  const roots = [
    'AssignmentRule', 'Template', 'UnmatchedEmail', 'LineItemTemplate',
    'WeeklyDigest', 'TaskTemplate', 'OutreachSequence', 'EmailTriageItem',
    'AiContext', 'AshConversation', 'ProjectTemplate', 'BrandSettings',
    'PipelineStage', 'PromptVersion',
  ];
  for (const root of roots) {
    const model = schema.match(new RegExp(`model ${root} \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
    assert.match(model, /organizationId\s+String\b/, `${root} must require organizationId`);
    assert.doesNotMatch(model, /organizationId\s+String\?/, `${root} ownership cannot be nullable`);
    assert.match(model, /@@index\(\[organizationId\]\)/, `${root} ownership must be indexed`);
  }
});

test('an unclassified application model fails closed in request scope', () => {
  const scoped = createScopedPrisma({ futureTenantModel: { findMany: async () => [] } }, 'org-a');
  assert.throws(
    () => scoped.futureTenantModel,
    /not classified for tenant access/i,
  );
});

test('explicitly global models remain accessible in request scope', async () => {
  const calls = [];
  const scoped = createScopedPrisma({ organization: { findMany: async (args) => { calls.push(args); return []; } } }, 'org-a');
  await scoped.organization.findMany({ where: { slug: 'ashbi' } });
  assert.deepEqual(calls, [{ where: { slug: 'ashbi' } }]);
});

test('relationship-scoped findUniqueOrThrow preserves throwing semantics', async () => {
  const calls = [];
  const missing = new Error('No record found');
  missing.code = 'P2025';
  const scoped = createScopedPrisma({
    invoice: {
      findUniqueOrThrow: async () => { throw new Error('unscoped method must not run'); },
      findFirstOrThrow: async (args) => { calls.push(args); throw missing; },
    },
  }, 'org-a');

  await assert.rejects(
    scoped.invoice.findUniqueOrThrow({ where: { id: 'invoice-b' } }),
    (error) => error === missing,
  );
  assert.deepEqual(calls[0].where, {
    AND: [{ id: 'invoice-b' }, { client: { organizationId: 'org-a' } }],
    deletedAt: null,
  });
});

test('personal calendar events are scoped through their required creator', async () => {
  const calls = [];
  const scoped = createScopedPrisma({
    calendarEvent: {
      findFirst: async (args) => { calls.push(args); return null; },
    },
  }, 'org-a');

  await scoped.calendarEvent.findFirst({ where: { id: 'event-a' } });

  assert.deepEqual(calls[0].where, {
    AND: [{ id: 'event-a' }, { createdBy: { organizationId: 'org-a' } }],
  });
});

test('relationship-scoped create rejects a foreign key owned by another organization', async () => {
  let created = false;
  const scoped = createScopedPrisma({
    client: {
      findFirst: async () => null,
    },
    invoice: {
      create: async () => { created = true; return {}; },
    },
  }, 'org-a');

  await assert.rejects(
    scoped.invoice.create({ data: { clientId: 'client-b', invoiceNumber: 'INV-1' } }),
    /does not belong to organization org-a/i,
  );
  assert.equal(created, false);
});

test('relationship-scoped create verifies the parent before writing', async () => {
  const parentCalls = [];
  const createCalls = [];
  const scoped = createScopedPrisma({
    client: {
      findFirst: async (args) => { parentCalls.push(args); return { id: 'client-a' }; },
    },
    invoice: {
      create: async (args) => { createCalls.push(args); return { id: 'invoice-a' }; },
    },
  }, 'org-a');

  await scoped.invoice.create({ data: { clientId: 'client-a', invoiceNumber: 'INV-1' } });
  assert.deepEqual(parentCalls[0], {
    where: { id: 'client-a', organizationId: 'org-a', deletedAt: null },
    select: { id: true },
  });
  assert.equal(createCalls.length, 1);
});

test('callback transactions retain tenant and soft-delete policies', async () => {
  const calls = [];
  const transaction = {
    client: { findMany: async (args) => { calls.push(args); return []; } },
  };
  const scoped = createScopedPrisma({
    $transaction: async (callback) => callback(transaction),
  }, 'org-a');

  await scoped.$transaction((tx) => tx.client.findMany());
  assert.deepEqual(calls[0], {
    where: { deletedAt: null, organizationId: 'org-a' },
    take: 100,
  });
});

test('relationship-scoped update preserves a unique where after tenant preflight', async () => {
  const updateCalls = [];
  const scoped = createScopedPrisma({
    invoice: {
      findFirst: async (args) => {
        assert.deepEqual(args.where, {
          AND: [{ id: 'invoice-a' }, { client: { organizationId: 'org-a' } }],
          deletedAt: null,
        });
        return { id: 'invoice-a' };
      },
      update: async (args) => { updateCalls.push(args); return { id: 'invoice-a', ...args.data }; },
    },
  }, 'org-a');

  await scoped.invoice.update({ where: { id: 'invoice-a' }, data: { status: 'SENT' } });
  assert.deepEqual(updateCalls[0].where, { id: 'invoice-a' });
});

test('relationship-scoped update rejects a target outside the tenant', async () => {
  let updated = false;
  const scoped = createScopedPrisma({
    invoice: {
      findFirst: async () => null,
      update: async () => { updated = true; },
    },
  }, 'org-a');

  await assert.rejects(
    scoped.invoice.update({ where: { id: 'invoice-b' }, data: { status: 'SENT' } }),
    /unavailable in this organization/i,
  );
  assert.equal(updated, false);
});

test('relationship-scoped update verifies a changed owner', async () => {
  let updated = false;
  const scoped = createScopedPrisma({
    client: { findFirst: async () => null },
    invoice: {
      findFirst: async () => ({ id: 'invoice-a' }),
      update: async () => { updated = true; },
    },
  }, 'org-a');

  await assert.rejects(
    scoped.invoice.update({ where: { id: 'invoice-a' }, data: { clientId: 'client-b' } }),
    /client client-b does not belong to organization org-a/i,
  );
  assert.equal(updated, false);
});

test('newly owned root models inject the verified organization on create', async () => {
  const calls = [];
  const scoped = createScopedPrisma({
    template: { create: async (args) => { calls.push(args); return args.data; } },
  }, 'org-a');
  await scoped.template.create({ data: { name: 'Reply', body: 'Hello' } });
  assert.equal(calls[0].data.organizationId, 'org-a');
});

test('expenses carry indexed organization ownership while legacy unassigned rows remain explicit', async () => {
  const schema = await readFile(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
  const expense = schema.match(/model Expense \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(expense, /organizationId\s+String\?/);
  assert.match(expense, /organization\s+Organization\?/);
  assert.match(expense, /@@index\(\[organizationId\]\)/);
});

test('general expenses receive verified organization ownership without requiring a client', async () => {
  const calls = [];
  const scoped = createScopedPrisma({
    expense: { create: async (args) => { calls.push(args); return args.data; } },
  }, 'org-a');

  await scoped.expense.create({ data: { description: 'Software', amount: 25, currency: 'CAD' } });

  assert.equal(calls[0].data.organizationId, 'org-a');
  assert.equal(calls[0].data.clientId, undefined);
});

test('direct-owned expense rejects a client from another organization', async () => {
  let created = false;
  const scoped = createScopedPrisma({
    client: { findFirst: async () => null },
    expense: { create: async () => { created = true; return {}; } },
  }, 'org-a');

  await assert.rejects(
    scoped.expense.create({ data: { description: 'Foreign', amount: 25, clientId: 'client-b' } }),
    /client client-b does not belong to organization org-a/i,
  );
  assert.equal(created, false);
});

test('direct-owned expense rejects an invoice from another organization', async () => {
  let created = false;
  const scoped = createScopedPrisma({
    invoice: { findFirst: async () => null },
    expense: { create: async () => { created = true; return {}; } },
  }, 'org-a');

  await assert.rejects(
    scoped.expense.create({ data: { description: 'Foreign', amount: 25, invoiceId: 'invoice-b' } }),
    /invoice invoice-b does not belong to organization org-a/i,
  );
  assert.equal(created, false);
});

test('direct-scoped throwing reads include the verified organization', async () => {
  const calls = [];
  const missing = Object.assign(new Error('No record found'), { code: 'P2025' });
  const scoped = createScopedPrisma({
    template: { findUniqueOrThrow: async (args) => { calls.push(args); throw missing; } },
  }, 'org-a');

  await assert.rejects(
    scoped.template.findUniqueOrThrow({ where: { id: 'template-b' } }),
    (error) => error === missing,
  );
  assert.deepEqual(calls[0].where, { id: 'template-b', organizationId: 'org-a' });
});

test('direct-scoped upsert forces organization ownership in every branch', async () => {
  const calls = [];
  const scoped = createScopedPrisma({
    template: { upsert: async (args) => { calls.push(args); return args; } },
  }, 'org-a');

  await scoped.template.upsert({
    where: { id: 'template-a' },
    create: { name: 'New', body: 'Body', organizationId: 'org-b' },
    update: { name: 'Updated', organizationId: 'org-b' },
  });
  assert.deepEqual(calls[0].where, { id: 'template-a', organizationId: 'org-a' });
  assert.equal(calls[0].create.organizationId, 'org-a');
  assert.equal(calls[0].update.organizationId, 'org-a');
});

test('direct-scoped createMany forces organization ownership for every row', async () => {
  const calls = [];
  const scoped = createScopedPrisma({
    template: { createMany: async (args) => { calls.push(args); return args; } },
  }, 'org-a');

  await scoped.template.createMany({
    data: [
      { name: 'One', body: '1' },
      { name: 'Two', body: '2', organizationId: 'org-b' },
    ],
  });
  assert.deepEqual(calls[0].data.map((row) => row.organizationId), ['org-a', 'org-a']);
});

test('relationship-scoped createMany rejects any foreign-owned parent before writing', async () => {
  let created = false;
  const parentCalls = [];
  const scoped = createScopedPrisma({
    client: {
      findFirst: async (args) => {
        parentCalls.push(args);
        return args.where.id === 'client-a' ? { id: 'client-a' } : null;
      },
    },
    invoice: { createMany: async () => { created = true; return {}; } },
  }, 'org-a');

  await assert.rejects(
    scoped.invoice.createMany({
      data: [
        { clientId: 'client-a', invoiceNumber: 'INV-1' },
        { clientId: 'client-b', invoiceNumber: 'INV-2' },
      ],
    }),
    /client client-b does not belong to organization org-a/i,
  );
  assert.equal(parentCalls.length, 2);
  assert.equal(created, false);
});

test('relationship-scoped upsert uses the create branch when no tenant record exists', async () => {
  const calls = [];
  const scoped = createScopedPrisma({
    client: { findFirst: async (args) => args.where.id === 'client-a' ? { id: 'client-a' } : null },
    invoice: {
      findFirst: async () => null,
      create: async (args) => { calls.push(args); return {}; },
      update: async () => { throw new Error('update must not run'); },
      upsert: async () => { throw new Error('native upsert must not run'); },
    },
  }, 'org-a');

  await scoped.invoice.upsert({
    where: { id: 'invoice-a' },
    create: { clientId: 'client-a', invoiceNumber: 'INV-1' },
    update: { clientId: 'client-b' },
    include: { client: true },
  });
  assert.deepEqual(calls[0], {
    data: { clientId: 'client-a', invoiceNumber: 'INV-1' },
    include: { client: true },
  });
});

test('relationship-scoped upsert updates only an existing tenant record', async () => {
  const calls = [];
  const scoped = createScopedPrisma({
    client: { findFirst: async (args) => args.where.id === 'client-a' ? { id: 'client-a' } : null },
    invoice: {
      findFirst: async () => ({ id: 'invoice-a' }),
      create: async () => { throw new Error('create must not run'); },
      update: async (args) => { calls.push(args); return {}; },
      upsert: async () => { throw new Error('native upsert must not run'); },
    },
  }, 'org-a');

  await scoped.invoice.upsert({
    where: { id: 'invoice-a' },
    create: { clientId: 'client-b', invoiceNumber: 'INV-1' },
    update: { clientId: 'client-a', notes: 'Updated' },
    select: { id: true },
  });
  assert.deepEqual(calls[0], {
    where: { id: 'invoice-a' },
    data: { clientId: 'client-a', notes: 'Updated' },
    select: { id: true },
  });
});

test('relationship-scoped upsert cannot update an existing record from another tenant', async () => {
  let created = false;
  let updated = false;
  const scoped = createScopedPrisma({
    client: { findFirst: async () => ({ id: 'client-a' }) },
    invoice: {
      findFirst: async () => null,
      create: async () => { created = true; throw new Error('unique constraint'); },
      update: async () => { updated = true; return {}; },
      upsert: async () => { throw new Error('native upsert must not run'); },
    },
  }, 'org-a');

  await assert.rejects(scoped.invoice.upsert({
    where: { id: 'invoice-other-tenant' },
    create: { clientId: 'client-a', invoiceNumber: 'INV-1' },
    update: { clientId: 'client-a', notes: 'Hijacked' },
  }), /unique constraint/i);
  assert.equal(created, true);
  assert.equal(updated, false);
});

test('direct-scoped project creation rejects a client owned by another organization', async () => {
  let created = false;
  const scoped = createScopedPrisma({
    client: { findFirst: async () => null },
    project: { create: async () => { created = true; return {}; } },
  }, 'org-a');

  await assert.rejects(
    scoped.project.create({ data: { name: 'Foreign project', clientId: 'client-b' } }),
    /client client-b does not belong to organization org-a/i,
  );
  assert.equal(created, false);
});

test('direct-scoped lead update rejects a converted deal owned by another organization', async () => {
  let updated = false;
  const scoped = createScopedPrisma({
    pipelineDeal: { findFirst: async () => null },
    lead: { update: async () => { updated = true; return {}; } },
  }, 'org-a');

  await assert.rejects(
    scoped.lead.update({ where: { id: 'lead-a' }, data: { convertedDealId: 'deal-b' } }),
    /convertedDeal deal-b does not belong to organization org-a/i,
  );
  assert.equal(updated, false);
});

test('direct-scoped nested connect is ownership-checked before writing', async () => {
  let created = false;
  const scoped = createScopedPrisma({
    client: { findFirst: async () => null },
    project: { create: async () => { created = true; return {}; } },
  }, 'org-a');

  await assert.rejects(
    scoped.project.create({ data: { name: 'Foreign project', client: { connect: { id: 'client-b' } } } }),
    /client client-b does not belong to organization org-a/i,
  );
  assert.equal(created, false);
});

test('aliased relationship owners resolve to their actual tenant model', async () => {
  const ownerCalls = [];
  const createCalls = [];
  const scoped = createScopedPrisma({
    user: { findFirst: async (args) => { ownerCalls.push(args); return { id: 'user-a' }; } },
    snippet: { create: async (args) => { createCalls.push(args); return {}; } },
  }, 'org-a');

  await scoped.snippet.create({ data: { name: 'Reply', content: 'Hello', createdById: 'user-a' } });
  assert.equal(createCalls.length, 1);
  assert.deepEqual(ownerCalls[0].where, { id: 'user-a', organizationId: 'org-a' });
});
