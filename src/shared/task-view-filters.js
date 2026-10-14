import { taskFieldFiltersWhere } from './task-field-filters.js';
export function taskViewWhere({ search, stageKey, projectId, status, priority, fieldFilters } = {}) {
  return {
    ...(projectId ? { projectId } : {}), ...(status ? { status } : {}), ...(priority ? { priority } : {}),
    ...(stageKey ? { stageKey } : {}),
    ...(fieldFilters?.length ? { AND: taskFieldFiltersWhere(fieldFilters) } : {}),
    ...(search?.trim() ? { OR: ['title', 'description'].map(field => ({ [field]: { contains: search.trim(), mode: 'insensitive' } })) } : {}),
  };
}
