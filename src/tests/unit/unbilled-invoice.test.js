import test from 'node:test';
import assert from 'node:assert/strict';
import { listUnbilledCandidates, previewUnbilledInvoice, createUnbilledInvoiceInTransaction } from '../../services/unbilled-invoice.service.js';
import { createFakeInvoiceDb } from '../helpers/fake-invoice-db.js';

const actor = { id: 'admin', organizationId: 'org-a', role: 'ADMIN' };
const updatedAt = new Date('2026-10-14T00:00:00Z');
const input = { clientId: 'client', title: 'Reviewed work', currency: 'CAD', taxRate: 13, taxType: 'HST',
  times: [{ id: 'time', updatedAt: updatedAt.toISOString(), hourlyRate: 125 }], expenses: [{ id: 'expense', updatedAt: updatedAt.toISOString() }],
};
function fixture() {
  const queries = [];
  const time = { id: 'time', description: 'Approved design', duration: 45, hourlyRate: 0, updatedAt, date: updatedAt, project: { id: 'project', name: 'Delivery' }, user: { id: 'staff', name: 'Designer' }, secret: 'omit' };
  const expense = { id: 'expense', description: 'Materials', amount: 10, currency: 'CAD', updatedAt, date: updatedAt, project: null, receiptUrl: 'private-receipt', notes: 'private-note' };
  let role = 'ADMIN';
  const prisma = {
    user: { findFirst: async ({ where }) => where.role === role && where.organizationId === actor.organizationId ? actor : null },
    client: { findFirst: async ({ where }) => where.id === 'client' && where.organizationId === actor.organizationId ? { id: 'client', name: 'Canonical client' } : null },
    project: { findFirst: async ({ where }) => where.id === 'project' && where.clientId === 'client' ? { id: 'project', name: 'Delivery' } : null },
    timeEntry: { findMany: async query => { queries.push({ kind: 'TIME', ...query }); return query.where.id?.in && !query.where.id.in.includes(time.id) ? [] : [time]; } },
    expense: { findMany: async query => { queries.push({ kind: 'EXPENSE', ...query }); return [expense]; } },
  };
  return { prisma, time, expense, queries, demote: () => { role = 'TEAM'; } };
}

test('billing preview uses explicit rate/currency/tax choices, rounded cents and canonical source identities', async () => {
  const { prisma, queries } = fixture();
  const preview = await previewUnbilledInvoice(prisma, input, actor);
  assert.equal(preview.client.name, 'Canonical client');
  assert.equal(preview.lineItems[0].quantity, 0.75);
  assert.equal(preview.lineItems[0].source.suggestedHourlyRate, 0, 'zero is not replaced with another rate');
  assert.equal(preview.lineItems[0].source.declaredHourlyRate, 125);
  assert.equal(preview.lineItems[0].source.declaredRateCurrency, 'CAD');
  assert.deepEqual(preview.totals, { subtotal: 103.75, preTax: 103.75, tax: 13.49, total: 117.24 });
  assert.equal(preview.status, 'DRAFT'); assert.equal(preview.sendsMessage, false); assert.equal(preview.chargesPayment, false);
  assert.doesNotMatch(JSON.stringify(preview), /private-receipt|private-note|omit/);
  assert.equal(queries[0].where.reviewStatus, 'APPROVED');
  assert.equal(queries[0].where.project.organizationId, actor.organizationId);
  assert.equal(queries[0].where.user.organizationId, actor.organizationId);
  assert.equal(queries[1].where.organizationId, actor.organizationId);
  assert.equal(queries[1].where.invoiced, false); assert.equal(queries[1].where.invoiceId, null);
  assert.equal(preview.fingerprint, (await previewUnbilledInvoice(prisma, input, actor)).fingerprint);
});

test('stale work, unavailable identities and incompatible expense currencies refuse the selection', async () => {
  const { prisma, time, expense } = fixture();
  time.updatedAt = new Date('2026-10-14T01:00:00Z');
  await assert.rejects(previewUnbilledInvoice(prisma, input, actor), { statusCode: 409 });
  time.updatedAt = updatedAt;
  expense.currency = 'USD';
  await assert.rejects(previewUnbilledInvoice(prisma, input, actor), /No conversion/);
  expense.currency = 'CAD';
  await assert.rejects(previewUnbilledInvoice(prisma, { ...input, times: [{ ...input.times[0], id: 'unavailable' }] }, actor), { statusCode: 409 });
  await assert.rejects(previewUnbilledInvoice(prisma, { ...input, clientId: 'foreign' }, actor), { statusCode: 404 });
});

