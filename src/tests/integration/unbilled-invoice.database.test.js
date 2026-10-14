import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { listUnbilledCandidates, previewUnbilledInvoice, createUnbilledInvoiceInTransaction, previewUnbilledRelease, releaseUnbilledSourcesInTransaction } from '../../services/unbilled-invoice.service.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('unbilled selection preserves canonical clients and currency, approval, pagination and tenant boundaries', {
  skip: !url && 'Disposable database is not configured', timeout: 120_000,
}, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `unbilled-${key}-${randomUUID()}`);
  try {
    const actors = [], clients = [], projects = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Billing selection fixture' } });
      actors.push(await raw.user.create({ data: { organizationId, role: 'ADMIN', name: 'Billing administrator', email: `${randomUUID()}@e2e.example.test`, password: randomUUID() } }));
      clients.push(await raw.client.create({ data: { organizationId, name: 'Canonical client' } }));
      projects.push(await raw.project.create({ data: { organizationId, clientId: clients.at(-1).id, name: 'Canonical project' } }));
    }
    await raw.timeEntry.createMany({ data: Array.from({ length: 60 }, () => ({ projectId: projects[0].id, userId: actors[0].id, description: 'Approved design', duration: 45, hourlyRate: 0, reviewStatus: 'APPROVED' })) });
    await raw.timeEntry.createMany({ data: [
      { projectId: projects[0].id, userId: actors[0].id, duration: 60, reviewStatus: 'PENDING' },
      { projectId: projects[0].id, userId: actors[0].id, duration: 60, reviewStatus: 'REJECTED' },
      { projectId: projects[0].id, userId: actors[0].id, duration: 60, reviewStatus: 'APPROVED', invoiced: true },
      { projectId: projects[1].id, userId: actors[1].id, duration: 60, reviewStatus: 'APPROVED', description: 'Foreign private source' },
    ] });
    const expense = await raw.expense.create({ data: { organizationId: orgs[0], clientId: clients[0].id, description: 'Materials', amount: 10, currency: 'CAD', billable: true } });
    const usd = await raw.expense.create({ data: { organizationId: orgs[0], clientId: clients[0].id, description: 'USD materials', amount: 10, currency: 'USD', billable: true } });
    const otherClient = await raw.client.create({ data: { organizationId: orgs[0], name: 'Another canonical client' } });
    const otherProject = await raw.project.create({ data: { organizationId: orgs[0], clientId: otherClient.id, name: 'Other client project' } });
    const mismatched = await raw.expense.create({ data: { organizationId: orgs[0], clientId: clients[0].id, projectId: otherProject.id, description: 'Mismatched client/project', amount: 10, currency: 'CAD', billable: true } });
    for (const prisma of [raw, createScopedPrisma(raw, orgs[0])]) {
      const query = { clientId: clients[0].id, kind: 'TIME', limit: 50 };
      const first = await listUnbilledCandidates(prisma, query, actors[0]);
      const second = await listUnbilledCandidates(prisma, { ...query, after: first.nextCursor }, actors[0]);
      assert.equal(first.items.length, 50); assert.equal(second.items.length, 10); assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 60);
      assert.doesNotMatch(JSON.stringify(first), /Foreign private source/);
      const expenses = await listUnbilledCandidates(prisma, { clientId: clients[0].id, kind: 'EXPENSE' }, actors[0]);
      assert.deepEqual(new Set(expenses.items.map(item => item.id)), new Set([expense.id, usd.id]));
      const selected = { clientId: clients[0].id, title: 'Reviewed billing', currency: 'CAD', taxRate: 13, taxType: 'HST',
        times: [{ id: first.items[0].id, updatedAt: first.items[0].updatedAt.toISOString(), hourlyRate: 125 }],
        expenses: [{ id: expense.id, updatedAt: expense.updatedAt.toISOString() }],
      };
      const preview = await previewUnbilledInvoice(prisma, selected, actors[0]);
      assert.equal(preview.totals.total, 117.24);
      await assert.rejects(previewUnbilledInvoice(prisma, { ...selected, clientId: clients[1].id }, actors[0]), { statusCode: 404 });
      await assert.rejects(previewUnbilledInvoice(prisma, { ...selected, expenses: [{ id: usd.id, updatedAt: usd.updatedAt.toISOString() }] }, actors[0]), /No conversion/);
      await assert.rejects(previewUnbilledInvoice(prisma, { ...selected, expenses: [{ id: mismatched.id, updatedAt: mismatched.updatedAt.toISOString() }] }, actors[0]), { statusCode: 409 });
    }
    assert.equal(await raw.invoice.count({ where: { organizationId: { in: orgs } } }), 0, 'selection and preview do not bill sources');
    assert.equal(await raw.timeEntry.count({ where: { projectId: projects[0].id, invoiced: true } }), 1);
    const sourceTime = await raw.timeEntry.findFirst({ where: { projectId: projects[0].id, reviewStatus: 'APPROVED', invoiced: false } });
    const selected = { clientId: clients[0].id, title: 'Confirmed billing', currency: 'CAD', taxRate: 13, taxType: 'HST',
      times: [{ id: sourceTime.id, updatedAt: sourceTime.updatedAt.toISOString(), hourlyRate: 125 }],
      expenses: [{ id: expense.id, updatedAt: expense.updatedAt.toISOString() }],
    };
    const scoped = createScopedPrisma(raw, orgs[0]);
    const reviewed = await previewUnbilledInvoice(scoped, selected, actors[0]);
    await assert.rejects(raw.$transaction(tx => createUnbilledInvoiceInTransaction(tx, selected, '0'.repeat(64), actors[0]), { isolationLevel: 'Serializable' }), { statusCode: 409 });
    assert.equal(await raw.invoice.count({ where: { organizationId: orgs[0] } }), 0);
    await assert.rejects(scoped.$transaction(tx => createUnbilledInvoiceInTransaction(new Proxy(tx, {
      get(target, property) {
        if (property === 'auditEvent') return { create: async () => { throw new Error('Synthetic audit failure'); } };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }), selected, reviewed.fingerprint, actors[0]), { isolationLevel: 'Serializable' }), { statusCode: 503 });
    assert.equal(await raw.invoice.count({ where: { organizationId: orgs[0] } }), 0);
    assert.equal(await raw.documentNumberSequence.count({ where: { organizationId: orgs[0] } }), 0, 'failed audit releases the allocated number');
    assert.equal((await raw.timeEntry.findUnique({ where: { id: sourceTime.id } })).invoiceId, null);
    assert.equal((await raw.expense.findUnique({ where: { id: expense.id } })).invoiceId, null);
    const race = await Promise.allSettled([1, 2].map(() => scoped.$transaction(tx => createUnbilledInvoiceInTransaction(tx, selected, reviewed.fingerprint, actors[0]), { isolationLevel: 'Serializable' })));
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1, 'competing source claims must have one invoice winner');
    const invoice = race.find(result => result.status === 'fulfilled').value;
    assert.equal(invoice.status, 'DRAFT'); assert.equal(invoice.total, 117.24);
    assert.equal(invoice.lineItems.length, 2);
    assert.equal(invoice.billingSources.clientId, clients[0].id);
    assert.equal(invoice.billingSources.lineItems[0].source.id, sourceTime.id);
    assert.equal((await raw.timeEntry.findUnique({ where: { id: sourceTime.id } })).invoiceId, invoice.id);
    assert.equal((await raw.expense.findUnique({ where: { id: expense.id } })).invoiceId, invoice.id);
    await assert.rejects(raw.invoice.update({ where: { id: invoice.id }, data: { billingSources: {} } }), /billing sources cannot change/);
    await assert.rejects(raw.invoice.update({ where: { id: invoice.id }, data: { currency: 'USD' } }), /client project and currency cannot change/);
    await assert.rejects(raw.invoice.update({ where: { id: invoice.id }, data: { isRecurring: true } }), /cannot recur/);
    await assert.rejects(raw.timeEntry.update({ where: { id: sourceTime.id }, data: { duration: 60 } }), /billed time/);
    await assert.rejects(raw.expense.update({ where: { id: expense.id }, data: { amount: 20 } }), /billed expense/);
    await assert.rejects(raw.project.update({ where: { id: projects[0].id }, data: { clientId: otherClient.id } }), /billed time/);
    await assert.rejects(raw.timeEntry.update({ where: { id: sourceTime.id }, data: { invoiceId: null, invoiced: false } }), /billed time/);
    await raw.expense.update({ where: { id: expense.id }, data: { notes: 'Receipt follow-up' } });
    assert.deepEqual((await raw.invoice.findUnique({ where: { id: invoice.id } })).billingSources, invoice.billingSources, 'receipt notes do not rewrite the original billing history');
    assert.ok(await raw.auditEvent.findFirst({ where: { organizationId: orgs[0], action: 'invoice.created_from_unbilled', entityId: invoice.id } }));
    await assert.rejects(previewUnbilledRelease(scoped, invoice.id, actors[0]), { statusCode: 409 });
    await raw.invoice.update({ where: { id: invoice.id }, data: { status: 'VOID', voidedAt: new Date(Date.now() - 20_000), voidedFromStatus: 'DRAFT' } });
    const release = await previewUnbilledRelease(scoped, invoice.id, actors[0]);
    assert.equal(release.sourceCount.time, 1); assert.equal(release.sourceCount.expense, 1);
    assert.equal(release.retainsOriginalHistory, true); assert.equal(release.reopensInvoice, false);
    const released = await scoped.$transaction(tx => releaseUnbilledSourcesInTransaction(tx, invoice.id, release.fingerprint, actors[0]), { isolationLevel: 'Serializable' });
    assert.ok(released.billingSourcesReleasedAt);
    assert.deepEqual(released.billingSources, invoice.billingSources);
    assert.equal((await raw.timeEntry.findUnique({ where: { id: sourceTime.id } })).invoiceId, null);
    assert.equal((await raw.expense.findUnique({ where: { id: expense.id } })).invoiceId, null);
    assert.equal((await raw.timeEntry.findUnique({ where: { id: sourceTime.id } })).reviewStatus, 'APPROVED');
    await assert.rejects(raw.invoice.update({ where: { id: invoice.id }, data: { status: 'DRAFT' } }), /cannot be reopened/);
    await assert.rejects(previewUnbilledRelease(scoped, invoice.id, actors[0]), { statusCode: 409 });
    assert.ok(await raw.auditEvent.findFirst({ where: { organizationId: orgs[0], action: 'invoice.sources_released', entityId: invoice.id } }));
    const tools = createWorkspaceTools();
    const ctx = { prisma: scoped, user: actors[0], scopes: ['workspace:read', 'workspace:actions'] };
    await assert.rejects(tools.call({ ...ctx, scopes: ['workspace:read'] }, 'create_unbilled_invoice_draft', {}), { code: 'TOOL_UNAVAILABLE' });
    const currentTime = await raw.timeEntry.findUnique({ where: { id: sourceTime.id } });
    const currentExpense = await raw.expense.findUnique({ where: { id: expense.id } });
    const nextSelection = { ...selected, times: [{ ...selected.times[0], updatedAt: currentTime.updatedAt.toISOString() }], expenses: [{ id: expense.id, updatedAt: currentExpense.updatedAt.toISOString() }] };
    const nextPreview = (await tools.call(ctx, 'preview_unbilled_invoice', nextSelection)).output;
    const args = { input: { selection: nextSelection, fingerprint: nextPreview.fingerprint }, idempotencyKey: `billing-${randomUUID()}` };
    const prepared = await tools.call(ctx, 'create_unbilled_invoice_draft', args);
    assert.equal(prepared.action.status, 'PENDING_CONFIRMATION');
    assert.equal((await raw.timeEntry.findUnique({ where: { id: sourceTime.id } })).invoiceId, null);
    await assert.rejects(tools.call({ ...ctx, user: actors[1], prisma: raw }, 'confirm_action', { actionId: prepared.action.id }), { code: 'NOT_FOUND' });
    const committed = await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id });
    assert.equal(committed.action.status, 'EXECUTED');
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).idempotent, true);
    assert.equal((await tools.call(ctx, 'create_unbilled_invoice_draft', args)).action.id, prepared.action.id);
    assert.equal(await raw.invoice.count({ where: { organizationId: orgs[0] } }), 2);
    assert.equal((await tools.call(ctx, 'get_action', { actionId: prepared.action.id })).action.result.id, committed.action.result.id);
    await raw.user.update({ where: { id: actors[0].id }, data: { role: 'TEAM' } });
    await assert.rejects(tools.call(ctx, 'get_action', { actionId: prepared.action.id }), { code: 'ROLE_DENIED' });
    await assert.rejects(tools.call(ctx, 'create_unbilled_invoice_draft', args), { code: 'ROLE_DENIED' });
    await assert.rejects(listUnbilledCandidates(raw, { clientId: clients[0].id, kind: 'TIME' }, actors[0]), { statusCode: 403 });
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.$transaction(async tx => {
      await tx.timeEntry.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
      await tx.expense.deleteMany({ where: { organizationId: { in: orgs } } });
      await tx.invoiceLineItem.deleteMany({ where: { invoice: { organizationId: { in: orgs } } } });
      await tx.invoice.deleteMany({ where: { organizationId: { in: orgs } } });
      await tx.documentNumberSequence.deleteMany({ where: { organizationId: { in: orgs } } });
    });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
