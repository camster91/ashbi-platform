// The dashboard's money and counts must cover every row. A list read of a
// soft-deletable model stops at 100 rows, so totals built from findMany
// understated agencies with more than 100 outstanding invoices or active
// retainers. Runs only when TENANT_INTEGRATION_DATABASE_URL points at a
// disposable, fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { enterRequestContext } from '../../utils/request-context.js';
import dashboardRoutes from '../../routes/dashboard.routes.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

test('dashboard totals count every outstanding invoice and active retainer, past 100', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 8);
  const org = `dash-org-${suffix}`;
  const other = `dash-other-${suffix}`;
  const admin = `${org}-admin`;
  let app;
  try {
    for (const id of [org, other]) {
      await raw.organization.create({ data: { id, name: id, slug: id } });
    }
    await raw.user.create({ data: { id: admin, email: `${admin}@example.test`, name: 'Admin', password: 'x', role: 'ADMIN', organizationId: org } });
    const clients = Array.from({ length: 120 }, (_, i) => ({ id: `${org}-c${i}`, name: `Client ${i}`, organizationId: org }));
    await raw.client.createMany({ data: [...clients, { id: `${other}-c`, name: 'Other tenant', organizationId: other }] });
    // 120 active retainers of 100/month; one paused; one trashed; one in another tenant.
    await raw.retainerPlan.createMany({ data: [
      ...clients.slice(0, 120).map((c) => ({ clientId: c.id, tier: '999', hoursPerMonth: 20, monthlyAmountUsd: 100, retainerStatus: 'ACTIVE' })),
      { clientId: `${other}-c`, tier: '999', hoursPerMonth: 20, monthlyAmountUsd: 100000, retainerStatus: 'ACTIVE' },
    ] });
    await raw.retainerPlan.update({ where: { clientId: `${org}-c0` }, data: { retainerStatus: 'PAUSED' } });
    await raw.retainerPlan.update({ where: { clientId: `${org}-c1` }, data: { deletedAt: new Date() } });

    // 130 SENT invoices of 10 (30 of them past due), 5 OVERDUE of 20, drafts and a trashed one.
    const now = Date.now();
    const invoice = (n, data) => ({
      invoiceNumber: `DASH-${n}`, clientId: clients[n % clients.length].id, organizationId: org, createdById: admin, ...data,
    });
    await raw.invoice.createMany({ data: [
      ...Array.from({ length: 130 }, (_, n) => invoice(n, { status: 'SENT', total: 10, dueDate: new Date(now + (n < 30 ? -DAY : DAY)) })),
      ...Array.from({ length: 5 }, (_, n) => invoice(200 + n, { status: 'OVERDUE', total: 20, dueDate: new Date(now - DAY) })),
      invoice(300, { status: 'DRAFT', total: 999 }),
      invoice(301, { status: 'SENT', total: 5000, deletedAt: new Date() }),
    ] });

    app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.user = { id: admin, role: 'ADMIN', organizationId: org };
    });
    const scoped = createScopedPrisma(raw, org);
    app.addHook('onRequest', async (request) => {
      request.prisma = scoped;
      request.organizationId = org;
      enterRequestContext({ prisma: scoped, organizationId: org });
    });
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });

    const response = await app.inject({ method: 'GET', url: '/api/dashboard/stats' });
    assert.equal(response.statusCode, 200, response.body);
    const stats = response.json();
    assert.equal(stats.outstandingCount, 135, 'every SENT and OVERDUE invoice, not the first 100');
    assert.equal(stats.totalOutstanding, 130 * 10 + 5 * 20);
    assert.equal(stats.overdueCount, 35, 'OVERDUE status or past due');
    assert.equal(stats.overdueAmount, 30 * 10 + 5 * 20);
    assert.equal(stats.activeRetainerCount, 118, 'active, not trashed, this tenant only');
    assert.equal(stats.mrr, 118 * 100);
    assert.equal(stats.draftInvoiceCount, 1);
  } finally {
    await app?.close();
    for (const id of [org, other]) {
      await raw.invoice.deleteMany({ where: { organizationId: id } });
      await raw.retainerPlan.deleteMany({ where: { client: { organizationId: id } } });
      await raw.client.deleteMany({ where: { organizationId: id } });
      await raw.user.deleteMany({ where: { organizationId: id } });
      await purgeFixtureAuditEvents(raw, { ids: [id] });
      await raw.organization.deleteMany({ where: { id } });
    }
    await raw.$disconnect();
  }
});
