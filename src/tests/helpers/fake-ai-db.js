// In-memory stand-in for the Prisma delegates the BYOK control plane uses
// (#413): organization, aiProviderConnection, aiUsageRecord, auditEvent,
// platformSetting.
// It understands equality, null and { gte } filters, which is all the
// governance module and routes send. Wrap it with createScopedPrisma to get
// the real tenant proxy in front of it.

let nextId = 1;

function matches(row, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return condition.every((branch) => matches(row, branch));
    if (condition === null) return row[key] === null || row[key] === undefined;
    if (condition instanceof Date) return row[key]?.getTime?.() === condition.getTime();
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      if ('gte' in condition) return row[key] !== null && row[key] !== undefined && row[key] >= condition.gte;
      if ('not' in condition) return row[key] !== condition.not;
      return false;
    }
    return row[key] === condition;
  });
}

function pick(row, select) {
  if (!row || !select) return row ? { ...row } : row;
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

function delegate(rows, { defaults = () => ({}) } = {}) {
  const find = (where) => rows.find((row) => matches(row, where)) ?? null;
  return {
    rows,
    findFirst: async ({ where, select } = {}) => pick(find(where), select),
    findUnique: async ({ where, select } = {}) => pick(find(where), select),
    findMany: async ({ where } = {}) => rows.filter((row) => matches(row, where)).map((row) => ({ ...row })),
    create: async ({ data }) => {
      const row = { id: `id-${nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...defaults(), ...data };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }) => {
      const row = find(where);
      if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    updateMany: async ({ where, data }) => {
      const hits = rows.filter((row) => matches(row, where));
      for (const row of hits) Object.assign(row, data, { updatedAt: new Date() });
      return { count: hits.length };
    },
    upsert: async ({ where, create, update }) => {
      const row = find(where);
      if (row) {
        Object.assign(row, update, { updatedAt: new Date() });
        return { ...row };
      }
      const created = { id: `id-${nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...defaults(), ...create };
      rows.push(created);
      return { ...created };
    },
    aggregate: async ({ where, _sum = {}, _count } = {}) => {
      const hits = rows.filter((row) => matches(row, where));
      const sums = {};
      for (const field of Object.keys(_sum)) {
        const values = hits.map((row) => row[field]).filter((value) => value !== null && value !== undefined);
        sums[field] = values.length ? values.reduce((a, b) => a + b, 0) : null;
      }
      return { _sum: sums, ...(_count ? { _count: { _all: hits.length } } : {}) };
    },
  };
}

/**
 * @param {{ organizations?: Array<{ id: string, aiDisabled?: boolean }> }} [seed]
 */
export function createFakeAiDb({ organizations = [{ id: 'org-a' }, { id: 'org-b' }] } = {}) {
  const db = {
    organization: delegate(organizations.map((org) => ({ aiDisabled: false, ...org }))),
    aiProviderConnection: delegate([], {
      defaults: () => ({ providerKind: 'openai_compatible', status: 'active', allowedModels: [] }),
    }),
    aiUsageRecord: delegate([]),
    auditEvent: delegate([]),
    user: delegate([]),
    platformSetting: delegate([]),
  };
  return db;
}

/**
 * A governance instance over the fake database for the process-wide facade
 * (routes, embeddings, aiClient). Returns the restore function.
 * @param {ReturnType<typeof createFakeAiDb>} db
 * @param {Record<string, any>} [deps]
 */
export async function installFakeGovernance(db, deps = {}) {
  const { createAiGovernance, useAiGovernance } = await import('../../ai/governance.js');
  return useAiGovernance(createAiGovernance({ prisma: db, logger: { info() {}, warn() {}, error() {}, debug() {} }, ...deps }));
}
