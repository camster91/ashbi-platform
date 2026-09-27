// Real-database proof for payment references (H8): a manual bank/cheque
// reference may repeat across invoices (clients reuse remittance numbers),
// while a Stripe transaction id stays unique so a replayed webhook can never
// record the same charge twice.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import invoiceRoutes from '../../routes/invoice.routes.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { enterRequestContext, getRequestPrisma } from '../../utils/request-context.js';
import { statusCodeForError, toClientErrorBody } from '../../utils/http-errors.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('manual payment references may repeat across invoices; Stripe ids stay unique', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const org = `payref-org-${suffix}`;
  const user = `payref-user-${suffix}`;
  const client = `payref-client-${suffix}`;
  let app;

  try {
    await raw.organization.create({ data: { id: org, name: 'Payment refs', slug: `payref-${suffix}` } });
    await raw.user.create({ data: { id: user, email: `payref-${suffix}@example.test`, name: 'U', password: 'x', role: 'ADMIN', organizationId: org } });
    await raw.client.create({ data: { id: client, name: 'Client', organizationId: org } });
    const [first, second, third] = await Promise.all([1, 2, 3].map((n) => raw.invoice.create({ data: {
      invoiceNumber: `REF-${n}-${suffix}`, clientId: client, createdById: user, status: 'SENT', total: 100,
    } })));

    app = Fastify({ logger: false });
    app.decorate('prisma', new Proxy({}, {
      get(_target, prop) {
        const db = getRequestPrisma();
        const value = db[prop];
        return typeof value === 'function' ? value.bind(db) : value;
      },
    }));
    app.decorate('authenticate', async (request) => { request.user = { id: user, organizationId: org, role: 'ADMIN' }; });
    app.decorate('adminOnly', app.authenticate);
    app.addHook('preHandler', async (request) => {
      const scoped = createScopedPrisma(raw, org);
      request.prisma = scoped;
      enterRequestContext({ prisma: scoped, organizationId: org });
    });
    app.setErrorHandler((error, _request, reply) => reply.status(statusCodeForError(error)).send(toClientErrorBody(error)));
    await app.register(invoiceRoutes);

    const markPaid = (id) => app.inject({
      method: 'POST', url: `/${id}/mark-paid`, payload: { paymentMethod: 'BANK', transactionId: 'ETRANSFER-0001' },
    });
    const a = await markPaid(first.id);
    assert.equal(a.statusCode, 200, a.body);
    const b = await markPaid(second.id);
    assert.equal(b.statusCode, 200, b.body);
    assert.equal(await raw.invoicePayment.count({ where: { transactionId: 'ETRANSFER-0001' } }), 2);

    // Stripe ids remain unique at the database level.
    const stripeId = `pi_${suffix}`;
    await raw.invoicePayment.create({ data: { invoiceId: first.id, amount: 1, method: 'STRIPE', transactionId: stripeId } });
    const duplicate = await raw.invoicePayment.create({ data: { invoiceId: third.id, amount: 1, method: 'STRIPE', transactionId: stripeId } })
      .catch((error) => error);
    assert.equal(duplicate?.code, 'P2002');
    assert.equal(statusCodeForError(duplicate), 409);
    // A manual reference that happens to equal a Stripe id is not a conflict.
    await raw.invoicePayment.create({ data: { invoiceId: third.id, amount: 1, method: 'BANK', transactionId: stripeId } });
  } finally {
    await app?.close();
    await raw.invoicePayment.deleteMany({ where: { invoice: { clientId: client } } });
    await raw.invoice.deleteMany({ where: { clientId: client } });
    await purgeFixtureAuditEvents(raw, { ids: [org] });
    await raw.client.deleteMany({ where: { organizationId: org } });
    await raw.user.deleteMany({ where: { organizationId: org } });
    await raw.organization.deleteMany({ where: { id: org } });
    await raw.$disconnect();
  }
});
