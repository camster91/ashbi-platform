import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { createProjectBoard, moveTaskBoard, updateProjectBoard } from '../../services/project-boards.service.js';
import { readTaskViews, saveTaskViews } from '../../services/task-views.service.js';
import { saveTaskStages } from '../../services/task-stages.service.js';
import { saveTaskRecurrence, processRecurringTasks } from '../../services/task-recurrence.service.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('boards retain canonical task identity, isolated configuration and database membership boundaries', { skip: !url && 'Disposable database is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `boards-${key}-${randomUUID()}`);
  try {
    const projects = [], people = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Board fixture' } });
      const client = await raw.client.create({ data: { organizationId, name: 'Canonical client' } });
      projects.push(await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Canonical project' } }));
      people.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Owner', password: randomUUID(), role: 'TEAM' } }));
    }
    const scoped = createScopedPrisma(raw, orgs[0]);
    const board = await createProjectBoard(scoped, projects[0].id, { name: 'Delivery' }, people[0]);
    const foreign = await createProjectBoard(createScopedPrisma(raw, orgs[1]), projects[1].id, { name: 'Foreign delivery' }, people[1]);
    const task = await raw.task.create({ data: { projectId: projects[0].id, title: 'Canonical task', status: 'IN_PROGRESS', assigneeId: people[0].id, fieldValues: { estimate: 0, approved: false } } });
    await moveTaskBoard(scoped, task.id, { projectId: projects[0].id, boardId: board.id, revision: 0 }, people[0]);
    const moved = await raw.task.findUnique({ where: { id: task.id } });
    assert.equal(moved.id, task.id); assert.equal(moved.projectId, task.projectId); assert.equal(moved.assigneeId, task.assigneeId); assert.equal(moved.status, task.status);
    assert.deepEqual(moved.fieldValues, task.fieldValues);
    await assert.rejects(moveTaskBoard(scoped, task.id, { projectId: projects[0].id, boardId: foreign.id, revision: 1 }, people[0]), { statusCode: 404 });
    await assert.rejects(raw.task.update({ where: { id: task.id }, data: { boardId: foreign.id } }));
    await assert.rejects(raw.projectBoard.update({ where: { id: board.id }, data: { projectId: projects[1].id, organizationId: orgs[1] } }));
    await saveTaskStages(scoped, projects[0].id, { revision: 0, stages: [{ key: 'review', name: 'Review', status: 'IN_PROGRESS' }] }, board.id);
    await saveTaskViews(scoped, projects[0].id, { revision: 0, views: [{ key: 'delivery', name: 'Delivery', layout: 'TABLE', sort: 'TITLE', filters: {} }] }, board.id);
    assert.equal((await readTaskViews(scoped, projects[0].id, board.id)).views[0].name, 'Delivery');
    assert.deepEqual((await raw.project.findUnique({ where: { id: projects[0].id } })).taskViews, projects[0].taskViews);
    await saveTaskRecurrence(scoped, task.id, { revision: 0, rule: { frequency: 'DAILY', interval: 1, startDate: '2026-01-01', timeZone: 'UTC' } }, new Date('2026-01-01T12:00:00Z'));
    assert.equal((await processRecurringTasks(scoped, { now: new Date('2026-01-01T12:00:00Z') })).generated, 1);
    const occurrence = await raw.task.findFirst({ where: { recurrenceSourceId: task.id } });
    assert.equal(occurrence.boardId, board.id);
    await updateProjectBoard(scoped, projects[0].id, board.id, { revision: 0, archived: true }, people[0]);
    await assert.rejects(raw.task.create({ data: { projectId: projects[0].id, boardId: board.id, title: 'Archived addition' } }));
    assert.equal((await processRecurringTasks(scoped, { now: new Date('2026-01-03T12:00:00Z') })).generated, 0);
    const tools = createWorkspaceTools();
    const ctx = { prisma: scoped, user: people[0], scopes: ['workspace:read', 'workspace:actions'] };
    const prepared = await tools.call(ctx, 'set_task_board', { input: { taskId: task.id, projectId: projects[0].id, boardId: null, revision: 1 }, idempotencyKey: `board-${randomUUID()}` });
    assert.equal((await raw.task.findUnique({ where: { id: task.id } })).boardId, board.id);
    assert.equal(prepared.action.preview.retainsLifecycle, true);
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).action.status, 'EXECUTED');
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).idempotent, true);
    assert.ok(await raw.auditEvent.findFirst({ where: { organizationId: orgs[0], action: 'ai.tool_executed' } }));
    assert.equal((await raw.task.findUnique({ where: { id: task.id } })).boardId, null);
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.projectBoard.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
