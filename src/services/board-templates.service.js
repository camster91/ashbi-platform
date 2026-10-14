import { projectTaskFieldsSchema, projectTaskStagesSchema, projectTaskViewsSchema } from '../validators/schemas.js';
import { withStageTransaction } from './task-stages.service.js';
import { validateTaskFieldFilterDefinitions } from './task-field-filters.service.js';
import { validateTaskViewGrouping } from '../shared/task-view-groups.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
export function validateBoardConfig(config) {
  if (config?.version !== 1 || !(Array.isArray(config.stages) && config.stages.length === 0 || projectTaskStagesSchema.safeParse({ revision: 0, stages: config.stages }).success)
    || !projectTaskFieldsSchema.safeParse({ revision: 0, fields: config.fields }).success
    || !projectTaskViewsSchema.safeParse({ revision: 0, views: config.views }).success) fail(400, 'Template workflow settings are invalid. Save a new template from the source project.');
  if (config.views.some(view => view.filters.stageKey && !config.stages.some(stage => stage.key === view.filters.stageKey)
    || (view.columns ?? []).some(key => !config.fields.some(field => field.key === key)))) fail(400, 'Clear unavailable stages or columns in the source views before saving a template.');
  for (const view of config.views) {
    validateTaskFieldFilterDefinitions(config.fields, view.filters.fieldFilters);
    validateTaskViewGrouping(config.fields, view.grouping);
  }
  return config;
}
export async function saveBoardTemplate(prisma, { projectId, name, description }) {
  return withStageTransaction(prisma, async tx => {
    const project = await tx.project.findFirst({ where: { id: projectId }, select: { id: true, taskStages: true, taskViews: true, taskFields: true } });
    if (!project) fail(404, 'Project not found');
    const config = validateBoardConfig({ version: 1, stages: project.taskStages ?? [], views: project.taskViews ?? [], fields: project.taskFields ?? [] });
    return tx.projectTemplate.create({ data: { name, description: description ?? null, kind: 'BOARD', boardConfig: config } });
  }, 'Project settings changed while saving the template. Try again.');
}
export async function listBoardTemplates(prisma, includeArchived = false, after) {
  const rows = await prisma.projectTemplate.findMany({ where: { kind: { in: includeArchived ? ['BOARD', 'BOARD_ARCHIVED'] : ['BOARD'] }, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: 26 });
  const items = rows.slice(0, 25);
  return { items, nextCursor: rows.length > 25 ? items.at(-1).id : null };
}
export async function archiveBoardTemplate(prisma, id, archived) {
  const template = await prisma.projectTemplate.findFirst({ where: { id, kind: { in: ['BOARD', 'BOARD_ARCHIVED'] } }, select: { id: true } });
  if (!template) fail(404, 'Board template not found');
  return prisma.projectTemplate.update({ where: { id }, data: { kind: archived ? 'BOARD_ARCHIVED' : 'BOARD' } });
}
export async function projectFromBoardTemplate(prisma, { templateId, clientId, name, portfolio }) {
  return withStageTransaction(prisma, async tx => {
    const template = await tx.projectTemplate.findFirst({ where: { id: templateId, kind: 'BOARD' } });
    if (!template) fail(404, 'Board template not found');
    const client = await tx.client.findFirst({ where: { id: clientId }, select: { id: true } });
    if (!client) fail(404, 'Client not found');
    const config = validateBoardConfig(template.boardConfig);
    return tx.project.create({ data: { name, clientId, portfolio: portfolio ?? null,
      taskStages: config.stages, taskViews: config.views, taskFields: config.fields } });
  }, 'Template or client changed while creating the project. Try again.');
}
