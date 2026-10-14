import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { taskRelationLabels } from '../../services/task-relation-labels.service.js';
import { groupTaskViewRows } from '../../shared/task-view-groups.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('canonical relation names are scoped for all target types on raw and tenant clients', { skip: !url && 'Disposable database is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `relation-group-${key}-${randomUUID()}`);
  const fields = ['CLIENT', 'PROJECT', 'PERSON', 'TASK'].map(target => ({ key: target.toLowerCase(), name: target, type: 'RELATION', target }));
  try {
    const clients = [], projects = [], people = [], targets = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Relation fixture' } });
      clients.push(await raw.client.create({ data: { organizationId, name: organizationId === orgs[0] ? 'Named client' : 'Foreign private client' } }));
      projects.push(await raw.project.create({ data: { organizationId, clientId: clients.at(-1).id, name: 'Named project', taskFields: fields } }));
      people.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Named staff', password: randomUUID(), role: 'TEAM' } }));
      targets.push(await raw.task.create({ data: { projectId: projects.at(-1).id, title: 'Named task' } }));
    }
    const values = index => ({ client: clients[index].id, project: projects[index].id, person: people[index].id, task: targets[index].id });
    const good = await raw.task.create({ data: { projectId: projects[0].id, title: 'Valid relations', fieldValues: values(0) } });
    const bad = await raw.task.create({ data: { projectId: projects[0].id, title: 'Unavailable historical relations', fieldValues: values(1) } });
    const actor = people[0];
    for (const prisma of [raw, createScopedPrisma(raw, orgs[0])]) {
      for (const field of fields) {
        const rows = await taskRelationLabels(prisma, projects[0].id, field.key, [good, bad], actor);
        assert.ok(rows[0].fieldRelations[field.key].name);
        assert.equal(rows[1].fieldRelations[field.key], null);
        assert.deepEqual(rows[1].fieldValues, bad.fieldValues);
        const groups = groupTaskViewRows(rows, { by: 'FIELD', fieldKey: field.key }, fields);
        assert.ok(groups.some(group => group.label === 'Unavailable related record'));
        assert.equal(groups.flatMap(group => group.tasks).length, 2);
      }
    }
    await raw.user.update({ where: { id: people[0].id }, data: { isActive: false } });
    assert.equal((await taskRelationLabels(raw, projects[0].id, 'person', [good], actor))[0].fieldRelations.person, null);
    await raw.task.update({ where: { id: targets[0].id }, data: { deletedAt: new Date() } });
    assert.equal((await taskRelationLabels(raw, projects[0].id, 'task', [good], actor))[0].fieldRelations.task, null);
    await raw.project.update({ where: { id: projects[0].id }, data: { taskFields: fields.map(field => ({ ...field, archived: true })) } });
    await assert.rejects(taskRelationLabels(raw, projects[0].id, 'client', [good], actor), { statusCode: 400 });
  } finally {
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
