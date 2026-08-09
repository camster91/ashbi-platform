import test from 'node:test';
import assert from 'node:assert/strict';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { permanentlyDeleteTrashedItem, restoreTrashedItem } from '../../services/trash-purge.service.js';
import { softDelete } from '../../services/trash.service.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

const { PrismaClient } = prismaPkg;
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('real database permanent purge physically removes a soft-deleted record and its ledger', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let organizationId;
  let userId;
  let clientId;
  let projectId;

  try {
    const organization = await raw.organization.create({
      data: { name: `Purge proof ${suffix}`, slug: `purge-proof-${suffix}` },
    });
    organizationId = organization.id;
    const user = await raw.user.create({
      data: {
        organizationId,
        email: `purge-proof-${suffix}@example.test`,
        name: 'Purge Proof',
        password: 'not-a-real-password-hash',
      },
    });
    userId = user.id;
    const client = await raw.client.create({ data: { organizationId, name: `Purge client ${suffix}` } });
    clientId = client.id;
    const project = await raw.project.create({
      data: { organizationId, clientId: client.id, name: `Purge project ${suffix}` },
    });
    projectId = project.id;
    const note = await raw.note.create({
      data: {
        projectId: project.id,
        authorId: user.id,
        title: `Purge note ${suffix}`,
        content: 'physical deletion proof',
      },
    });
    const scopedPrisma = createScopedPrisma(raw, organizationId);
    const { trashedItem: firstLedger } = await softDelete({
      scopedPrisma,
      entity: 'NOTE',
      recordId: note.id,
      organizationId,
    });
    assert.notEqual((await raw.note.findUnique({ where: { id: note.id } })).deletedAt, null);
    const restored = await restoreTrashedItem({
      scopedPrisma,
      rawPrisma: raw,
      trashId: firstLedger.id,
    });
    assert.equal(restored.restoredId, note.id);
    assert.equal((await raw.note.findUnique({ where: { id: note.id } })).deletedAt, null);

    const { trashedItem: ledger } = await softDelete({
      scopedPrisma,
      entity: 'NOTE',
      recordId: note.id,
      organizationId,
    });

    const result = await permanentlyDeleteTrashedItem({
      scopedPrisma,
      rawPrisma: raw,
      trashId: ledger.id,
    });

    assert.deepEqual(result, { deleted: true, recordId: note.id, entity: 'NOTE' });
    assert.equal(await raw.note.findUnique({ where: { id: note.id } }), null);
    assert.equal(await raw.trashedItem.findUnique({ where: { id: ledger.id } }), null);
  } finally {
    if (projectId) await raw.project.deleteMany({ where: { id: projectId } });
    if (clientId) await raw.client.deleteMany({ where: { id: clientId } });
    if (userId) await raw.user.deleteMany({ where: { id: userId } });
    if (organizationId) await raw.organization.deleteMany({ where: { id: organizationId } });
    await raw.$disconnect();
  }
});
