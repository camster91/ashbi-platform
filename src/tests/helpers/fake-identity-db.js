// In-memory, multi-organization stand-in for the Prisma delegates used by
// support impersonation and break-glass recovery (#416). Not tenant-scoped
// itself: tests wrap it with createScopedPrisma exactly as the application
// does for tenant routes, and use it raw where the application uses the raw
// client (the /api/auth routes, the operator CLI).
//
// Understands equality, null, Date, { in, notIn, not, gt, gte, lt, lte },
// { equals, mode: 'insensitive' }, AND, OR, to-one relation filters
// (contact.client, notification.user), select (flat), orderBy, take,
// { increment } updates, unique tokenHash, and $transaction(fn).

let nextId = 1;

const RELATIONS = {
  contact: { client: ['client', 'clientId'] },
  notification: { user: ['user', 'userId'] },
  apiKey: { user: ['user', 'userId'] },
};

const UNIQUE = { breakGlassGrant: ['tokenHash'], user: ['email'] };

// `{ equals, mode: 'insensitive' }` is `ILIKE` on PostgreSQL: `%` and `_` are
// wildcards unless escaped with a backslash (src/utils/insensitive-equals.js).
function ilike(actual, pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const character = pattern[i];
    if (character === '\\' && i + 1 < pattern.length) {
      i += 1;
      source += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (character === '%') source += '[\\s\\S]*';
    else if (character === '_') source += '[\\s\\S]';
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i').test(actual);
}

function value(v) {
  return v instanceof Date ? v.getTime() : v;
}

function compare(a, b) {
  const x = value(a);
  const y = value(b);
  if (x === y) return 0;
  if (x === null || x === undefined) return -1;
  if (y === null || y === undefined) return 1;
  return x > y ? 1 : -1;
}

export function createFakeIdentityDb() {
  const tables = {
    organization: [], user: [], client: [], contact: [], impersonationSession: [],
    breakGlassGrant: [], notification: [], auditEvent: [], apiKey: [], pushSubscription: [],
  };

  function matchCondition(row, key, condition, model) {
    const relation = RELATIONS[model]?.[key];
    if (relation && condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const [target, field] = relation;
      const parent = tables[target].find((candidate) => candidate.id === row[field]);
      return parent ? matches(target, parent, condition) : false;
    }
    const actual = row[key];
    if (condition === null) return actual === null || actual === undefined;
    if (condition instanceof Date) return value(actual) === condition.getTime();
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      return Object.entries(condition).every(([op, operand]) => {
        switch (op) {
          case 'in': return operand.includes(actual);
          case 'notIn': return !operand.includes(actual);
          case 'not': return operand === null ? actual !== null && actual !== undefined : actual !== operand;
          case 'gt': return actual !== null && actual !== undefined && compare(actual, operand) > 0;
          case 'gte': return actual !== null && actual !== undefined && compare(actual, operand) >= 0;
          case 'lt': return actual !== null && actual !== undefined && compare(actual, operand) < 0;
          case 'lte': return actual !== null && actual !== undefined && compare(actual, operand) <= 0;
          case 'equals':
            return condition.mode === 'insensitive'
              ? ilike(String(actual ?? ''), String(operand ?? ''))
              : actual === operand;
          case 'mode': return true;
          case 'has': return (actual || []).includes(operand);
          default: throw new Error(`fake-identity-db: unsupported operator ${op}`);
        }
      });
    }
    return actual === condition;
  }

  function matches(model, row, where = {}) {
    return Object.entries(where || {}).every(([key, condition]) => {
      if (condition === undefined) return true;
      if (key === 'AND') return condition.every((branch) => matches(model, row, branch));
      if (key === 'OR') return condition.some((branch) => matches(model, row, branch));
      return matchCondition(row, key, condition, model);
    });
  }

  function shape(row, select) {
    if (!row) return null;
    if (!select) return structuredClone(row);
    const out = {};
    for (const [key, on] of Object.entries(select)) if (on) out[key] = structuredClone(row[key]);
    return out;
  }

  function order(rows, orderBy) {
    if (!orderBy) return rows;
    const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((entry) => Object.entries(entry));
    return [...rows].sort((a, b) => {
      for (const [field, direction] of keys) {
        const result = compare(a[field], b[field]);
        if (result) return direction === 'desc' ? -result : result;
      }
      return 0;
    });
  }

  function applyData(row, data) {
    for (const [key, next] of Object.entries(data || {})) {
      if (next && typeof next === 'object' && !(next instanceof Date) && !Array.isArray(next) && 'increment' in next) {
        row[key] = (row[key] ?? 0) + next.increment;
      } else {
        row[key] = structuredClone(next);
      }
    }
    if ('updatedAt' in row) row.updatedAt = new Date();
  }

  function checkUnique(model, row) {
    for (const field of UNIQUE[model] ?? []) {
      if (row[field] === null || row[field] === undefined) continue;
      if (tables[model].some((other) => other.id !== row.id && other[field] === row[field])) {
        throw Object.assign(new Error(`Unique constraint failed on ${field}`), { code: 'P2002' });
      }
    }
  }

  function delegate(model) {
    const rows = () => tables[model];
    return {
      findFirst: async (args = {}) => shape(order(rows().filter((row) => matches(model, row, args.where)), args.orderBy)[0] ?? null, args.select),
      findUnique: async (args = {}) => shape(rows().find((row) => matches(model, row, args.where)) ?? null, args.select),
      findMany: async (args = {}) => {
        let hits = order(rows().filter((row) => matches(model, row, args.where)), args.orderBy);
        if (args.take) hits = hits.slice(0, args.take);
        return hits.map((row) => shape(row, args.select));
      },
      count: async (args = {}) => rows().filter((row) => matches(model, row, args.where)).length,
      create: async (args) => {
        const row = { id: `${model}-${nextId++}`, createdAt: new Date(), ...structuredClone(args.data) };
        checkUnique(model, row);
        rows().push(row);
        return shape(row, args.select);
      },
      update: async (args) => {
        const row = rows().find((candidate) => matches(model, candidate, args.where));
        if (!row) throw Object.assign(new Error('No record found'), { code: 'P2025' });
        applyData(row, args.data);
        checkUnique(model, row);
        return shape(row, args.select);
      },
      updateMany: async (args) => {
        const hits = rows().filter((row) => matches(model, row, args.where));
        hits.forEach((row) => applyData(row, args.data));
        return { count: hits.length };
      },
      deleteMany: async (args = {}) => {
        const keep = rows().filter((row) => !matches(model, row, args.where));
        const count = rows().length - keep.length;
        tables[model] = keep;
        return { count };
      },
    };
  }

  const db = {
    tables,
    async $transaction(input) {
      if (typeof input === 'function') return input(db);
      return Promise.all(input);
    },
    async $executeRaw() { return 0; },
  };
  for (const model of Object.keys(tables)) {
    Object.defineProperty(db, model, { enumerable: false, get: () => delegate(model) });
  }
  return db;
}

