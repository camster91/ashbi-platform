import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('two organizations remain isolated across CRUD, bulk, upsert, and nested writes', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
}, async () => {
  const { PrismaClient } = prismaPkg;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    orgA: `org-a-${suffix}`,
    orgB: `org-b-${suffix}`,
    clientA: `client-a-${suffix}`,
    clientB: `client-b-${suffix}`,
  };

  try {
    await prisma.organization.createMany({ data: [
      { id: ids.orgA, name: 'Tenant A', slug: `tenant-a-${suffix}` },
      { id: ids.orgB, name: 'Tenant B', slug: `tenant-b-${suffix}` },
    ] });
    await prisma.client.createMany({ data: [
      { id: ids.clientA, name: 'Client A', organizationId: ids.orgA },
      { id: ids.clientB, name: 'Client B', organizationId: ids.orgB },
    ] });

    const tenantA = createScopedPrisma(prisma, ids.orgA);
    assert.equal(await tenantA.client.findUnique({ where: { id: ids.clientB } }), null);
    await assert.rejects(
      tenantA.project.create({ data: { name: 'Cross tenant', clientId: ids.clientB } }),
      /does not belong to organization/i,
    );
    await assert.rejects(
      tenantA.invoice.create({ data: { invoiceNumber: `INV-${suffix}`, clientId: ids.clientB } }),
      /does not belong to organization/i,
    );

    await tenantA.template.createMany({ data: [
      { name: 'Bulk A', body: 'A', category: 'GENERAL', organizationId: ids.orgB },
      { name: 'Bulk B', body: 'B', category: 'GENERAL' },
    ] });
    const templates = await tenantA.template.findMany({ where: { name: { in: ['Bulk A', 'Bulk B'] } } });
    assert.equal(templates.length, 2);
    assert.deepEqual(new Set(templates.map(({ organizationId }) => organizationId)), new Set([ids.orgA]));

    const template = await tenantA.template.upsert({
      where: { id: `template-${suffix}` },
      create: { id: `template-${suffix}`, name: 'Upsert', body: 'A', category: 'GENERAL', organizationId: ids.orgB },
      update: { body: 'B', organizationId: ids.orgB },
    });
    assert.equal(template.organizationId, ids.orgA);
  } finally {
    await prisma.template.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await prisma.project.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await prisma.client.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
    await prisma.$disconnect();
  }
});
