// Task priorities — the single list shared by the API validators, the
// task-ordering code and the web app (imported there as `@shared/task-priority`).
// Plain JavaScript with no imports so both runtimes can load it.

/** Most to least urgent. The order is the sort order. */
export const TASK_PRIORITIES = /** @type {readonly ['CRITICAL', 'HIGH', 'NORMAL', 'LOW']} */ (Object.freeze(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']));

export const DEFAULT_TASK_PRIORITY = 'NORMAL';

export const TASK_PRIORITY_LABELS = Object.freeze({
  CRITICAL: 'Critical',
  HIGH: 'High',
  NORMAL: 'Normal',
  LOW: 'Low',
});

/**
 * Sort rank of a priority: 0 for CRITICAL … 3 for LOW; unknown values last.
 * @param {string | null | undefined} priority
 */
export function taskPriorityRank(priority) {
  const index = TASK_PRIORITIES.indexOf(/** @type {any} */ (priority));
  return index === -1 ? TASK_PRIORITIES.length : index;
}

/**
 * Comparator: most urgent first.
 * @param {{ priority?: string | null }} a
 * @param {{ priority?: string | null }} b
 */
export function compareTaskPriority(a, b) {
  return taskPriorityRank(a?.priority) - taskPriorityRank(b?.priority);
}

/**
 * Stable sort by priority, keeping the existing order within a priority.
 * @template {{ priority?: string | null }} T
 * @param {T[]} tasks
 * @returns {T[]}
 */
export function sortByTaskPriority(tasks) {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => compareTaskPriority(a.task, b.task) || a.index - b.index)
    .map(({ task }) => task);
}
