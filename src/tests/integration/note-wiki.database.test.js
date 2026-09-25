import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('wiki hierarchy and templates remain isolated between two real tenants', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    orgA: `wiki-org-a-${suffix}`, orgB: `wiki-org-b-${suffix}`,
    clientA: `wiki-client-a-${suffix}`, clientB: `wiki-client-b-${suffix}`,
    projectA: `wiki-project-a-${suffix}`, projectB: `wiki-project-b-${suffix}`,
    userA: `wiki-user-a-${suffix}`, userB: `wiki-user-b-${suffix}`,
  };
  try {
    await raw.organization.createMany({ data: [
      { id: ids.orgA, name: 'Wiki tenant A', slug: `wiki-a-${suffix}` },
      { id: ids.orgB, name: 'Wiki tenant B', slug: `wiki-b-${suffix}` },
    ] });
    await raw.client.createMany({ data: [
      { id: ids.clientA, organizationId: ids.orgA, name: 'Wiki client A' },
      { id: ids.clientB, organizationId: ids.orgB, name: 'Wiki client B' },
    ] });
    await raw.project.createMany({ data: [
      { id: ids.projectA, organizationId: ids.orgA, clientId: ids.clientA, name: 'Wiki project A' },
      { id: ids.projectB, organizationId: ids.orgB, clientId: ids.clientB, name: 'Wiki project B' },
    ] });
    await raw.user.createMany({ data: [
      { id: ids.userA, organizationId: ids.orgA, email: `wiki-a-${suffix}@example.test`, password: 'test', name: 'Wiki A' },
      { id: ids.userB, organizationId: ids.orgB, email: `wiki-b-${suffix}@example.test`, password: 'test', name: 'Wiki B' },
    ] });

    const tenantA = createScopedPrisma(raw, ids.orgA);
    const tenantB = createScopedPrisma(raw, ids.orgB);
    const root = await tenantA.note.create({
      data: { title: 'Project home', content: '', type: 'WIKI', projectId: ids.projectA, authorId: ids.userA, isTemplate: true },
    });
    const child = await tenantA.note.create({
      data: { title: 'Nested guide', content: '', type: 'DOC', projectId: ids.projectA, authorId: ids.userA, parentId: root.id, mentions: JSON.stringify([ids.userA]) },
    });
    assert.equal(child.parentId, root.id);
    assert.equal(await tenantB.note.findUnique({ where: { id: root.id } }), null);
    assert.equal((await tenantB.note.findMany({ where: { isTemplate: true } })).length, 0);
    await assert.rejects(
      tenantA.note.create({ data: { title: 'Cross tenant', content: '', projectId: ids.projectB, authorId: ids.userA } }),
      /does not belong to organization/i,
    );
    // Cycle prevention is enforced in the database by the note hierarchy
    // trigger (migration 20260809111500_note_hierarchy_templates_mentions), so
    // every write path is covered — not only validateParent in note.routes.js.
    // This requires a schema built with `prisma migrate deploy`; `db push`
    // does not install the trigger.
    await assert.rejects(
      tenantA.note.update({ where: { id: root.id }, data: { parentId: child.id } }),
      /cycle/i,
    );

    await assert.rejects(
      tenantA.note.update({ where: { id: root.id }, data: { projectId: ids.projectB } }),
      /does not belong to organization/i,
    );
  } finally {
    await raw.notification.deleteMany({ where: { userId: { in: [ids.userA, ids.userB] } } });
    await raw.note.deleteMany({ where: { projectId: { in: [ids.projectA, ids.projectB] } } });
    await raw.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB] } } });
    await raw.project.deleteMany({ where: { id: { in: [ids.projectA, ids.projectB] } } });
    await raw.client.deleteMany({ where: { id: { in: [ids.clientA, ids.clientB] } } });
    await raw.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
    await raw.$disconnect();
  }
});
