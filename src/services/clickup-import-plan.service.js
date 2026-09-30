const STATUS = new Map([
  ['complete', 'COMPLETED'], ['completed', 'COMPLETED'], ['closed', 'COMPLETED'],
  ['in progress', 'IN_PROGRESS'], ['doing', 'IN_PROGRESS'], ['blocked', 'BLOCKED'],
  ['to do', 'PENDING'], ['todo', 'PENDING'], ['open', 'PENDING'],
]);
const PRIORITY = new Map([['urgent', 'CRITICAL'], ['high', 'HIGH'], ['normal', 'NORMAL'], ['low', 'LOW']]);
const DEFAULT_STATUS = 'PENDING';
const DEFAULT_PRIORITY = 'NORMAL';

// Parent links that can never form a tree: a task that is its own parent, and
// every cycle of two or more tasks (each cycle reported once, starting from
// the task that comes first in the file).
function parentLinkErrors(tasks) {
  const parentOf = new Map();
  for (const task of tasks) if (task.sourceId && !parentOf.has(task.sourceId)) parentOf.set(task.sourceId, task.parentSourceId);
  const errors = [];
  const done = new Set();
  for (const [sourceId, parentSourceId] of parentOf) {
    if (parentSourceId === sourceId) errors.push({ sourceId, code: 'PARENT_SELF' });
  }
  for (const start of parentOf.keys()) {
    const path = [];
    const onPath = new Set();
    let current = start;
    while (current && parentOf.has(current) && !done.has(current) && !onPath.has(current)) {
      path.push(current);
      onPath.add(current);
      current = parentOf.get(current);
    }
    if (current && onPath.has(current)) {
      const cycle = path.slice(path.indexOf(current));
      if (cycle.length > 1) errors.push({ sourceIds: cycle, code: 'PARENT_CYCLE' });
    }
    for (const sourceId of path) done.add(sourceId);
  }
  return errors;
}

export function buildClickUpTaskImportPlan(rows) {
  if (!Array.isArray(rows)) throw new Error('ClickUp rows must be an array');
  const ids = new Set();
  const errors = [];
  const warnings = [];
  const tasks = rows.map((row, index) => {
    const sourceId = String(row?.id ?? row?.['Task ID'] ?? '').trim();
    const title = String(row?.name ?? row?.['Task Name'] ?? '').trim();
    if (!sourceId || !title || ids.has(sourceId)) errors.push({ row: index + 2, code: !sourceId ? 'MISSING_ID' : !title ? 'MISSING_TITLE' : 'DUPLICATE_ID' });
    ids.add(sourceId);
    const rawStatus = String(row?.status ?? row?.Status ?? '').trim();
    const rawPriority = String(row?.priority ?? row?.Priority ?? '').trim();
    const status = STATUS.get(rawStatus.toLowerCase()) ?? DEFAULT_STATUS;
    const priority = PRIORITY.get(rawPriority.toLowerCase()) ?? DEFAULT_PRIORITY;
    // A blank value takes the default quietly; an unknown one is reported.
    if (rawStatus && !STATUS.has(rawStatus.toLowerCase())) warnings.push({ row: index + 2, sourceId, code: 'STATUS_FALLBACK', value: rawStatus, mappedTo: status });
    if (rawPriority && !PRIORITY.has(rawPriority.toLowerCase())) warnings.push({ row: index + 2, sourceId, code: 'PRIORITY_FALLBACK', value: rawPriority, mappedTo: priority });
    return { sourceId, title, description: String(row?.description ?? row?.Description ?? '').trim() || null, status, priority, parentSourceId: String(row?.parent ?? row?.['Parent Task ID'] ?? '').trim() || null };
  });
  for (const task of tasks) if (task.parentSourceId && !ids.has(task.parentSourceId)) errors.push({ sourceId: task.sourceId, code: 'PARENT_UNRESOLVED' });
  errors.push(...parentLinkErrors(tasks));
  // Warnings do not block: they record a documented fallback for review.
  return { tasks, errors, warnings, complete: errors.length === 0 };
}
