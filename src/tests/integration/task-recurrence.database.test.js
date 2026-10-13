import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { processRecurringTasks, saveTaskRecurrence } from '../../services/task-recurrence.service.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('recurrence persists, generates exactly once, survives retry, and rejects foreign-tenant writes', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured', timeout: 120_000,
}, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const orgs = ['a', 'b'].map(key => `repeat-${key}-${randomUUID()}`);
  const now = new Date('2026-01-31T17:00:00Z');
  const rule = { frequency: 'MONTHLY', interval: 1, startDate: '2026-01-31', timeZone: 'America/Toronto' };
  try {
    const sources = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, name: 'Recurrence fixture', slug: organizationId } });
      const client = await raw.client.create({ data: { organizationId, name: 'Repeat client' } });
      const project = await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Repeat project' } });
      sources.push(await raw.task.create({ data: { projectId: project.id, title: 'Review results', status: 'COMPLETED', content: '[]', priority: 'HIGH' } }));
    }
    const scoped = createScopedPrisma(raw, orgs[0]);
    await saveTaskRecurrence(scoped, sources[0].id, { revision: 0, rule }, now);
    await assert.rejects(saveTaskRecurrence(scoped, sources[1].id, { revision: 0, rule }, now), { statusCode: 404 });
    await Promise.allSettled([processRecurringTasks(scoped, { now }), processRecurringTasks(scoped, { now })]);
    const instances = await raw.task.findMany({ where: { recurrenceSourceId: sources[0].id } });
    assert.equal(instances.length, 1);
    assert.equal(instances[0].status, 'PENDING');
    assert.equal(instances[0].projectId, sources[0].projectId);
    assert.equal(instances[0].recurrenceRule, null);
    assert.equal(instances[0].stageKey, null);
    assert.equal((await processRecurringTasks(scoped, { now })).generated, 0);
    const source = await raw.task.findUnique({ where: { id: sources[0].id } });
    assert.equal(source.recurrenceNextDate.toISOString().slice(0, 10), '2026-02-28');
    await raw.task.update({ where: { id: instances[0].id }, data: { deletedAt: now } });
    await saveTaskRecurrence(scoped, source.id, { revision: source.recurrenceRevision, rule }, now);
    assert.equal((await processRecurringTasks(scoped, { now })).generated, 0, 'deleted instances are never replayed');
    const current = await raw.task.findUnique({ where: { id: source.id } });
    await saveTaskRecurrence(scoped, source.id, { revision: current.recurrenceRevision, rule: null }, now);
    assert.equal((await processRecurringTasks(scoped, { now: new Date('2026-03-01T17:00:00Z') })).generated, 0);
    assert.equal(await raw.task.count({ where: { projectId: sources[1].projectId } }), 1);
  } finally {
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
