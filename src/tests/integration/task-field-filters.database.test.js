import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { taskViewWhere } from '../../shared/task-view-filters.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('PostgreSQL JSON field criteria preserve typed zero/false and tenant isolation', { skip: !url && 'Disposable database is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `filters-${key}-${randomUUID()}`);
  try {
    const projects = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Field filter fixture' } });
      const client = await raw.client.create({ data: { organizationId, name: 'Canonical client' } });
      const project = await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Filter project' } }); projects.push(project);
      await raw.task.create({ data: { projectId: project.id, title: 'Matching task', fieldValues: { estimate: 0, approved: false, services: ['Design'], brief: 'ARTWORK', due: '2028-02-29' } } });
      await raw.task.create({ data: { projectId: project.id, title: 'Other task', fieldValues: { estimate: 10, approved: true, services: ['Build'], brief: 'Other', due: '2028-03-10' } } });
    }
    const scoped = createScopedPrisma(raw, orgs[0]);
    const fieldFilters = [{ key: 'estimate', operator: 'EQ', value: 0 }, { key: 'approved', operator: 'EQ', value: false }, { key: 'services', operator: 'HAS', value: 'Design' }, { key: 'brief', operator: 'CONTAINS', value: 'art' }, { key: 'due', operator: 'LTE', value: '2028-02-29' }];
    const rows = await scoped.task.findMany({ where: taskViewWhere({ fieldFilters }) });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Matching task');
    assert.equal(rows[0].projectId, projects[0].id);
    assert.equal(await scoped.task.count({ where: taskViewWhere({ projectId: projects[1].id, fieldFilters }) }), 0);
  } finally {
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
