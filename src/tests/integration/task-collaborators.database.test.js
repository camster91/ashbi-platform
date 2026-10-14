import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { readTaskCollaborators, saveTaskCollaborators } from '../../services/task-collaborators.service.js';
import { taskParticipationWhere } from '../../shared/task-participation.js';
import { saveTaskRecurrence, processRecurringTasks } from '../../services/task-recurrence.service.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('persisted contributors retain owner/join dates and enforce both tenant boundaries', { skip: !url && 'Disposable database is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `collaboration-${key}-${randomUUID()}`);
  const fixturePassword = () => randomUUID();
  try {
    for (const id of orgs) await raw.organization.create({ data: { id, slug: id, name: 'Collaboration fixture' } });
    const owner = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Owner', password: fixturePassword(), role: 'TEAM' } });
    const helper = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Helper', password: fixturePassword(), role: 'TEAM' } });
    const foreign = await raw.user.create({ data: { organizationId: orgs[1], email: `${randomUUID()}@e2e.example.test`, name: 'Foreign', password: fixturePassword(), role: 'TEAM' } });
    const client = await raw.client.create({ data: { organizationId: orgs[0], name: 'Canonical client' } });
    const project = await raw.project.create({ data: { organizationId: orgs[0], clientId: client.id, name: 'Collaborative project' } });
    const task = await raw.task.create({ data: { projectId: project.id, title: 'Shared work', assigneeId: owner.id } });
    const scoped = createScopedPrisma(raw, orgs[0]);
    await saveTaskCollaborators(scoped, task.id, { revision: 0, userIds: [helper.id] }, owner);
    const first = await raw.taskCollaborator.findFirst({ where: { taskId: task.id } });
    await saveTaskCollaborators(scoped, task.id, { revision: 1, userIds: [helper.id] }, owner);
    const retained = await raw.taskCollaborator.findFirst({ where: { taskId: task.id } });
    assert.equal(retained.id, first.id); assert.equal(+retained.createdAt, +first.createdAt);
    assert.equal((await raw.task.findUnique({ where: { id: task.id } })).assigneeId, owner.id);
    assert.equal(await scoped.task.count({ where: taskParticipationWhere(helper.id) }), 1);
    await assert.rejects(saveTaskCollaborators(scoped, task.id, { revision: 2, userIds: [foreign.id] }, owner), { statusCode: 404 });
    await assert.rejects(readTaskCollaborators(createScopedPrisma(raw, orgs[1]), task.id, foreign), { statusCode: 404 });
    await assert.rejects(raw.taskCollaborator.create({ data: { taskId: task.id, userId: foreign.id, organizationId: orgs[0] } }));
    await assert.rejects(raw.user.update({ where: { id: helper.id }, data: { organizationId: orgs[1] } }));
    const inactive = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Inactive', password: fixturePassword(), role: 'TEAM', isActive: false } });
    const clientPrincipal = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Client principal', password: fixturePassword(), role: 'CLIENT' } });
    for (const member of [inactive, clientPrincipal]) {
      await assert.rejects(saveTaskCollaborators(scoped, task.id, { revision: 2, userIds: [helper.id, member.id] }, owner), { statusCode: 404 });
      await assert.rejects(raw.taskCollaborator.create({ data: { taskId: task.id, userId: member.id, organizationId: orgs[0] } }));
    }
    await saveTaskCollaborators(scoped, task.id, { revision: 2, userIds: [helper.id, owner.id] }, owner);
    await raw.user.update({ where: { id: helper.id }, data: { isActive: false } });
    const preserved = await saveTaskCollaborators(scoped, task.id, { revision: 3, userIds: [helper.id, owner.id] }, owner);
    assert.equal(preserved.collaborators.find(member => member.id === helper.id).isActive, false);
    const now = new Date('2026-01-31T17:00:00Z');
    await saveTaskRecurrence(scoped, task.id, { revision: 0, rule: { frequency: 'MONTHLY', interval: 1, startDate: '2026-01-31', timeZone: 'America/Toronto' } }, now);
    assert.equal((await processRecurringTasks(scoped, { now })).generated, 1);
    const occurrence = await raw.task.findFirst({ where: { recurrenceSourceId: task.id } });
    assert.equal(occurrence.assigneeId, owner.id);
    const copied = await raw.taskCollaborator.findMany({ where: { taskId: occurrence.id } });
    assert.deepEqual(copied.map(row => row.userId), [owner.id], 'inactive retained contributor is excluded from the new occurrence');
    assert.equal((await processRecurringTasks(scoped, { now })).generated, 0);
    assert.equal(await raw.taskCollaborator.count({ where: { taskId: occurrence.id } }), 1);
  } finally {
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
