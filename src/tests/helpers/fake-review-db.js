// In-memory, multi-organization stand-in for the Prisma delegates the media
// review routes use (#417, docs/media-review.md). Not tenant-scoped itself:
// tests wrap it with createScopedPrisma for staff routes and use it raw for
// the public share-link routes, exactly as the application does.
//
// It understands equality, null, Date, { lt }, { in }, AND, OR, to-one,
// reverse to-one and to-many relation filters/includes (with nested
// where/select/include), orderBy (object or array), take, the unique keys
// the migration declares (tokenHash, previousSessionId), transactions with
// rollback, and the review_decisions append-only trigger.

let nextId = 1;

// relation name -> [target model, kind, field]
//   one:     row[field] references target.id
//   reverse: target[field] references row.id (at most one)
//   many:    target[field] references row.id
const RELATIONS = {
  project: {},
  attachment: {},
  reviewSession: {
    project: ['project', 'one', 'projectId'],
    attachment: ['attachment', 'one', 'attachmentId'],
    previousSession: ['reviewSession', 'one', 'previousSessionId'],
    nextSession: ['reviewSession', 'reverse', 'previousSessionId'],
    annotations: ['reviewAnnotation', 'many', 'sessionId'],
    decisions: ['reviewDecision', 'many', 'sessionId'],
    shareLinks: ['reviewShareLink', 'many', 'sessionId'],
  },
  reviewAnnotation: { session: ['reviewSession', 'one', 'sessionId'], parent: ['reviewAnnotation', 'one', 'parentId'] },
  reviewDecision: { session: ['reviewSession', 'one', 'sessionId'] },
  reviewShareLink: { session: ['reviewSession', 'one', 'sessionId'] },
};

const UNIQUE = {
  reviewShareLink: ['tokenHash'],
  reviewSession: ['previousSessionId'],
  reviewDecision: ['shareLinkId'],
};

function compareValues(a, b) {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (x === y) return 0;
  if (x === null || x === undefined) return -1;
  if (y === null || y === undefined) return 1;
  return x > y ? 1 : -1;
}

