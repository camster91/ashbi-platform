import test from 'node:test';
import assert from 'node:assert/strict';
import { moveTaskBoard } from '../../services/project-boards.service.js';
import { readTaskViews, saveTaskViews } from '../../services/task-views.service.js';
import { saveTaskStages } from '../../services/task-stages.service.js';

const actor = { id: 'staff', role: 'TEAM', organizationId: 'org' };
function fixture() {
  const task = { id: 'task', projectId: 'project', boardId: null, boardMembershipRevision: 0, assigneeId: 'owner', status: 'IN_PROGRESS', stageKey: 'old', fieldValues: { amount: 0 } };
  const project = { id: 'project', name: 'Canonical project', boardRevision: 0, taskViewsRevision: 0, taskStages: [], taskViews: [], taskFields: [] };
  const board = { id: 'board', projectId: 'project', organizationId: 'org', name: 'Delivery', taskStages: [{ key: 'review', name: 'Review', status: 'IN_PROGRESS' }], taskViews: [], stageRevision: 0, viewsRevision: 0, archivedAt: null };
  const counts = [];
  const prisma = { project: { findFirst: async () => project, update: async () => { throw new Error('Default configuration must be retained'); } },
    projectBoard: { findFirst: async ({ where }) => where.id === board.id && where.projectId === board.projectId && board.archivedAt === null ? board : null, update: async ({ data }) => { Object.assign(board, data); if (data.stageRevision) board.stageRevision = 1; if (data.viewsRevision) board.viewsRevision = 1; return board; } },
    task: { findFirst: async () => task, count: async ({ where }) => { counts.push(where); return 0; }, updateMany: async ({ where, data }) => { if (where.boardMembershipRevision !== task.boardMembershipRevision) return { count: 0 }; Object.assign(task, data, { boardMembershipRevision: task.boardMembershipRevision + 1 }); return { count: 1 }; } },
  };
  prisma.$transaction = async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(prisma); };
  return { prisma, task, board, project, counts };
}
test('board moves preserve canonical project, owner, values and lifecycle while clearing the old stage', async () => {
  const { prisma, task, board } = fixture();
  await moveTaskBoard(prisma, 'task', { projectId: 'project', boardId: 'board', revision: 0 }, actor);
  assert.equal(task.boardId, 'board'); assert.equal(task.stageKey, null); assert.equal(task.status, 'IN_PROGRESS');
  assert.equal(task.assigneeId, 'owner'); assert.equal(task.projectId, 'project'); assert.deepEqual(task.fieldValues, { amount: 0 });
  await assert.rejects(moveTaskBoard(prisma, 'task', { projectId: 'project', boardId: null, revision: 0 }, actor), { statusCode: 409 });
  board.archivedAt = new Date();
  await assert.rejects(moveTaskBoard(prisma, 'task', { projectId: 'project', boardId: 'board', revision: 1 }, actor), { statusCode: 404 });
});
test('stages and views are saved to the selected board while field definitions remain shared', async () => {
  const { prisma, project, board, counts } = fixture();
  const read = await readTaskViews(prisma, 'project', 'board');
  assert.equal(read.boardName, 'Delivery'); assert.deepEqual(read.fields, project.taskFields);
  const stages = [{ key: 'ready', name: 'Ready', status: 'PENDING' }];
  await saveTaskStages(prisma, 'project', { revision: 0, stages }, 'board');
  assert.equal(counts[0].boardId, 'board'); assert.deepEqual(project.taskStages, []); assert.deepEqual(board.taskStages, stages);
  await saveTaskViews(prisma, 'project', { revision: 0, views: [{ key: 'table', name: 'Delivery table', layout: 'TABLE', sort: 'TITLE', filters: {} }] }, 'board');
  assert.equal(board.taskViews[0].name, 'Delivery table'); assert.deepEqual(project.taskViews, []);
});
