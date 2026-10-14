import test from 'node:test';
import assert from 'node:assert/strict';
import { previewUnbilledRelease, releaseUnbilledSourcesInTransaction } from '../../services/unbilled-invoice.service.js';

const actor = { id: 'admin', role: 'ADMIN', organizationId: 'org' };
const now = new Date('2026-10-14T01:00:00Z');
function fixture() {
  const invoice = { id: 'invoice', invoiceNumber: 'INV-1', status: 'VOID', voidedAt: new Date(now.getTime() - 11_000), updatedAt: now,
    currency: 'CAD', total: 100, billingSourcesReleasedAt: null,
    billingSources: { version: 1, fingerprint: 'a'.repeat(64), lineItems: [{ source: { kind: 'TIME', id: 'time' } }, { source: { kind: 'EXPENSE', id: 'expense' } }] },
  };
  let payments = 0;
  const claims = [];
  const prisma = { user: { findFirst: async () => actor }, invoice: {
    findFirst: async ({ where }) => where.id === invoice.id && where.organizationId === actor.organizationId ? invoice : null,
    updateMany: async ({ data }) => { Object.assign(invoice, data); return { count: 1 }; },
  }, invoicePayment: { count: async () => payments },
    timeEntry: { findMany: async () => [{ id: 'time', updatedAt: now, invoiced: true }], updateMany: async query => { claims.push(query); return { count: 1 }; } },
    expense: { findMany: async () => [{ id: 'expense', updatedAt: now, invoiced: true }], updateMany: async query => { claims.push(query); return { count: 1 }; } },
    auditEvent: { create: async ({ data }) => data },
  };
  return { prisma, invoice, claims, addPayment: () => { payments++; } };
}

test('release requires an unpaid voided invoice after its undo window and an unchanged reviewed roster', async () => {
  const { prisma, invoice, addPayment } = fixture();
  invoice.status = 'DRAFT';
  await assert.rejects(previewUnbilledRelease(prisma, 'invoice', actor, now), { statusCode: 409 });
  invoice.status = 'VOID'; invoice.voidedAt = new Date(now.getTime() - 9_000);
  await assert.rejects(previewUnbilledRelease(prisma, 'invoice', actor, now), { statusCode: 409 });
  invoice.voidedAt = new Date(now.getTime() - 11_000);
  const preview = await previewUnbilledRelease(prisma, 'invoice', actor, now);
  await assert.rejects(releaseUnbilledSourcesInTransaction(prisma, 'invoice', '0'.repeat(64), actor, now), { statusCode: 409 });
  assert.equal(invoice.billingSourcesReleasedAt, null);
  addPayment();
  await assert.rejects(previewUnbilledRelease(prisma, 'invoice', actor, now), /payment records/);
  assert.equal(preview.retainsOriginalHistory, true);
});

test('release clears exactly the invoice-owned claims and retains original history', async () => {
  const { prisma, invoice, claims } = fixture();
  const original = structuredClone(invoice.billingSources);
  const preview = await previewUnbilledRelease(prisma, 'invoice', actor, now);
  const result = await releaseUnbilledSourcesInTransaction(prisma, 'invoice', preview.fingerprint, actor, now);
  assert.equal(result.status, 'VOID'); assert.equal(result.billingSourcesReleasedAt, now);
  assert.deepEqual(result.billingSources, original);
  assert.equal(claims.length, 2);
  assert.ok(claims.every(query => query.where.invoiceId === 'invoice' && query.where.invoiced && query.data.invoiceId === null && query.data.invoiced === false));
  await assert.rejects(previewUnbilledRelease(prisma, 'invoice', actor, now), { statusCode: 409 });
});
