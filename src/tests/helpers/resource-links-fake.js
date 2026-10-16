import { randomUUID } from 'node:crypto';
// Service-only adapter. Integration tests separately exercise real PostgreSQL.
export function createResourceLinkFakeDb(overrides = {}) {
    const state = { users: [{ id: 'staff', organizationId: 'org', role: 'TEAM', isActive: true }, { id: 'admin', organizationId: 'org', role: 'ADMIN', isActive: true }, { id: 'other', organizationId: 'org', role: 'TEAM', isActive: true }], projects: [{ id: 'project', organizationId: 'org', clientId: 'client' }], tasks: [{ id: 'task', projectId: 'project' }], rows: [], audit: [], ...overrides };
    const match = (row, where = {}) => Object.entries(where).every(([key, value]) => {
        if (key === 'AND')
            return value.every(v => match(row, v));
        if (key === 'OR')
            return value.some(v => match(row, v));
        if (key === 'project')
            return state.projects.some(p => p.id === row.projectId && match(p, value));
        if (key === 'client')
            return !state.clientDeleted;
        if (key === 'task')
            return state.tasks.some(t => t.id === row.taskId && match(t, value));
        if (value && typeof value === 'object') {
            if ('gt' in value)
                return row[key] > value.gt;
            return match(row[key] ?? {}, value);
        }
        return value === null ? row[key] == null : row[key] === value;
    });
    const db = { state, user: { findFirst: async ({ where }) => state.users.find(r => match(r, where)) ?? null }, project: { findFirst: async ({ where }) => state.projects.find(r => match(r, where)) ?? null }, task: { findFirst: async ({ where }) => state.tasks.find(r => match(r, where)) ?? null }, auditEvent: { create: async ({ data }) => { state.audit.push(data); return data; } }, $queryRaw: async () => [], resourceLink: {
            findFirst: async ({ where }) => state.rows.find(r => match(r, where)) ?? null,
            findMany: async ({ where, take }) => state.rows.filter(r => match(r, where)).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).slice(0, take),
            aggregate: async ({ where }) => ({ _max: { position: Math.max(-1, ...state.rows.filter(r => match(r, where)).map(r => r.position)) } }),
            create: async ({ data }) => { const row = { id: randomUUID(), revision: 1, archivedAt: null, source: null, createdAt: new Date(), updatedAt: new Date(), ...data }; state.rows.push(row); return row; },
            updateMany: async ({ where, data }) => { const rows = state.rows.filter(r => match(r, where)); for (const row of rows)
                for (const [key, value] of Object.entries(data))
                    row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value; return { count: rows.length }; },
        } };
    db.$transaction = async (work) => { const saved = structuredClone(state); try {
        return await work(db);
    }
    catch (e) {
        Object.assign(state, saved);
        throw e;
    } };
    return db;
}
