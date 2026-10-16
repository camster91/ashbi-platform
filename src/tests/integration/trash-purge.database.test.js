import { randomUUID } from 'node:crypto';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { permanentlyDeleteTrashedItem, restoreTrashedItem } from '../../services/trash-purge.service.js';
import { softDelete } from '../../services/trash.service.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const { PrismaClient } = prismaPkg;
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('real database permanent purge physically removes a soft-deleted record and its ledger', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: databaseUrl });
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
      actor: user,
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
    await purgeFixtureAuditEvents(raw, { ids: [organizationId] });
    if (organizationId) await raw.organization.deleteMany({ where: { id: organizationId } });
    await raw.$disconnect();
  }
});


test('real database resource retention blocks task project and client purge, including archived links', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured', timeout: 120_000,
}, async (t) => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: databaseUrl });
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  // These archive-only rows deliberately remain in the disposable fixture DB;
  // cleanup must not bypass the production no-hard-delete provenance trigger.
  try {
    const organization = await raw.organization.create({ data: { name: 'Retention fixture', slug: `retention-${suffix}` } });
    const actor = await raw.user.create({ data: { organizationId: organization.id, name: 'Retention fixture', email: `retention-${suffix}@example.invalid`, password: randomUUID(), role: 'ADMIN' } });
    const scopedPrisma = createScopedPrisma(raw, organization.id);
    for (const entity of ['TASK', 'PROJECT', 'CLIENT']) {
      for (const archivedAt of [null, new Date('2026-01-01')]) {
        await t.test(`${entity} ${archivedAt ? 'archived' : 'active'} descendant retains original and ledger and supports restore`, async () => {
          const client = await raw.client.create({ data: { organizationId: organization.id, name: 'Retention client' } });
          const project = await raw.project.create({ data: { organizationId: organization.id, clientId: client.id, name: 'Retention project' } });
          const task = await raw.task.create({ data: { projectId: project.id, title: 'Retention task' } });
          const resource = await raw.resourceLink.create({ data: { organizationId: organization.id, projectId: project.id, taskId: task.id, createdById: actor.id, createIntentId: randomUUID(), inputHash: 'a'.repeat(64), title: 'Preserved source', url: 'https://example.invalid/source#exact', source: { system: 'fixture', recordId: 'original' }, archivedAt } });
          const recordId = { TASK: task.id, PROJECT: project.id, CLIENT: client.id }[entity];
          const { trashedItem: ledger } = await softDelete({ scopedPrisma, entity, recordId, organizationId: organization.id });
          await assert.rejects(permanentlyDeleteTrashedItem({ scopedPrisma, rawPrisma: raw, trashId: ledger.id }), { statusCode: 409, code: 'RESOURCE_LINK_RETENTION' });
          assert.ok(await raw.trashedItem.findUnique({ where: { id: ledger.id } }));
          const model = raw[entity.toLowerCase()];
          assert.ok((await model.findUnique({ where: { id: recordId } })).deletedAt);
          assert.deepEqual(await raw.resourceLink.findUnique({ where: { id: resource.id } }), resource);
          await restoreTrashedItem({ scopedPrisma, rawPrisma: raw, trashId: ledger.id, actor });
          assert.equal((await model.findUnique({ where: { id: recordId } })).deletedAt, null);
          assert.ok((await raw.trashedItem.findUnique({ where: { id: ledger.id } })).restoredAt);
        });
      }
    }
    await t.test('unrelated empty task still purges permanently', async () => {
      const client = await raw.client.create({ data: { organizationId: organization.id, name: 'Empty client' } });
      const project = await raw.project.create({ data: { organizationId: organization.id, clientId: client.id, name: 'Empty project' } });
      const task = await raw.task.create({ data: { projectId: project.id, title: 'Empty task' } });
      const { trashedItem: ledger } = await softDelete({ scopedPrisma, entity: 'TASK', recordId: task.id, organizationId: organization.id });
      assert.equal((await permanentlyDeleteTrashedItem({ scopedPrisma, rawPrisma: raw, trashId: ledger.id })).deleted, true);
      assert.equal(await raw.task.findUnique({ where: { id: task.id } }), null);
      assert.equal(await raw.trashedItem.findUnique({ where: { id: ledger.id } }), null);
    });
  } finally { await raw.$disconnect(); }
});