/** Two organizations with admins, team members and a client user each. */
export function seedIdentityOrganizations(db, { passwordHash = '$2b$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva' } = {}) {
  const now = new Date();
  const user = (id, organizationId, role, extra = {}) => ({
    id, organizationId, role, email: `${id}@${organizationId}.test`, name: extra.name ?? id,
    password: passwordHash, clientId: null, isActive: true, sessionVersion: 0,
    mfaEnabled: false, mfaSecret: null, mfaEnabledAt: null, mfaLastUsedStep: null,
    mfaRecoveryCodes: [], mfaFailedAttempts: 0, mfaLockedUntil: null,
    resetToken: null, resetTokenExpiresAt: null, skills: '[]', capacity: 100,
    createdAt: now, updatedAt: now, ...extra,
  });
  db.tables.organization.push({ id: 'org-a', name: 'Agency A' }, { id: 'org-b', name: 'Agency B' });
  db.tables.client.push(
    { id: 'client-a', organizationId: 'org-a', name: 'Client A', status: 'ACTIVE', relationshipStatus: 'ACTIVE', deletedAt: null, contactPerson: 'Cleo' },
    { id: 'client-b', organizationId: 'org-b', name: 'Client B', status: 'ACTIVE', relationshipStatus: 'ACTIVE', deletedAt: null, contactPerson: 'Cole' },
  );
  db.tables.user.push(
    user('admin-a', 'org-a', 'ADMIN', { name: 'Avery Admin' }),
    user('admin-a2', 'org-a', 'ADMIN', { name: 'Ari Admin' }),
    user('team-a', 'org-a', 'TEAM', { name: 'Terry Team' }),
    user('staff-a', 'org-a', 'STAFF', { name: 'Sam Staff' }),
    user('team-a-inactive', 'org-a', 'TEAM', { name: 'Ina Inactive', isActive: false }),
    user('client-user-a', 'org-a', 'CLIENT', { name: 'Cleo Client', clientId: 'client-a' }),
    user('client-user-a-nocontact', 'org-a', 'CLIENT', { name: 'Nora Nocontact', clientId: 'client-a' }),
    user('bot-a', 'org-a', 'BOT', { name: 'Bot' }),
    user('operator-a', 'org-a', 'TEAM', { name: 'Opal Operator' }),
    user('admin-b', 'org-b', 'ADMIN', { name: 'Blake Admin' }),
    user('team-b', 'org-b', 'TEAM', { name: 'Bailey Team' }),
  );
  db.tables.contact.push({ id: 'contact-a', clientId: 'client-a', name: 'Cleo Client', email: 'CLIENT-USER-A@org-a.test' });
  return db;
}
