// Applies Prisma-style update data to an in-memory invoice row (unit-test
// fakes): `{ increment: n }` adds, everything else is assigned.
export function applyInvoiceData(row, data = {}) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value && typeof value === 'object' && 'increment' in value
      ? (Number(row[key]) || 0) + value.increment
      : value;
  }
  return row;
}

// Whether a fake invoice matches a `status` filter: a string, `{ in }` or `{ notIn }`.
export function statusMatches(status, filter) {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return status === filter;
  if (filter.in) return filter.in.includes(status);
  if (filter.notIn) return !filter.notIn.includes(status);
  return true;
}
