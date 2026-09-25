// Real-database proof that the audit log is append-only and tenant-scoped.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { recordAuditEvent } from '../../services/audit-event.service.js';
import auditEventRoutes from '../../routes/audit-event.routes.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const APPEND_ONLY = /append-only/i;

test('audit events cannot be altered or removed and stay inside their tenant', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const orgA = `audit-org-a-${suffix}`;
  const orgB = `audit-org-b-${suffix}`;
  let app;

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Audit Tenant A', slug: `audit-a-${suffix}` },
      { id: orgB, name: 'Audit Tenant B', slug: `audit-b-${suffix}` },
    ] });
    await raw.client.create({ data: { id: `audit-client-b-${suffix}`, name: 'Client B', organizationId: orgB } });

    const tenantA = createScopedPrisma(raw, orgA);
    const tenantB = createScopedPrisma(raw, orgB);

    // A request-scoped write cannot forge another tenant's organizationId.
    const forged = await recordAuditEvent(tenantA, {
      organizationId: orgB, actorUserId: 'user-a', actorType: 'USER', action: 'invoice.sent',
      entityId: 'inv-a', requestId: 'req-1', ip: '203.0.113.9', metadata: { total: 10, password: 'x' },
    });
    assert.equal(forged.organizationId, orgA);
    assert.equal(forged.ip, '203.0.113.0/24');
    assert.deepEqual(forged.metadata, { total: 10 });

    // A public/webhook write resolves its tenant from the owning client.
    const owned = await recordAuditEvent(raw, {
      ownerClientId: `audit-client-b-${suffix}`, actorType: 'CLIENT', action: 'contract.signed', entityId: 'k-b',
    });
    assert.equal(owned.organizationId, orgB);

    assert.deepEqual((await tenantA.auditEvent.findMany({})).map((row) => row.id), [forged.id]);
    assert.deepEqual((await tenantB.auditEvent.findMany({})).map((row) => row.id), [owned.id]);
    assert.equal(await tenantA.auditEvent.findFirst({ where: { id: owned.id } }), null);
    assert.equal(await tenantB.auditEvent.count({ where: { id: forged.id } }), 0);

    // Database-level immutability, even through the unscoped client and SQL.
    await assert.rejects(raw.auditEvent.update({ where: { id: forged.id }, data: { action: 'invoice.paid' } }), APPEND_ONLY);
    await assert.rejects(raw.auditEvent.updateMany({ where: { organizationId: orgA }, data: { entityId: 'x' } }), APPEND_ONLY);
    await assert.rejects(raw.auditEvent.delete({ where: { id: forged.id } }), APPEND_ONLY);
    await assert.rejects(raw.auditEvent.deleteMany({ where: { organizationId: orgA } }), APPEND_ONLY);
    await assert.rejects(raw.$executeRawUnsafe('UPDATE "audit_events" SET "action" = $1 WHERE "id" = $2', 'invoice.paid', forged.id), APPEND_ONLY);
    await assert.rejects(raw.$executeRawUnsafe('DELETE FROM "audit_events" WHERE "id" = $1', forged.id), APPEND_ONLY);
    await assert.rejects(raw.$executeRawUnsafe('TRUNCATE "audit_events"'), APPEND_ONLY);
    // Application-level: the scoped client offers no mutation path either.
    await assert.rejects(tenantA.auditEvent.update({ where: { id: forged.id }, data: { action: 'invoice.paid' } }), APPEND_ONLY);
    await assert.rejects(tenantA.auditEvent.deleteMany({}), APPEND_ONLY);

    const unchanged = await raw.auditEvent.findUnique({ where: { id: forged.id } });
    assert.equal(unchanged.action, 'invoice.sent');
    assert.equal(unchanged.entityId, 'inv-a');

    // Constraints the Prisma schema cannot express.
    await assert.rejects(raw.auditEvent.create({ data: { organizationId: orgA, actorType: 'ROOT', action: 'invoice.sent', entityType: 'invoice' } }), /actorType_check/);
    await assert.rejects(raw.auditEvent.create({ data: { organizationId: orgA, actorType: 'USER', action: 'Invoice Sent', entityType: 'invoice' } }), /action_format_check/);
    // An organization with audit history cannot be hard-deleted.
    await assert.rejects(raw.organization.delete({ where: { id: orgA } }), /foreign key|audit_events_organizationId_fkey|P2003|restrict/i);

    // The admin API reads through the same scoped client.
    app = Fastify({ logger: false });
    app.decorate('adminOnly', async (request) => { request.user = { id: 'admin-a', role: 'ADMIN', organizationId: orgA }; });
    app.addHook('onRequest', async (request) => { request.prisma = createScopedPrisma(raw, orgA); });
    await app.register(auditEventRoutes);
    const response = await app.inject({ method: 'GET', url: '/?limit=5' });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().events.map((event) => event.id), [forged.id]);
  } finally {
    await app?.close();
    // Shared test-only teardown (see src/tests/helpers/audit-cleanup.js);
    // organizations are then deleted with foreign keys enforced.
    if (await purgeFixtureAuditEvents(raw, { ids: [orgA, orgB] })) {
      assert.equal(await raw.auditEvent.count({ where: { organizationId: { in: [orgA, orgB] } } }), 0);
      await raw.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
      await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await raw.$disconnect();
  }
});
