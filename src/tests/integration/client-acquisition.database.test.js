import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import clientAcquisitionRoutes from '../../routes/client-acquisition.routes.js';
import { loadClientAcquisitionConfig } from '../../services/client-acquisition.contract.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('public intake persists one tenant-owned inquiry idempotently against a real database', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    orgA: `intake-org-a-${suffix}`, orgB: `intake-org-b-${suffix}`,
    owner: `intake-owner-${suffix}`, other: `intake-other-${suffix}`,
  };
  const config = loadClientAcquisitionConfig({
    CLIENT_ACQUISITION_ORGANIZATION_ID: ids.orgA,
    CLIENT_ACQUISITION_OWNER_ID: ids.owner,
    CLIENT_ACQUISITION_PRIVACY_VERSION: 'v1',
    CLIENT_ACQUISITION_SERVICE_LINES: 'web_commerce',
    CLIENT_ACQUISITION_ALLOWED_ORIGINS: 'https://ashbi.ca',
  });
  const app = Fastify();
  app.decorate('prisma', raw);
  app.decorate('authenticate', async () => {});
  app.decorate('adminOnly', async () => {});
  await app.register(clientAcquisitionRoutes, { config });

  try {
    await raw.organization.createMany({ data: [
      { id: ids.orgA, name: 'Intake tenant A', slug: `intake-a-${suffix}` },
      { id: ids.orgB, name: 'Intake tenant B', slug: `intake-b-${suffix}` },
    ] });
    await raw.user.createMany({ data: [
      { id: ids.owner, organizationId: ids.orgA, email: `owner-${suffix}@example.invalid`, name: 'Owner', password: 'x', role: 'ADMIN' },
      { id: ids.other, organizationId: ids.orgB, email: `other-${suffix}@example.invalid`, name: 'Other', password: 'x', role: 'ADMIN' },
    ] });

    const payload = {
      idempotencyKey: `idem-${suffix}`,
      name: 'Jordan Rivera',
      email: 'jordan@example.com',
      serviceLine: 'web_commerce',
      businessContext: 'Handmade furniture.',
      requestedOutcome: 'A faster storefront.',
      consent: true,
      privacyVersion: 'v1',
    };
    const send = (body) => app.inject({ method: 'POST', url: '/intake', payload: body, headers: { origin: 'https://ashbi.ca' } });

    assert.equal((await send(payload)).statusCode, 201);
    assert.equal((await send(payload)).statusCode, 200);
    assert.equal((await send({ ...payload, requestedOutcome: 'Different.' })).statusCode, 409);

    const stored = await raw.publicInquiry.findMany({ where: { organizationId: ids.orgA } });
    assert.equal(stored.length, 1);
    assert.equal(stored[0].ownerId, ids.owner);
    assert.equal(stored[0].requestedOutcome, 'A faster storefront.');
    assert.equal(await raw.notification.count({ where: { userId: ids.owner, type: 'inquiry.received' } }), 1);

    // Tenant isolation: another organization's scoped client cannot see it.
    const tenantB = createScopedPrisma(raw, ids.orgB);
    assert.equal((await tenantB.publicInquiry.findMany({})).length, 0);
    const tenantA = createScopedPrisma(raw, ids.orgA);
    assert.equal((await tenantA.publicInquiry.findMany({})).length, 1);

    // Removing the owner keeps the inquiry but clears the assignment.
    await raw.notification.deleteMany({ where: { userId: { in: [ids.owner, ids.other] } } });
    await raw.user.delete({ where: { id: ids.owner } });
    assert.equal((await raw.publicInquiry.findFirst({ where: { organizationId: ids.orgA } })).ownerId, null);

    // Retention: deleting the organization cascades to its inquiries.
    await raw.organization.delete({ where: { id: ids.orgA } });
    assert.equal(await raw.publicInquiry.count({ where: { organizationId: ids.orgA } }), 0);
  } finally {
    await app.close();
    await raw.notification.deleteMany({ where: { userId: { in: [ids.owner, ids.other] } } });
    await raw.publicInquiry.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await raw.user.deleteMany({ where: { id: { in: [ids.owner, ids.other] } } });
    await raw.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
    await raw.$disconnect();
  }
});
