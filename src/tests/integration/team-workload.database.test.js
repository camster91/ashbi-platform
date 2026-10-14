import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { readTeamWorkload, readTeamAllocations } from '../../services/team-workload.service.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('database workload preserves full counts, contributor roles, capacity hours and tenant isolation', { skip: !url && 'Disposable database is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `workload-${key}-${randomUUID()}`);
  const now = new Date('2026-10-14T00:00:00Z');
  try {
    const users = [], projects = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Workload fixture' } });
      users.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Owner', password: randomUUID(), role: 'TEAM', capacity: 40 } }));
      const client = await raw.client.create({ data: { organizationId, name: 'Canonical client' } });
      projects.push(await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Workload project' } }));
    }
    const helper = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Contributor', password: randomUUID(), role: 'TEAM', capacity: 0 } });
    const tasks = Array.from({ length: 125 }, () => ({ id: randomUUID(), projectId: projects[0].id, assigneeId: users[0].id, title: 'Counted work' }));
    await raw.task.createMany({ data: tasks });
    await raw.taskCollaborator.createMany({ data: tasks.map(task => ({ taskId: task.id, userId: helper.id, organizationId: orgs[0] })) });
    await raw.task.create({ data: { projectId: projects[0].id, assigneeId: users[0].id, title: 'Completed', status: 'COMPLETED' } });
    await raw.task.create({ data: { projectId: projects[0].id, assigneeId: users[0].id, title: 'Deleted', deletedAt: now } });
    await raw.task.create({ data: { projectId: projects[1].id, assigneeId: users[0].id, title: 'Foreign project assignment' } });
    await raw.timeEntry.createMany({ data: [
      { projectId: projects[0].id, userId: users[0].id, duration: 3000, date: now },
      { projectId: projects[0].id, userId: users[0].id, duration: 6000, date: new Date('2026-10-15T00:00:00Z') },
      { projectId: projects[0].id, userId: users[0].id, duration: 6000, date: now, deletedAt: now },
      { projectId: projects[1].id, userId: users[1].id, duration: 6000, date: now },
    ] });
    for (const prisma of [raw, createScopedPrisma(raw, orgs[0])]) {
      const rows = await readTeamWorkload(prisma, users[0], now);
      assert.equal(rows.length, 2);
      const owner = rows.find(row => row.id === users[0].id);
      assert.equal(owner.activeTasks, 125); assert.equal(owner.contributedTasks, 0);
      assert.equal(owner.weeklyHours, 50); assert.equal(owner.utilizationPercent, 125);
      const contributor = rows.find(row => row.id === helper.id);
      assert.equal(contributor.contributedTasks, 125); assert.equal(contributor.activeTasks, 0);
      assert.equal(contributor.utilizationPercent, null);
      const allocations = await readTeamAllocations(prisma, users[0], now);
      assert.equal(allocations.allocations.find(row => row.id === users[0].id).projects[0].taskCount, 125);
    }
  } finally {
    await raw.timeEntry.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
