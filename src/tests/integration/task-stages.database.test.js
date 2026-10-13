import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { saveTaskStages, resolveTaskStage, withStageTransaction } from '../../services/task-stages.service.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('project stages persist with tenant isolation, occupied-stage protection and concurrent revision conflicts', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured', timeout: 120_000,
}, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const orgs = [`stages-a-${suffix}`, `stages-b-${suffix}`];
  const stage = { key: 'review', name: 'Design review', status: 'REVIEW' };
  try {
    const projects = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, name: 'Stage fixture', slug: organizationId } });
      const client = await raw.client.create({ data: { organizationId, name: 'Stage client' } });
      projects.push(await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Stage project' } }));
    }
    const scoped = createScopedPrisma(raw, orgs[0]);
    await saveTaskStages(scoped, projects[0].id, { revision: 0, stages: [stage] });
    const saved = await raw.project.findUnique({ where: { id: projects[0].id } });
    assert.deepEqual(saved.taskStages, [stage]);
    assert.equal(saved.boardRevision, 1);
    await assert.rejects(saveTaskStages(scoped, projects[1].id, { revision: 0, stages: [stage] }), { statusCode: 404 });
    assert.equal((await raw.project.findUnique({ where: { id: projects[1].id } })).boardRevision, 0);
    await withStageTransaction(scoped, async tx => {
      const selected = await resolveTaskStage(tx, projects[0].id, 'review');
      await tx.task.create({ data: { projectId: projects[0].id, title: 'Review artwork', stageKey: selected.key, status: selected.status } });
    });
    await assert.rejects(saveTaskStages(scoped, projects[0].id, { revision: 1, stages: [{ ...stage, key: 'replacement' }] }), { statusCode: 409 });
    assert.equal(await raw.task.count({ where: { projectId: projects[0].id, stageKey: 'review' } }), 1);
    const attempts = await Promise.allSettled([
      saveTaskStages(scoped, projects[0].id, { revision: 1, stages: [{ ...stage, name: 'Review one' }] }),
      saveTaskStages(scoped, projects[0].id, { revision: 1, stages: [{ ...stage, name: 'Review two' }] }),
    ]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(result => result.status === 'rejected').reason.statusCode, 409);
    assert.equal((await raw.project.findUnique({ where: { id: projects[0].id } })).boardRevision, 2);
  } finally {
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
