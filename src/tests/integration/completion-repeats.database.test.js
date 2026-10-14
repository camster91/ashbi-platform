import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { processCompletionRepeats, saveTaskRecurrence } from '../../services/task-recurrence.service.js';
import { completionRepeatDate } from '../../shared/task-recurrence.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('completion stamping, concurrent claims, early completions and reopened history persist safely', { skip: !url && 'Disposable database is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `complete-repeat-${key}-${randomUUID()}`);
  const rule = { trigger: 'AFTER_COMPLETION', frequency: 'MONTHLY', interval: 1, startDate: '2026-01-01', timeZone: 'America/Toronto' };
  const completedAt = new Date('2026-01-31T17:00:00Z');
  try {
    const projects = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Completion repeat fixture' } });
      const client = await raw.client.create({ data: { organizationId, name: 'Canonical client' } });
      projects.push(await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Repeat project' } }));
    }
    const owner = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Owner', password: randomUUID(), role: 'TEAM' } });
    const root = await raw.task.create({ data: { projectId: projects[0].id, title: 'After completion', assigneeId: owner.id, fieldValues: { score: 0, approved: false } } });
    await raw.taskCollaborator.create({ data: { taskId: root.id, userId: owner.id, organizationId: orgs[0] } });
    const scoped = createScopedPrisma(raw, orgs[0]);
    await saveTaskRecurrence(scoped, root.id, { revision: 0, rule }, completedAt);
    assert.equal((await processCompletionRepeats(scoped)).generated, 0);
    await raw.task.update({ where: { id: root.id }, data: { status: 'COMPLETED', completedAt } });
    await Promise.allSettled([processCompletionRepeats(scoped), processCompletionRepeats(scoped)]);
    const copies = await raw.task.findMany({ where: { recurrenceCompletionSourceId: root.id } });
    assert.equal(copies.length, 1);
    assert.equal(copies[0].dueDate.toISOString().slice(0, 10), '2026-02-28');
    assert.equal(copies[0].assigneeId, owner.id); assert.equal(copies[0].status, 'PENDING');
    assert.deepEqual(copies[0].fieldValues, { score: 0, approved: false });
    assert.equal(copies[0].recurrenceScheduledDate, null);
    assert.equal(await raw.taskCollaborator.count({ where: { taskId: copies[0].id, userId: owner.id } }), 1);
    await raw.task.update({ where: { id: root.id }, data: { status: 'PENDING', completedAt: null } });
    await raw.task.update({ where: { id: root.id }, data: { status: 'COMPLETED', completedAt: new Date('2026-02-02T17:00:00Z'), recurrenceFirstCompletedAt: new Date('2026-02-02T17:00:00Z') } });
    assert.equal(+(await raw.task.findUnique({ where: { id: root.id } })).recurrenceFirstCompletedAt, +completedAt);
    assert.equal((await processCompletionRepeats(scoped)).generated, 0);
    await raw.task.update({ where: { id: copies[0].id }, data: { status: 'COMPLETED', completedAt } });
    assert.equal((await processCompletionRepeats(scoped)).generated, 1);
    const second = await raw.task.findFirst({ where: { recurrenceCompletionSourceId: copies[0].id } });
    assert.equal(second.dueDate.toISOString().slice(0, 10), '2026-02-28', 'early completion can share a due date');
    const historic = await raw.task.create({ data: { projectId: projects[0].id, title: 'Historical completion', status: 'COMPLETED', completedAt } });
    await raw.task.update({ where: { id: historic.id }, data: { status: 'PENDING', completedAt: null } });
    await saveTaskRecurrence(scoped, historic.id, { revision: 0, rule });
    await raw.task.update({ where: { id: historic.id }, data: { status: 'COMPLETED' } });
    assert.equal((await processCompletionRepeats(scoped)).generated, 0, 'configuration never replays reopened historical work');
    const foreign = await raw.task.create({ data: { projectId: projects[1].id, title: 'Foreign root' } });
    await assert.rejects(saveTaskRecurrence(scoped, foreign.id, { revision: 0, rule }), { statusCode: 404 });
    await saveTaskRecurrence(scoped, root.id, { revision: 1, rule: null });
    await raw.task.update({ where: { id: second.id }, data: { status: 'COMPLETED' } });
    assert.equal((await processCompletionRepeats(scoped)).generated, 0);
    assert.equal((await raw.task.findUnique({ where: { id: root.id } })).recurrenceNextDate, null);
    assert.equal(completionRepeatDate(rule, completedAt), '2026-02-28');
  } finally {
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
