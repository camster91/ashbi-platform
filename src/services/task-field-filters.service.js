import { validateFieldValue } from './task-fields.service.js';
import { taskFieldFilterOperators } from '../shared/task-field-filters.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
export function validateTaskFieldFilterDefinitions(fields, filters = []) {
  for (const filter of filters) {
    const field = fields.find(item => item.key === filter.key && !item.archived);
    if (!field) fail(400, 'A filtered field is unavailable. Remove it from the view filters.');
    if (!taskFieldFilterOperators(field.type).includes(filter.operator)) fail(400, `Unsupported filter for ${field.name}.`);
    validateFieldValue(filter.operator === 'HAS' ? { ...field, type: 'SELECT' } : field, filter.value);
  }
}
export async function validateTaskFieldFilters(prisma, projectId, filters = [], organizationId) {
  if (!filters.length) return;
  if (!projectId) fail(400, 'Select a project before filtering custom fields.');
  const project = await prisma.project.findFirst({ where: { id: projectId, ...(organizationId ? { organizationId } : {}) }, select: { taskFields: true } });
  if (!project) fail(404, 'Project not found');
  validateTaskFieldFilterDefinitions(project.taskFields ?? [], filters);
}
