import { randomUUID } from 'node:crypto';
export function handoffFixture() {
  const state = {
    user: [
      ...['a', 'b'].map(key => ({ id: `client-${key}`, email: `${key}@example.invalid`, name: key, role: 'CLIENT', clientId: 'client', organizationId: 'org', isActive: true, sessionVersion: 0 })),
      ...['admin', 'team', 'other'].map(id => ({ id, name: id, role: id === 'admin' ? 'ADMIN' : 'TEAM', organizationId: 'org', isActive: true, sessionVersion: 0 })),
      { id: 'foreign', role: 'ADMIN', organizationId: 'foreign', isActive: true },
    ],
    contact: ['a', 'b'].map(key => ({ id: `contact-${key}`, email: `${key}@example.invalid`, clientId: 'client' })),
    client: [{ id: 'client', organizationId: 'org', deletedAt: null, status: 'ACTIVE', relationshipStatus: 'CURRENT', name: 'Client' }],
    project: [{ id: 'project', organizationId: 'org', clientId: 'client', deletedAt: null, name: 'Project' }, { id: 'project-2', organizationId: 'org', clientId: 'client', deletedAt: null }],
    portalHandoffRequest: [], auditEvent: [],
  };
  const calls = [];let auditFailure = false;
  function matches(row, where = {}) {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'AND') return value.every(part => matches(row, part));
      if (key === 'OR') return value.some(part => matches(row, part));
      let actual = row[key];
      if (key === 'project') actual = state.project.find(project => project.id === row.projectId);
      if (key === 'client') actual = state.client.find(client => client.id === row.clientId);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if ('in' in value) return value.in.includes(actual);
        if ('notIn' in value) return !value.notIn.includes(actual);
        if ('gt' in value) return actual > value.gt;
        return Boolean(actual) && matches(actual, value);
      }
      return actual === value;
    });
  }
  const db = Object.fromEntries(Object.keys(state).map(model => [model, {
    findUnique: async ({ where }) => structuredClone(state[model].find(row => matches(row, where)) ?? null),
    findFirst: async ({ where }) => { calls.push({ model, where });return structuredClone(state[model].find(row => matches(row, where)) ?? null); },
    findMany: async ({ where, take }) => { calls.push({ model, where, take });return structuredClone(state[model].filter(row => matches(row, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take)).map(row => ({ ...row, project: row.projectId ? { ...state.project.find(p => p.id === row.projectId), client: state.client[0] } : undefined })); },
    create: async ({ data }) => {
      if (model === 'auditEvent' && auditFailure) throw new Error('Synthetic audit failure');
      const row = { id: randomUUID(), ownerId: null, claimedAt: null, resolvedAt: null, requeueReason: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      state[model].push(row);return structuredClone(row);
    },
    updateMany: async ({ where, data }) => {
      const rows = state[model].filter(row => matches(row, where));
      for (const row of rows) Object.assign(row, ...Object.entries(data).map(([key, value]) => ({ [key]: value?.increment ? row[key] + value.increment : value })), { updatedAt: new Date() });
      return { count: rows.length };
    },
  }]));
  let tail = Promise.resolve();
  db.$queryRaw = async query => {
    const filters = JSON.parse(query.values[0]);calls.push({ model: '$queryRaw', filters });
    return state.portalHandoffRequest.filter(row => {
      const project = state.project.find(p => p.id === row.projectId), client = state.client.find(c => c.id === row.clientId);
      return row.organizationId === filters.organizationId && project?.organizationId === row.organizationId && project.clientId === row.clientId && project.deletedAt === null
        && client?.organizationId === row.organizationId && client.deletedAt === null && client.status === 'ACTIVE' && !['ARCHIVED', 'CHURNED'].includes(client.relationshipStatus)
        && (!filters.requestId || row.id === filters.requestId) && (!filters.after || row.id > filters.after)
        && (!filters.projectId || row.projectId === filters.projectId) && (!filters.clientId || row.clientId === filters.clientId)
        && (!filters.ownerId || row.ownerId === filters.ownerId) && (!filters.statuses || filters.statuses.includes(row.status));
    }).sort((a, b) => a.id.localeCompare(b.id)).slice(0, filters.limit).map(row => ({ id: row.id }));
  };
  db.$transaction = (work, options) => {
    if (options?.isolationLevel !== 'Serializable') throw new Error('Serializable required');
    const next = tail.then(async () => {
      const snapshot = structuredClone(state);
      try { return await work(db); } catch (error) { for (const key of Object.keys(state)) state[key] = snapshot[key];throw error; }
    });tail = next.catch(() => {});return next;
  };
  const claims = key => ({ ...state.user.find(user => user.id === `client-${key}`), contactId: `contact-${key}`, typ: 'client_session' });
  const staff = id => ({ ...state.user.find(user => user.id === id) });
  return { db, state, claims, staff, calls, failAudit: () => { auditFailure = true; } };
}
