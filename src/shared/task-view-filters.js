export function taskViewWhere({ search, stageKey, projectId, status, priority } = {}) {
  return {
    ...(projectId ? { projectId } : {}), ...(status ? { status } : {}), ...(priority ? { priority } : {}),
    ...(stageKey ? { stageKey } : {}),
    ...(search?.trim() ? { OR: ['title', 'description'].map(field => ({ [field]: { contains: search.trim(), mode: 'insensitive' } })) } : {}),
  };
}
