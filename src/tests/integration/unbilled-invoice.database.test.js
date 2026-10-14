import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { listUnbilledCandidates, previewUnbilledInvoice } from '../../services/unbilled-invoice.service.js';

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
    await raw.user.update({ where: { id: actors[0].id }, data: { role: 'TEAM' } });
    await assert.rejects(listUnbilledCandidates(raw, { clientId: clients[0].id, kind: 'TIME' }, actors[0]), { statusCode: 403 });
  } finally {
    await raw.timeEntry.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.expense.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
