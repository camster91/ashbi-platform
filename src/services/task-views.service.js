import { withStageTransaction } from './task-stages.service.js';
import { validateTaskFieldFilterDefinitions } from './task-field-filters.service.js';
import { validateTaskViewGrouping } from '../shared/task-view-groups.js';
import { activeTaskBoard } from './task-board-scope.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
export async function readTaskViews(prisma, projectId, boardId) {
  const project = await prisma.project.findFirst({ where: { id: projectId },
    select: { id: true, name: true, taskViews: true, taskViewsRevision: true, taskStages: true, taskFields: true } });
  if (!project) fail(404, 'Project not found');
  const board = await activeTaskBoard(prisma, projectId, boardId);
  if (board) return { projectId: project.id, projectName: project.name, boardId: board.id, boardName: board.name, stageRevision: board.stageRevision, views: board.taskViews ?? [], revision: board.viewsRevision, stages: board.taskStages ?? [], fields: project.taskFields ?? [] };
  return { projectId: project.id, projectName: project.name, views: project.taskViews ?? [],
    revision: project.taskViewsRevision, stages: project.taskStages ?? [], fields: project.taskFields ?? [] };
}
export async function saveTaskViews(prisma, projectId, { revision, views }, boardId) {
  return withStageTransaction(prisma, async tx => {
    const current = await readTaskViews(tx, projectId, boardId);
    if (current.revision !== revision) fail(409, 'Saved views changed. Reload before saving.');
    for (const view of views) {
      validateTaskViewGrouping(current.fields, view.grouping);
      validateTaskFieldFilterDefinitions(current.fields, view.filters.fieldFilters);
      if (view.filters.stageKey && !current.stages.some(stage => stage.key === view.filters.stageKey)) fail(400, 'A selected stage is unavailable. Choose another stage.');
      if ((view.columns ?? []).some(key => !current.fields.some(field => field.key === key && !field.archived))) fail(400, 'A selected field is unavailable. Clear it from the table columns.');
    }
    if (current.boardId) await tx.projectBoard.update({ where: { id: current.boardId }, data: { taskViews: views, viewsRevision: { increment: 1 } } });
    else await tx.project.update({ where: { id: projectId }, data: { taskViews: views, taskViewsRevision: { increment: 1 } } });
    return { ...current, views, revision: revision + 1 };
  }, 'Saved views changed while saving. Reload and try again.');
}
