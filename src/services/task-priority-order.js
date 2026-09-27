// Database-side priority ordering (M8).
//
// Task.priority is a string, so `orderBy: { priority: 'asc' }` sorted
// alphabetically (CRITICAL, HIGH, LOW, NORMAL). For paginated lists the order
// has to be right in the database, so this walks the priorities in semantic
// order, counting each bucket and fetching only the rows of the requested
// page from each one. Unknown priorities come last.

import { TASK_PRIORITIES } from '../shared/task-priority.js';

/**
 * @param {{ findMany: Function, count: Function }} delegate prisma.task (scoped)
 * @param {{ where?: object, include?: object, select?: object, orderBy?: object[], skip?: number, take: number }} query
 *   `orderBy` is the secondary order inside one priority.
 */
export async function findTasksInPriorityOrder(delegate, { where = {}, include, select, orderBy = [], skip = 0, take }) {
  const buckets = [
    ...TASK_PRIORITIES.map((priority) => ({ priority })),
    { priority: { notIn: [...TASK_PRIORITIES] } },
  ];
  const counts = await Promise.all(buckets.map((bucket) => delegate.count({ where: { AND: [where, bucket] } })));
  const rows = [];
  let offset = skip;
  let remaining = take;
  for (let i = 0; i < buckets.length && remaining > 0; i += 1) {
    if (offset >= counts[i]) {
      offset -= counts[i];
      continue;
    }
    const page = await delegate.findMany({
      where: { AND: [where, buckets[i]] },
      ...(include ? { include } : {}),
      ...(select ? { select } : {}),
      orderBy,
      skip: offset,
      take: remaining,
    });
    rows.push(...page);
    remaining -= page.length;
    offset = 0;
  }
  return rows;
}
