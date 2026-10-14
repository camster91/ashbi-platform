import { withStageTransaction, resolveTaskStage } from './task-stages.service.js';
import { activeTaskBoard } from './task-board-scope.js';

export const DEFAULT_BOARD_ID = 'DEFAULT';
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
function staff(actor) {
  if (!actor?.organizationId || !['ADMIN', 'TEAM'].includes(actor.role)) fail(403, 'Team access required');
}
async function projectFor(prisma, projectId, actor) {
  staff(actor);
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: actor.organizationId, deletedAt: null }, select: { id: true, name: true, taskStages: true, taskViews: true, boardRevision: true, taskViewsRevision: true } });
  if (!project) fail(404, 'Project not found');
  return project;
}

export async function listProjectBoards(prisma, projectId, { after, limit = 25, includeArchived = false } = {}, actor) {
  const project = await projectFor(prisma, projectId, actor);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'Choose a page size between 1 and 100.');
  if (typeof includeArchived !== 'boolean' || (after !== undefined && (typeof after !== 'string' || !after || after.length > 80))) fail(400, 'Invalid board page options.');
  const capacity = limit - (after ? 0 : 1);
  const rows = await prisma.projectBoard.findMany({ where: { organizationId: actor.organizationId, projectId, ...(includeArchived ? {} : { archivedAt: null }), ...(after && after !== DEFAULT_BOARD_ID ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: capacity + 1,
    select: { id: true, name: true, description: true, taskStages: true, taskViews: true, stageRevision: true, viewsRevision: true, revision: true, archivedAt: true, _count: { select: { tasks: { where: { deletedAt: null } } } } } });
  const stored = rows.slice(0, capacity).map(row => ({ ...row, taskCount: row._count.tasks, isDefault: false }));
  const items = after ? stored : [{ id: DEFAULT_BOARD_ID, name: 'Project board', description: '', isDefault: true, taskStages: project.taskStages ?? [], taskViews: project.taskViews ?? [], stageRevision: project.boardRevision, viewsRevision: project.taskViewsRevision, revision: 0, archivedAt: null,
    taskCount: await prisma.task.count({ where: { projectId, boardId: null, deletedAt: null, project: { organizationId: actor.organizationId } } }) }, ...stored];
  return { items, nextCursor: rows.length > capacity ? stored.at(-1)?.id ?? DEFAULT_BOARD_ID : null };
}

export async function createProjectBoard(prisma, projectId, { name, description = '' }, actor) {
  staff(actor);
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || typeof description !== 'string' || description.length > 2000) fail(400, 'Enter a board name and a short description.');
  return withStageTransaction(prisma, async tx => {
    const project = await projectFor(tx, projectId, actor);
    const taskStages = Array.isArray(project.taskStages) && project.taskStages.length ? project.taskStages : [
      { key: 'pending', name: 'To do', status: 'PENDING' }, { key: 'in_progress', name: 'In progress', status: 'IN_PROGRESS' }, { key: 'blocked', name: 'Blocked', status: 'BLOCKED' }, { key: 'completed', name: 'Done', status: 'COMPLETED' },
    ];
    return tx.projectBoard.create({ data: { organizationId: actor.organizationId, projectId, name: name.trim(), description, taskStages, taskViews: [] } });
  });
}

export async function updateProjectBoard(prisma, projectId, boardId, { revision, name, description, archived }, actor) {
  staff(actor);
  if (boardId === DEFAULT_BOARD_ID) fail(400, 'The project board retains its original project settings.');
  if (!Number.isInteger(revision) || revision < 0 || (archived !== undefined && typeof archived !== 'boolean') || [name, description, archived].every(value => value === undefined)) fail(400, 'Provide a revision and board changes.');
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 80)) fail(400, 'Enter a board name.');
  if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) fail(400, 'Enter a short board description.');
  return withStageTransaction(prisma, async tx => {
    await projectFor(tx, projectId, actor);
    const current = await tx.projectBoard.findFirst({ where: { id: boardId, projectId, organizationId: actor.organizationId } });
    if (!current) fail(404, 'Board not found');
    if (current.revision !== revision) fail(409, 'Board changed. Reload before saving.');
    const data = { ...(name !== undefined ? { name: name.trim() } : {}), ...(description !== undefined ? { description } : {}), ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}), revision: { increment: 1 } };
    const changed = await tx.projectBoard.updateMany({ where: { id: boardId, projectId, organizationId: actor.organizationId, revision }, data });
    if (changed.count !== 1) fail(409, 'Board changed. Reload before saving.');
    return tx.projectBoard.findFirst({ where: { id: boardId, projectId, organizationId: actor.organizationId } });
  });
}

export async function moveTaskBoard(prisma, taskId, { projectId, revision, boardId, stageKey }, actor) {
  return withStageTransaction(prisma, tx => moveTaskBoardInTransaction(tx, taskId, { projectId, revision, boardId, stageKey }, actor));
}

export async function moveTaskBoardInTransaction(tx, taskId, { projectId, revision, boardId, stageKey }, actor) {
  staff(actor);
  if (!Number.isInteger(revision) || revision < 0 || (boardId !== null && (typeof boardId !== 'string' || !boardId))) fail(400, 'Provide a board and membership revision.');
    await projectFor(tx, projectId, actor);
    const current = await tx.task.findFirst({ where: { id: taskId, projectId, deletedAt: null, project: { organizationId: actor.organizationId } } });
    if (!current) fail(404, 'Task not found');
    if (current.boardMembershipRevision !== revision) fail(409, 'Board membership changed. Reload before moving.');
    await activeTaskBoard(tx, projectId, boardId, actor.organizationId);
    const stage = stageKey ? await resolveTaskStage(tx, projectId, stageKey, boardId) : null;
    const data = { boardId, stageKey: stage?.key ?? null, boardMembershipRevision: { increment: 1 }, ...(stage ? { status: stage.status, completedAt: stage.status === 'COMPLETED' ? new Date() : null } : {}) };
    const moved = await tx.task.updateMany({ where: { id: taskId, projectId, boardMembershipRevision: revision }, data });
    if (moved.count !== 1) fail(409, 'Board membership changed. Reload before moving.');
    return tx.task.findFirst({ where: { id: taskId, projectId } });
}
