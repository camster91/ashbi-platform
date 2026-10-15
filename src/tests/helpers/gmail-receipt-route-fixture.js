/** In-memory transactional fixture for HTTP receipt/transport contract tests. */
export function gmailReceiptRouteFixture(user) {
  let receipts = [];
  const messages = [];
  const thread = { id: 'thr-1', clientId: 'client-1', assignedToId: user.id, projectId: null,
    client: { id: 'client-1', organizationId: user.organizationId, deletedAt: null }, project: null };
  const match = (row, where = {}) => Boolean(row) && Object.entries(where).every(([key, value]) =>
    key === 'AND' ? (Array.isArray(value) ? value : [value]).every(part => match(row, part))
      : key === 'OR' ? value.some(part => match(row, part))
        : value && typeof value === 'object' ? match(row[key], value) : row[key] === value);
  const prisma = {
    user: { findFirst: async () => ({ ...user, isActive: true }) },
    thread: { findFirst: async ({ where }) => match(thread, where) ? thread : null, updateMany: async () => ({ count: 1 }) },
    message: { create: async ({ data }) => { const row = { id: `message-${messages.length}`, ...data }; messages.push(row); return row; } },
    auditEvent: { create: async ({ data }) => ({ id: 'audit-test', ...data }) },
    gmailSendReceipt: {
      findFirst: async ({ where }) => receipts.find(row => match(row, where)) || null,
      create: async ({ data }) => { const row = { id: `receipt-${receipts.length}`, createdAt: new Date(), updatedAt: new Date(), ...data }; receipts.push(row); return row; },
      updateMany: async ({ where, data }) => {
        const rows = receipts.filter(row => match(row, where));
        for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
        return { count: rows.length };
      },
    },
  };
  prisma.$transaction = async callback => { const before = structuredClone(receipts); try { return await callback(prisma); } catch (error) { receipts = before; throw error; } };
  return { prisma, messages, receipts: () => receipts };
}
