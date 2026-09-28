// In-memory stand-in for the domain_events outbox, for route/service unit
// tests that fake Prisma. It implements exactly the calls recordDomainEvent
// and the replay path make: the advisory lock ($executeRaw), findFirst by
// idempotency key, aggregate(_max.sequence), create, findMany and updateMany.
// Real concurrency, SKIP LOCKED and constraints are proven against PostgreSQL
// in src/tests/integration/domain-events.database.test.js.

function matches(row, where = {}) {
  return Object.entries(where).every(([field, condition]) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if (Array.isArray(condition.in)) return condition.in.includes(row[field]);
      return false;
    }
    return row[field] === condition;
  });
}

export function outboxStore() {
  const events = [];
  const locks = [];
  let nextId = 1;
  const domainEvent = {
    findFirst: async ({ where }) => events.find((row) => matches(row, where)) ?? null,
    update: async ({ where, data }) => {
      const row = events.find((candidate) => matches(candidate, where));
      if (!row) throw Object.assign(new Error('Record to update not found'), { code: 'P2025' });
      Object.assign(row, data);
      return row;
    },
    findMany: async ({ where } = {}) => events.filter((row) => matches(row, where)),
    aggregate: async ({ where }) => {
      const sequences = events.filter((row) => matches(row, where)).map((row) => row.sequence);
      return { _max: { sequence: sequences.length ? Math.max(...sequences) : null } };
    },
    create: async ({ data }) => {
      const duplicate = events.find((row) => row.organizationId === data.organizationId && row.idempotencyKey === data.idempotencyKey);
      if (duplicate) {
        const error = new Error('Unique constraint failed on the fields: (`organizationId`,`idempotencyKey`)');
        Object.assign(error, { code: 'P2002' });
        throw error;
      }
      const row = {
        id: `evt-${nextId++}`, status: 'pending', attempts: 0, replayCount: 0, lastError: null, publishedAt: null, ...data,
      };
      events.push(row);
      return row;
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const row of events) {
        if (!matches(row, where)) continue;
        for (const [field, value] of Object.entries(data)) {
          row[field] = value && typeof value === 'object' && 'increment' in value ? row[field] + value.increment : value;
        }
        count += 1;
      }
      return { count };
    },
  };
  return {
    events,
    locks,
    domainEvent,
    $executeRaw: async (strings, ...values) => {
      locks.push(values[0]);
      return 1;
    },
  };
}
