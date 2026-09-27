// In-memory stand-in for the Prisma surface the invoice routes use, so route
// contracts (validation, status rules, numbering calls, payloads) can be
// exercised without a database. Real-database behaviour (unique indexes,
// concurrency, migrations) is covered by src/tests/integration/*.database.test.js.

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (key === 'AND') return expected.every((clause) => matches(row, clause));
    if (key === 'OR') return expected.some((clause) => matches(row, clause));
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('in' in expected) return expected.in.includes(actual);
      if ('not' in expected) return actual !== expected.not;
      if ('lt' in expected) return actual != null && new Date(actual) < new Date(expected.lt);
      if ('gte' in expected) return actual != null && new Date(actual) >= new Date(expected.gte);
      if ('contains' in expected) return String(actual ?? '').toLowerCase().includes(String(expected.contains).toLowerCase());
      return true; // relation filters are out of scope for the fake
    }
    return actual === expected;
  });
}

export function createFakeInvoiceDb({ clients = [], invoices = [], organizationId = 'org-a' } = {}) {
  const state = {
    clients: clients.map((client) => ({ organizationId, contacts: [], ...client })),
    invoices: invoices.map((invoice) => ({ lineItems: [], payments: [], currency: 'CAD', ...invoice })),
    lineItems: [],
    payments: [],
    sequences: new Map(),
    audit: [],
    nextId: 1,
  };

  const withRelations = (invoice) => {
    if (!invoice) return null;
    const client = state.clients.find((c) => c.id === invoice.clientId) || null;
    return { ...invoice, client, lineItems: invoice.lineItems || [], payments: invoice.payments || [] };
  };

  const db = {
    state,
    client: {
      findUnique: async ({ where }) => state.clients.find((c) => c.id === where.id) || null,
      findFirst: async ({ where }) => state.clients.find((c) => matches(c, where)) || null,
    },
    organization: {
      findUnique: async ({ where }) => ({ id: where.id, name: 'Org' }),
    },
    invoice: {
      findUnique: async ({ where }) => withRelations(state.invoices.find((i) => (
        (where.id && i.id === where.id) || (where.viewToken && i.viewToken === where.viewToken)
      ))),
      findFirst: async ({ where, orderBy } = {}) => {
        const rows = state.invoices.filter((i) => matches(i, where));
        if (orderBy?.invoiceNumber === 'desc') rows.sort((a, b) => String(b.invoiceNumber).localeCompare(String(a.invoiceNumber)));
        return withRelations(rows[0]);
      },
      findMany: async ({ where } = {}) => state.invoices.filter((i) => matches(i, where)).map(withRelations),
      count: async ({ where } = {}) => state.invoices.filter((i) => matches(i, where)).length,
      create: async ({ data }) => {
        const { lineItems, ...rest } = data;
        const invoice = {
          id: `invoice-${state.nextId++}`,
          status: 'DRAFT',
          currency: 'CAD',
          viewToken: `default-token-${state.nextId}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          payments: [],
          ...rest,
          lineItems: lineItems?.create || [],
        };
        state.invoices.push(invoice);
        return withRelations(invoice);
      },
      update: async ({ where, data }) => {
        const invoice = state.invoices.find((i) => i.id === where.id);
        if (!invoice) throw new Error('Record to update not found');
        Object.assign(invoice, data, { updatedAt: new Date() });
        return withRelations(invoice);
      },
      updateMany: async ({ where, data }) => {
        const rows = state.invoices.filter((i) => matches(i, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
      groupBy: async ({ by, where }) => {
        const groups = new Map();
        for (const invoice of state.invoices.filter((i) => matches(i, where))) {
          const key = by.map((field) => invoice[field]).join('|');
          const group = groups.get(key) || { ...Object.fromEntries(by.map((field) => [field, invoice[field]])), _count: { _all: 0 }, _sum: { total: 0 } };
          group._count._all += 1;
          group._sum.total += invoice.total || 0;
          groups.set(key, group);
        }
        return [...groups.values()];
      },
    },
    invoiceLineItem: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }) => ({ count: data.length }),
      findMany: async ({ where }) => state.invoices.find((i) => i.id === where.invoiceId)?.lineItems || [],
    },
    invoicePayment: {
      create: async ({ data }) => { state.payments.push(data); return { id: `payment-${state.payments.length}`, ...data }; },
      findMany: async () => state.payments,
    },
    auditEvent: {
      create: async ({ data }) => { state.audit.push(data); return data; },
    },
    // Numbering: answers the raw SQL the numbering service issues.
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join('?');
      if (sql.includes('FROM "clients"')) {
        const client = state.clients.find((c) => c.id === values[0]);
        return client ? [{ organizationId: client.organizationId }] : [];
      }
      if (sql.includes('document_number_sequences')) {
        const [orgId, kind, period] = values;
        const key = `${orgId}|${kind}|${period}`;
        const next = (state.sequences.get(key) || 0) + 1;
        state.sequences.set(key, next);
        return [{ lastValue: next }];
      }
      if (sql.includes('FROM "invoices"')) {
        return state.invoices.filter((i) => i.organizationId === values[0] && i.invoiceNumber === values[1]).map(() => ({ exists: 1 }));
      }
      throw new Error(`Unexpected raw query in fake invoice db: ${sql}`);
    },
    $transaction: async (input) => (typeof input === 'function' ? input(db) : Promise.all(input)),
  };
  return db;
}

/** Fastify app wired like production: `fastify.prisma` and `request.prisma` are the same scoped client. */
export async function buildInvoiceApp(t, routes, db, { user = { id: 'user-a', organizationId: 'org-a', role: 'ADMIN' }, prefix } = {}) {
  const { default: Fastify } = await import('fastify');
  const app = Fastify();
  app.decorate('prisma', db);
  app.decorate('authenticate', async (request) => { request.user = user; });
  app.decorate('adminOnly', async (request) => { request.user = user; });
  app.addHook('onRequest', async (request) => { request.prisma = db; });
  await app.register(routes, prefix ? { prefix } : {});
  t.after(() => app.close());
  return app;
}
