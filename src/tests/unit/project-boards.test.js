import test from 'node:test';
import assert from 'node:assert/strict';
import { listProjectBoards, createProjectBoard, updateProjectBoard } from '../../services/project-boards.service.js';

const actor = { id: 'staff', role: 'TEAM', organizationId: 'org-a' };
function fixture() {
  const project = { id: 'project', name: 'Canonical project', taskStages: [{ key: 'review', name: 'Review', status: 'IN_PROGRESS' }], taskViews: [], boardRevision: 3, taskViewsRevision: 2 };
  const boards = [{ id: 'b1', name: 'Design', organizationId: 'org-a', projectId: 'project', revision: 0, archivedAt: null, _count: { tasks: 2 } }, { id: 'b2', name: 'Design', organizationId: 'org-a', projectId: 'project', revision: 0, archivedAt: null, _count: { tasks: 3 } }];
  let defaultCounts = 0;
  const prisma = { project: { findFirst: async ({ where }) => where.organizationId === 'org-a' && where.id === 'project' ? project : null }, task: { count: async ({ where }) => { assert.equal(where.boardId, null); assert.equal(where.project.organizationId, 'org-a'); defaultCounts++; return 4; } },
    projectBoard: {
      findMany: async ({ where, take }) => { assert.equal(where.organizationId, 'org-a'); return boards.filter(board => !where.id || board.id > where.id.gt).slice(0, take); },
      findFirst: async ({ where }) => boards.find(board => board.id === where.id && board.organizationId === where.organizationId && board.projectId === where.projectId),
      create: async ({ data }) => { assert.equal(data.projectId, 'project'); assert.equal(data.organizationId, 'org-a'); return { id: 'new-board', ...data }; },
      updateMany: async ({ where, data }) => { const board = boards.find(board => board.id === where.id && board.revision === where.revision); if (!board) return { count: 0 }; Object.assign(board, data, { revision: board.revision + data.revision.increment }); return { count: 1 }; },
    },
  };
  prisma.$transaction = async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(prisma); };
  return { prisma, boards, project, defaultCounts: () => defaultCounts };
}
test('cursor pagination counts the virtual default slot and retains distinct same-name boards', async () => {
  const { prisma, defaultCounts } = fixture();
  const first = await listProjectBoards(prisma, 'project', { limit: 1 }, actor);
  assert.equal(first.items[0].id, 'DEFAULT'); assert.equal(first.items[0].taskCount, 4); assert.equal(first.nextCursor, 'DEFAULT');
  const second = await listProjectBoards(prisma, 'project', { limit: 1, after: first.nextCursor }, actor);
  assert.equal(second.items[0].id, 'b1'); assert.equal(second.nextCursor, 'b1');
  const third = await listProjectBoards(prisma, 'project', { limit: 1, after: second.nextCursor }, actor);
  assert.equal(third.items[0].id, 'b2'); assert.equal(third.nextCursor, null); assert.equal(defaultCounts(), 1);
});
test('empty creation copies stages without changing project metadata or existing tasks', async () => {
  const { prisma, project } = fixture();
  const created = await createProjectBoard(prisma, 'project', { name: 'Delivery', description: 'Shared workflow' }, actor);
  assert.deepEqual(created.taskStages, project.taskStages); assert.deepEqual(created.taskViews, []);
  assert.equal(project.boardRevision, 3);
  await assert.rejects(createProjectBoard(prisma, 'foreign', { name: 'Delivery' }, actor), { statusCode: 404 });
  await assert.rejects(createProjectBoard(prisma, 'project', { name: 'Delivery' }, { ...actor, role: 'CLIENT' }), { statusCode: 403 });
});
test('archive is revision guarded and reversible without changing board identity', async () => {
  const { prisma } = fixture();
  const archived = await updateProjectBoard(prisma, 'project', 'b1', { revision: 0, archived: true }, actor);
  assert.equal(archived.id, 'b1'); assert.ok(archived.archivedAt);
  await assert.rejects(updateProjectBoard(prisma, 'project', 'b1', { revision: 0, archived: false }, actor), { statusCode: 409 });
  const restored = await updateProjectBoard(prisma, 'project', 'b1', { revision: 1, archived: false }, actor);
  assert.equal(restored.archivedAt, null); assert.equal(restored.id, 'b1');
  await assert.rejects(updateProjectBoard(prisma, 'project', 'DEFAULT', { revision: 0, archived: true }, actor), { statusCode: 400 });
});
