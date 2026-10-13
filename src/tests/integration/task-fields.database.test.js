import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { readTaskFields, saveTaskFieldDefinitions, saveTaskFieldValues, taskFieldOptions } from '../../services/task-fields.service.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('typed fields persist, isolate related records and reject concurrent stale values without losing content', { skip: !url && 'Disposable database is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `fields-${key}-${randomUUID()}`);
  try {
    const clients = [], tasks = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, name: 'Fields fixture', slug: organizationId } });
      const client = await raw.client.create({ data: { organizationId, name: `Client ${organizationId}` } }); clients.push(client);
      const project = await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Fields project' } });
      tasks.push(await raw.task.create({ data: { projectId: project.id, title: 'Fixture task', content: '[{"type":"paragraph","content":"Preserve"}]', properties: '{"legacy":true}' } }));
    }
    const scoped = createScopedPrisma(raw, orgs[0]);
    const fields = [{ key: 'brief', name: 'Brief', type: 'TEXT', archived: false }, { key: 'client', name: 'Client', type: 'RELATION', target: 'CLIENT', archived: false }];
    await saveTaskFieldDefinitions(scoped, tasks[0].projectId, { revision: 0, fields });
    await saveTaskFieldValues(scoped, tasks[0].id, { revision: 0, definitionRevision: 1, values: { brief: 'Review', client: clients[0].id } });
    assert.equal((await readTaskFields(scoped, tasks[0].id)).relations.client.name, clients[0].name);
    await assert.rejects(saveTaskFieldValues(scoped, tasks[0].id, { revision: 1, definitionRevision: 1, values: { client: clients[1].id } }), { statusCode: 404 });
    await assert.rejects(readTaskFields(scoped, tasks[1].id), { statusCode: 404 });
    assert.equal((await taskFieldOptions(scoped, tasks[0].id, 'client')).items.length, 1);
    const writes = await Promise.allSettled(['One', 'Two'].map(brief => saveTaskFieldValues(scoped, tasks[0].id, { revision: 1, definitionRevision: 1, values: { brief } })));
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(writes.find(result => result.status === 'rejected').reason.statusCode, 409);
    await saveTaskFieldDefinitions(scoped, tasks[0].projectId, { revision: 1, fields: fields.map(field => ({ ...field, archived: true })) });
    const stored = await raw.task.findUnique({ where: { id: tasks[0].id } });
    assert.equal(stored.fieldValues.client, clients[0].id);
    assert.equal(stored.content, tasks[0].content);
    assert.equal(stored.properties, tasks[0].properties);
  } finally {
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
