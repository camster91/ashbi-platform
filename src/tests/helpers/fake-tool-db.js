// In-memory, multi-organization stand-in for the Prisma delegates the AI tool
// registry, executor and governance use (#413 slice 2). Deliberately NOT
// tenant-scoped: the adversarial evaluation (src/tests/ai-eval) runs tools
// against this raw client to show that scope resolvers refuse another
// organization's records on their own, even without the tenant proxy.
//
// It understands equality, null, Date, { not }, { gt }, { gte }, { lt }, { in }, AND,
// relation filters and nested selects for the relations listed in RELATIONS,
// the ai_bridge_actions unique key (userId, idempotencyKey), transactions
// with rollback, and the receipt-immutability trigger.

let nextId = 1;

const RELATIONS = {
  task: { project: ['project', 'projectId'] },
  project: { client: ['client', 'clientId'] },
  slackChannelMapping: { installation: ['slackInstallation', 'installationId'], project: ['project', 'projectId'] },
  aiBridgeAction: { user: ['user', 'userId'] },
  chatMessage: { project: ['project', 'projectId'] },
};

const TERMINAL = new Set(['EXECUTED', 'FAILED', 'REJECTED', 'EXPIRED']);

export function createFakeToolDb() {
  const tables = {
    organization: [], user: [], client: [], project: [], task: [], calendarEvent: [], chatMessage: [],
    slackInstallation: [], slackChannelMapping: [], aiBridgeAction: [], auditEvent: [],
    aiProviderConnection: [], aiUsageRecord: [], platformSetting: [], credential: [],
  };

  function related(model, row, key) {
    const relation = RELATIONS[model]?.[key];
    if (!relation) return undefined;
    const [target, field] = relation;
    return { target, row: tables[target].find((candidate) => candidate.id === row[field]) ?? null };
  }

  function matches(model, row, where = {}) {
    return Object.entries(where).every(([key, condition]) => {
      if (key === 'AND') return condition.every((branch) => matches(model, row, branch));
      const relation = related(model, row, key);
      if (relation && condition && typeof condition === 'object' && !(condition instanceof Date)) {
        return relation.row ? matches(relation.target, relation.row, condition) : false;
      }
      const value = row[key];
      if (condition === null) return value === null || value === undefined;
      if (condition instanceof Date) return value?.getTime?.() === condition.getTime();
      if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
        if ('in' in condition) return condition.in.includes(value);
        if ('not' in condition) return value !== condition.not;
        if ('gte' in condition) return value !== null && value !== undefined && value >= condition.gte;
        if ('gt' in condition) return value !== null && value !== undefined && value > condition.gt;
        if ('lt' in condition) return value !== null && value !== undefined && value < condition.lt;
        return false;
      }
      return value === condition;
    });
  }

  function shape(model, row, { select, include } = {}) {
    if (!row) return null;
    if (!select && !include) return structuredClone(row);
    const out = select ? {} : structuredClone(row);
    for (const [key, spec] of Object.entries(select ?? include)) {
      if (!spec) continue;
      const relation = related(model, row, key);
      if (relation) out[key] = spec === true ? structuredClone(relation.row) : shape(relation.target, relation.row, spec);
      else out[key] = structuredClone(row[key]);
    }
    return out;
  }

  function delegate(model) {
    const rows = () => tables[model];
    const find = (where) => rows().find((row) => matches(model, row, where)) ?? null;
    const guardReceipt = (row) => {
      if (model === 'aiBridgeAction' && TERMINAL.has(row.status)) {
        throw Object.assign(new Error(`AI action receipts are immutable once ${row.status}`), { code: 'P2010' });
      }
    };
    return {
      get rows() { return rows(); },
      findFirst: async (args = {}) => shape(model, find(args.where), args),
      findUnique: async (args = {}) => shape(model, find(args.where), args),
      findMany: async (args = {}) => {
        let hits = rows().filter((row) => matches(model, row, args.where));
        if (args.orderBy) {
          const [[field, direction]] = Object.entries(args.orderBy);
          hits = [...hits].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === 'desc' ? -1 : 1));
        }
        if (args.take) hits = hits.slice(0, args.take);
        return hits.map((row) => shape(model, row, args));
      },
      count: async ({ where } = {}) => rows().filter((row) => matches(model, row, where)).length,
      create: async ({ data }) => {
        if (model === 'aiBridgeAction' && rows().some((row) => row.userId === data.userId && row.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row = { id: `${model}-${nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...structuredClone(data) };
        rows().push(row);
        return structuredClone(row);
      },
      update: async ({ where, data }) => {
        const row = find(where);
        if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
        guardReceipt(row);
        Object.assign(row, structuredClone(data), { updatedAt: new Date() });
        return structuredClone(row);
      },
      updateMany: async ({ where, data }) => {
        const hits = rows().filter((row) => matches(model, row, where));
        for (const row of hits) guardReceipt(row);
        for (const row of hits) Object.assign(row, structuredClone(data), { updatedAt: new Date() });
        return { count: hits.length };
      },
      aggregate: async ({ where, _sum = {}, _count } = {}) => {
        const hits = rows().filter((row) => matches(model, row, where));
        const sums = {};
        for (const field of Object.keys(_sum)) {
          const values = hits.map((row) => row[field]).filter((value) => value !== null && value !== undefined);
          sums[field] = values.length ? values.reduce((a, b) => a + b, 0) : null;
        }
        return { _sum: sums, ...(_count ? { _count: { _all: hits.length } } : {}) };
      },
    };
  }

  const db = Object.fromEntries(Object.keys(tables).map((model) => [model, delegate(model)]));
  db.$transaction = async (work) => {
    const snapshot = structuredClone(tables);
    try {
      return await work(db);
    } catch (error) {
      for (const key of Object.keys(tables)) tables[key].splice(0, tables[key].length, ...snapshot[key]);
      throw error;
    }
  };
  db.tables = tables;
  return db;
}

/**
 * Two organizations, each with an admin, a team member, a client, a project
 * with an open task and a Slack-mapped channel, plus secrets (a BYOK key
 * ciphertext, a Slack bot token ciphertext, a vault credential) that no tool
 * may ever return.
 * @param {ReturnType<typeof createFakeToolDb>} db
 * @param {{ botTokenCiphertext?: string, credentialCiphertext?: string }} [secrets]
 */
export function seedTwoOrganizations(db, { botTokenCiphertext = 'v1:k1:bot-token-ciphertext-org-a', credentialCiphertext = 'v1:k1:vault-ciphertext-org-a' } = {}) {
  const t = db.tables;
  for (const org of ['org-a', 'org-b']) {
    const suffix = org.slice(-1);
    t.organization.push({ id: org, aiDisabled: false });
    t.user.push(
      { id: `admin-${suffix}`, organizationId: org, role: 'ADMIN', name: `Admin ${suffix.toUpperCase()}` },
      { id: `team-${suffix}`, organizationId: org, role: 'TEAM', name: `Team ${suffix.toUpperCase()}` },
      { id: `team2-${suffix}`, organizationId: org, role: 'TEAM', name: `Second ${suffix.toUpperCase()}` },
    );
    t.client.push({ id: `client-${suffix}`, organizationId: org, name: `Client ${suffix.toUpperCase()}` });
    t.project.push({
      id: `project-${suffix}`, organizationId: org, clientId: `client-${suffix}`, name: `Website ${suffix.toUpperCase()}`,
      status: 'DESIGN_DEV', health: 'ON_TRACK', healthScore: 90, aiSummary: `Summary ${suffix}`, updatedAt: new Date(),
    });
    t.task.push({ id: `task-${suffix}`, projectId: `project-${suffix}`, title: `Task ${suffix}`, status: 'PENDING', priority: 'NORMAL', assigneeId: `team-${suffix}`, updatedAt: new Date() });
    t.slackInstallation.push({ id: `install-${suffix}`, organizationId: org, status: 'ACTIVE', botTokenEncrypted: `${botTokenCiphertext}-${suffix}` });
    t.slackChannelMapping.push({ id: `mapping-${suffix}`, organizationId: org, installationId: `install-${suffix}`, projectId: `project-${suffix}`, channelId: `C${suffix.toUpperCase()}1`, channelName: `web-${suffix}`, outboundEnabled: true });
    t.credential.push({ id: `cred-${suffix}`, organizationId: org, label: 'Hosting', encryptedPassword: `${credentialCiphertext}-${suffix}` });
  }
  return db;
}

/** A logger that keeps every line as text, for secret scans. */
export function captureLogger() {
  const lines = [];
  const log = (level) => (obj, msg) => lines.push(JSON.stringify({ level, obj, msg }));
  return { lines, logger: { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') } };
}