test('a raw source edit changes the exact preview fingerprint even if its timestamp was not advanced', async () => {
  const { prisma, expense } = fixture();
  const original = await previewUnbilledInvoice(prisma, input, actor);
  expense.amount = 11;
  const changed = await previewUnbilledInvoice(prisma, input, actor);
  assert.notEqual(changed.fingerprint, original.fingerprint);
  assert.equal(changed.lineItems[1].source.id, original.lineItems[1].source.id);
});

test('fresh administrator checks and selection bounds run before billing data reads', async () => {
  const { prisma, queries, demote } = fixture();
  await assert.rejects(previewUnbilledInvoice(prisma, { ...input, times: [...input.times, ...input.times] }, actor), { statusCode: 400 });
  await assert.rejects(previewUnbilledInvoice(prisma, { ...input, taxType: 'NONE' }, actor), { statusCode: 400 });
  await assert.rejects(previewUnbilledInvoice(prisma, { ...input, currency: 'ZZZ' }, actor), { statusCode: 400 });
  demote();
  await assert.rejects(previewUnbilledInvoice(prisma, input, actor), { statusCode: 403 });
  assert.equal(queries.length, 0);
});

test('candidate pages retain later source identities with bounded tenant-scoped reads', async () => {
  const { prisma } = fixture();
  const rows = Array.from({ length: 60 }, (_, index) => ({ id: `t${String(index).padStart(3, '0')}`, description: 'Approved time', duration: 30, date: updatedAt, updatedAt }));
  const pages = [];
  prisma.timeEntry.findMany = async ({ where, take }) => {
    assert.equal(where.project.organizationId, actor.organizationId);
    assert.equal(where.project.clientId, input.clientId);
    assert.equal(where.reviewStatus, 'APPROVED'); assert.equal(where.invoiced, false);
    assert.ok(take <= 51);
    pages.push(take);
    return rows.filter(row => !where.id || row.id > where.id.gt).slice(0, take);
  };
  const first = await listUnbilledCandidates(prisma, { clientId: 'client', kind: 'TIME', limit: 50 }, actor);
  const second = await listUnbilledCandidates(prisma, { clientId: 'client', kind: 'TIME', limit: 50, after: first.nextCursor }, actor);
  assert.equal(first.items.length, 50); assert.equal(second.items.length, 10); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 60);
  assert.deepEqual(pages, [51, 51]);
});

test('draft creation checks its reviewed fingerprint and claims both sources with a required audit', async () => {
  const { prisma } = fixture();
  const db = createFakeInvoiceDb({ clients: [{ id: 'client', name: 'Canonical client' }] });
  Object.assign(prisma, { invoice: db.invoice, $queryRaw: db.$queryRaw, auditEvent: db.auditEvent });
  const claims = [];
  for (const kind of ['timeEntry', 'expense']) {
    prisma[kind].updateMany = async ({ where, data }) => {
      claims.push({ kind, where, data });
      return { count: 1 };
    };
  }
  const preview = await previewUnbilledInvoice(prisma, input, actor);
  await assert.rejects(createUnbilledInvoiceInTransaction(prisma, input, '0'.repeat(64), actor), { statusCode: 409 });
  assert.equal(db.state.invoices.length, 0);
  const invoice = await createUnbilledInvoiceInTransaction(prisma, input, preview.fingerprint, actor);
  assert.equal(invoice.status, 'DRAFT'); assert.equal(invoice.total, 117.24);
  assert.equal(invoice.billingSources.version, 1);
  assert.equal(invoice.billingSources.clientId, input.clientId);
  assert.equal(invoice.billingSources.lineItems[0].source.id, 'time');
  assert.equal(invoice.lineItems.length, 2);
  assert.ok(invoice.lineItems.every(line => !('source' in line)), 'internal origins belong to the private snapshot');
  assert.equal(claims.length, 2);
  assert.ok(claims.every(claim => claim.data.invoiceId === invoice.id && claim.data.invoiced));
  assert.ok(db.state.audit.some(event => event.action === 'invoice.created_from_unbilled'));
  prisma.auditEvent.create = async () => { throw new Error('Audit unavailable'); };
  await assert.rejects(createUnbilledInvoiceInTransaction(prisma, input, preview.fingerprint, actor), { statusCode: 503 });
});
