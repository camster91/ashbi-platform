import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { updateDraftInvoice } from '../../services/invoice-draft.service.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('draft line replacement rolls back failures, rejects status/tenant races and has one concurrent winner', {
  skip: !url && 'Disposable database is not configured', timeout: 120_000,
}, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const organizations = ['a', 'b'].map(key => `invoice-edit-${key}-${randomUUID()}`);
  const line = amount => ({ description: 'Reviewed work', quantity: 1, unitPrice: amount, total: amount, itemType: 'LABOR', position: 0 });
  try {
    const invoices = [];
    for (const organizationId of organizations) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Draft edit fixture' } });
      const user = await raw.user.create({ data: { organizationId, name: 'Admin', role: 'ADMIN', email: `${randomUUID()}@e2e.example.test`, password: randomUUID() } });
      const client = await raw.client.create({ data: { organizationId, name: 'Canonical client' } });
      invoices.push(await raw.invoice.create({ data: { organizationId, clientId: client.id, createdById: user.id,
        invoiceNumber: 'FIXTURE-1', title: 'Original', subtotal: 100, taxRate: 0, tax: 0, total: 100, lineItems: { create: line(100) } } }));
    }
    const scoped = createScopedPrisma(raw, organizations[0]);
    const original = invoices[0];
    const read = () => raw.invoice.findUnique({ where: { id: original.id }, include: { lineItems: true } });
    const before = await read();
    await assert.rejects(updateDraftInvoice(scoped, original, { data: { title: 'Rejected' }, lineItems: [{ ...line(50), description: null }] }, organizations[0]));
    assert.deepEqual(await read(), before, 'line insertion failure must restore the original header and lines');
    await assert.rejects(updateDraftInvoice(scoped, original, { data: { dueDate: 'invalid date' }, lineItems: [line(50)] }, organizations[0]));
    assert.deepEqual(await read(), before, 'late header failure must roll back already replaced lines');
    await assert.rejects(updateDraftInvoice(raw, original, { data: { title: 'Foreign edit' }, lineItems: [line(50)] }, organizations[1]), { statusCode: 404 });
    assert.deepEqual(await read(), before);
    const race = await Promise.allSettled([50, 75].map(amount => updateDraftInvoice(scoped, original, { data: { title: `Winner ${amount}` }, lineItems: [line(amount)] }, organizations[0])));
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(race.find(result => result.status === 'rejected').reason.statusCode, 409);
    const winner = await read();
    assert.equal(winner.lineItems.length, 1);
    assert.equal(winner.total, winner.lineItems[0].total);
    assert.equal(winner.title, `Winner ${winner.total}`);
    assert.ok(winner.updatedAt > before.updatedAt);
    await raw.invoice.update({ where: { id: original.id }, data: { status: 'SENT' } });
    await assert.rejects(updateDraftInvoice(scoped, winner, { data: { title: 'Late edit' }, lineItems: [line(5)] }, organizations[0]), { statusCode: 409 });
    const sent = await read();
    assert.equal(sent.status, 'SENT'); assert.equal(sent.title, winner.title);
    assert.deepEqual(sent.lineItems, winner.lineItems);
  } finally {
    await raw.invoiceLineItem.deleteMany({ where: { invoice: { organizationId: { in: organizations } } } });
    await raw.invoice.deleteMany({ where: { organizationId: { in: organizations } } });
    await raw.client.deleteMany({ where: { organizationId: { in: organizations } } });
    await raw.user.deleteMany({ where: { organizationId: { in: organizations } } });
    await raw.organization.deleteMany({ where: { id: { in: organizations } } });
    await raw.$disconnect();
  }
});
