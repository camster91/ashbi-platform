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
  // A bucket may be read in several OFFSET queries, so the order must be
  // total: end with the unique id, or ties (say, many null due dates) could
  // come back in a different order and be repeated or skipped.
  const order = [...(Array.isArray(orderBy) ? orderBy : [orderBy])];
  if (!order.some((clause) => clause && Object.hasOwn(clause, 'id'))) order.push({ id: 'asc' });
  const rows = [];
  let offset = skip;
  let remaining = take;
  for (let i = 0; i < buckets.length && remaining > 0; i += 1) {
    if (offset >= counts[i]) {
      offset -= counts[i];
      continue;
    }
    // A delegate may cap one findMany (soft-deletable models return at most
    // 100 rows), so keep reading this bucket until its counted rows run out.
    while (remaining > 0 && offset < counts[i]) {
      const page = await delegate.findMany({
        where: { AND: [where, buckets[i]] },
        ...(include ? { include } : {}),
        ...(select ? { select } : {}),
        orderBy: order,
        skip: offset,
        take: remaining,
      });
      if (page.length === 0) break;
      rows.push(...page);
      remaining -= page.length;
      offset += page.length;
    }
    offset = 0;
  }
  return rows;
}
