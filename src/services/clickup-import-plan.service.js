const STATUS = new Map([
  ['complete', 'COMPLETED'], ['completed', 'COMPLETED'], ['closed', 'COMPLETED'],
  ['in progress', 'IN_PROGRESS'], ['doing', 'IN_PROGRESS'], ['blocked', 'BLOCKED'],
  ['to do', 'PENDING'], ['todo', 'PENDING'], ['open', 'PENDING'],
]);
const PRIORITY = new Map([['urgent', 'CRITICAL'], ['high', 'HIGH'], ['normal', 'NORMAL'], ['low', 'LOW']]);

export function buildClickUpTaskImportPlan(rows) {
  if (!Array.isArray(rows)) throw new Error('ClickUp rows must be an array');
  const ids = new Set();
  const errors = [];
  const tasks = rows.map((row, index) => {
    const sourceId = String(row?.id ?? row?.['Task ID'] ?? '').trim();
    const title = String(row?.name ?? row?.['Task Name'] ?? '').trim();
    if (!sourceId || !title || ids.has(sourceId)) errors.push({ row: index + 2, code: !sourceId ? 'MISSING_ID' : !title ? 'MISSING_TITLE' : 'DUPLICATE_ID' });
    ids.add(sourceId);
    const status = STATUS.get(String(row?.status ?? row?.Status ?? '').trim().toLowerCase()) ?? 'PENDING';
    const priority = PRIORITY.get(String(row?.priority ?? row?.Priority ?? '').trim().toLowerCase()) ?? 'NORMAL';
    return { sourceId, title, description: String(row?.description ?? row?.Description ?? '').trim() || null, status, priority, parentSourceId: String(row?.parent ?? row?.['Parent Task ID'] ?? '').trim() || null };
  });
  for (const task of tasks) if (task.parentSourceId && !ids.has(task.parentSourceId)) errors.push({ sourceId: task.sourceId, code: 'PARENT_UNRESOLVED' });
  return { tasks, errors, complete: errors.length === 0 };
}
