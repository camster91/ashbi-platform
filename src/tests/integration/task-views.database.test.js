import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { readTaskViews, saveTaskViews } from '../../services/task-views.service.js';
import { taskViewWhere } from '../../shared/task-view-filters.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('saved views persist with tenant isolation, correct row filtering and concurrent revisions', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured', timeout: 120_000,
}, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const orgs = ['a', 'b'].map(key => `views-${key}-${randomUUID()}`);
  const view = { key: 'review', name: 'Review queue', layout: 'TABLE', sort: 'PRIORITY', filters: { status: 'REVIEW', search: 'artwork', stageKey: 'review' } };
  try {
    const projects = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, name: 'View fixture', slug: organizationId } });
      const client = await raw.client.create({ data: { organizationId, name: 'View client' } });
      const project = await raw.project.create({ data: { organizationId, clientId: client.id, name: 'View project', taskStages: [{ key: 'review', name: 'Review', status: 'REVIEW' }] } });
      projects.push(project);
      await raw.task.createMany({ data: [
        { projectId: project.id, title: 'Review ARTWORK', status: 'REVIEW', stageKey: 'review' },
        { projectId: project.id, title: 'Other review', status: 'REVIEW', stageKey: 'review' },
      ] });
    }
    const scoped = createScopedPrisma(raw, orgs[0]);
    await saveTaskViews(scoped, projects[0].id, { revision: 0, views: [view] });
    assert.deepEqual((await readTaskViews(scoped, projects[0].id)).views, [view]);
    await assert.rejects(readTaskViews(scoped, projects[1].id), { statusCode: 404 });
    const rows = await scoped.task.findMany({ where: taskViewWhere({ projectId: projects[0].id, ...view.filters }) });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Review ARTWORK');
    const writes = await Promise.allSettled([
      saveTaskViews(scoped, projects[0].id, { revision: 1, views: [{ ...view, name: 'Review one' }] }),
      saveTaskViews(scoped, projects[0].id, { revision: 1, views: [{ ...view, name: 'Review two' }] }),
    ]);
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(writes.find(result => result.status === 'rejected').reason.statusCode, 409);
    await saveTaskViews(scoped, projects[0].id, { revision: 2, views: [] });
    assert.equal(await raw.task.count({ where: { projectId: projects[0].id } }), 2, 'removing a view preserves its tasks');
    assert.equal((await raw.project.findUnique({ where: { id: projects[1].id } })).taskViews, null);
  } finally {
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
