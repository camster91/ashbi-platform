import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { saveBoardTemplate, projectFromBoardTemplate, listBoardTemplates, archiveBoardTemplate } from '../../services/board-templates.service.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('board templates persist and create empty canonical projects with tenant isolation and reversible archival', { skip: !url && 'Disposable database is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `boards-${key}-${randomUUID()}`);
  try {
    const clients = [], projects = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, name: 'Board fixture', slug: organizationId } });
      const client = await raw.client.create({ data: { organizationId, name: 'Canonical client' } }); clients.push(client);
      const project = await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Source project', taskStages: [{ key: 'review', name: 'Review', status: 'REVIEW' }], taskFields: [{ key: 'next', name: 'Next action', type: 'TEXT', archived: false }] } }); projects.push(project);
      await raw.task.create({ data: { projectId: project.id, title: 'Source work', fieldValues: { next: 'Private source value' } } });
    }
    const scoped = createScopedPrisma(raw, orgs[0]);
    const template = await saveBoardTemplate(scoped, { projectId: projects[0].id, name: 'Reusable board' });
    assert.equal(template.organizationId, orgs[0]);
    assert.equal((await listBoardTemplates(scoped)).items.length, 1);
    await assert.rejects(saveBoardTemplate(scoped, { projectId: projects[1].id, name: 'Foreign board' }), { statusCode: 404 });
    await assert.rejects(projectFromBoardTemplate(scoped, { templateId: template.id, clientId: clients[1].id, name: 'Foreign client' }), { statusCode: 404 });
    const created = await projectFromBoardTemplate(scoped, { templateId: template.id, clientId: clients[0].id, name: 'Fresh project', portfolio: 'FREELANCE' });
    assert.equal(created.clientId, clients[0].id);
    assert.deepEqual(created.taskStages, projects[0].taskStages);
    assert.deepEqual(created.taskFields, projects[0].taskFields);
    assert.equal(await raw.task.count({ where: { projectId: created.id } }), 0);
    assert.equal(await raw.client.count({ where: { organizationId: orgs[0] } }), 1);
    await archiveBoardTemplate(scoped, template.id, true);
    assert.equal((await listBoardTemplates(scoped)).items.length, 0);
    await assert.rejects(projectFromBoardTemplate(scoped, { templateId: template.id, clientId: clients[0].id, name: 'Archived' }), { statusCode: 404 });
    await archiveBoardTemplate(scoped, template.id, false);
    assert.equal((await listBoardTemplates(scoped)).items.length, 1);
  } finally {
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.projectTemplate.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