export function createFakeReviewDb() {
  const tables = {
    organization: [], user: [], client: [], project: [], attachment: [],
    reviewSession: [], reviewAnnotation: [], reviewDecision: [], reviewShareLink: [], auditEvent: [],
  };

  function relationRows(model, row, key) {
    const relation = RELATIONS[model]?.[key];
    if (!relation) return undefined;
    const [target, kind, field] = relation;
    if (kind === 'one') return { target, kind, rows: tables[target].filter((candidate) => candidate.id === row[field]) };
    return { target, kind, rows: tables[target].filter((candidate) => candidate[field] === row.id) };
  }

  function matches(model, row, where = {}) {
    return Object.entries(where).every(([key, condition]) => {
      if (condition === undefined) return true;
      if (key === 'AND') return condition.every((branch) => matches(model, row, branch));
      if (key === 'OR') return condition.some((branch) => matches(model, row, branch));
      const relation = relationRows(model, row, key);
      if (relation && condition && typeof condition === 'object' && !(condition instanceof Date)) {
        const [first] = relation.rows;
        return first ? matches(relation.target, first, condition) : false;
      }
      const value = row[key];
      if (condition === null) return value === null || value === undefined;
      if (condition instanceof Date) return value?.getTime?.() === condition.getTime();
      if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
        if ('in' in condition) return condition.in.includes(value);
        if ('not' in condition) return value !== condition.not;
        if ('lt' in condition) return value !== null && value !== undefined && compareValues(value, condition.lt) < 0;
        return false;
      }
      return value === condition;
    });
  }

  function order(rows, orderBy) {
    if (!orderBy) return rows;
    const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((entry) => Object.entries(entry));
    return [...rows].sort((a, b) => {
      for (const [field, direction] of keys) {
        const result = compareValues(a[field], b[field]);
        if (result) return direction === 'desc' ? -result : result;
      }
      return 0;
    });
  }

  function shape(model, row, { select, include } = {}) {
    if (!row) return null;
    if (!select && !include) return structuredClone(row);
    const out = select ? {} : structuredClone(row);
    for (const [key, spec] of Object.entries(select ?? include)) {
      if (!spec) continue;
      const relation = relationRows(model, row, key);
      if (!relation) {
        out[key] = structuredClone(row[key]);
        continue;
      }
      const nested = spec === true ? {} : spec;
      if (relation.kind === 'many') {
        let hits = relation.rows.filter((candidate) => matches(relation.target, candidate, nested.where));
        hits = order(hits, nested.orderBy);
        out[key] = hits.map((candidate) => shape(relation.target, candidate, nested));
      } else {
        out[key] = shape(relation.target, relation.rows[0] ?? null, nested);
      }
    }
    return out;
  }

  function checkUnique(model, row, ignoreId) {
    for (const field of UNIQUE[model] ?? []) {
      if (row[field] === null || row[field] === undefined) continue;
      if (tables[model].some((other) => other.id !== ignoreId && other[field] === row[field])) {
        throw Object.assign(new Error(`Unique constraint failed on ${field}`), { code: 'P2002' });
      }
    }
  }

  function guardDecision() {
    throw Object.assign(new Error('review decisions are append-only (UPDATE rejected)'), { code: 'P2010' });
  }

  function delegate(model) {
    const rows = () => tables[model];
    const find = (where) => rows().find((row) => matches(model, row, where)) ?? null;
    return {
      get rows() { return rows(); },
      findFirst: async (args = {}) => shape(model, order(rows().filter((row) => matches(model, row, args.where)), args.orderBy)[0] ?? null, args),
      findUnique: async (args = {}) => shape(model, find(args.where), args),
      findMany: async (args = {}) => {
        let hits = order(rows().filter((row) => matches(model, row, args.where)), args.orderBy);
        if (args.take) hits = hits.slice(0, args.take);
        return hits.map((row) => shape(model, row, args));
      },
      count: async ({ where } = {}) => rows().filter((row) => matches(model, row, where)).length,
      create: async (args) => {
        const now = new Date();
        const row = { id: `${model}-${nextId++}`, createdAt: now, ...(model === 'reviewDecision' ? {} : { updatedAt: now }), ...structuredClone(args.data) };
        if (model === 'reviewSession') row.status ??= 'open';
        if (model === 'reviewShareLink') row.allowDecision ??= false;
        checkUnique(model, row);
        rows().push(row);
        return shape(model, row, args);
      },
      update: async (args) => {
        const row = find(args.where);
        if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
        if (model === 'reviewDecision') guardDecision();
        const next = { ...row, ...structuredClone(args.data), updatedAt: new Date() };
        checkUnique(model, next, row.id);
        Object.assign(row, next);
        return shape(model, row, args);
      },
      updateMany: async ({ where, data }) => {
        const hits = rows().filter((row) => matches(model, row, where));
        if (model === 'reviewDecision' && hits.length) guardDecision();
        for (const row of hits) Object.assign(row, structuredClone(data), { updatedAt: new Date() });
        return { count: hits.length };
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
 * Two organizations, each with a project that owns an image, a video, a PDF
 * and a spreadsheet attachment.
 * @param {ReturnType<typeof createFakeReviewDb>} db
 */
export function seedReviewOrganizations(db) {
  const t = db.tables;
  for (const suffix of ['a', 'b']) {
    const org = `org-${suffix}`;
    t.organization.push({ id: org, name: `Org ${suffix.toUpperCase()}` });
    t.client.push({ id: `client-${suffix}`, organizationId: org, name: `Client ${suffix.toUpperCase()}` });
    t.project.push({ id: `project-${suffix}`, organizationId: org, clientId: `client-${suffix}`, name: `Website ${suffix.toUpperCase()}`, deletedAt: null });
    const file = (id, originalName, mimeType) => ({
      id: `${id}-${suffix}`, organizationId: org, filename: `${id}-${suffix}.bin`, originalName, mimeType, size: 1024,
      path: `/uploads/${id}-${suffix}.bin`, entityType: 'PROJECT', entityId: `project-${suffix}`, uploadedById: `admin-${suffix}`, createdAt: new Date(),
    });
    t.attachment.push(
      file('image', 'Homepage.png', 'image/png'),
      file('video', 'Walkthrough.webm', 'video/webm'),
      file('pdf', 'Brochure.pdf', 'application/pdf'),
      file('sheet', 'Budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    );
  }
  return db;
}
