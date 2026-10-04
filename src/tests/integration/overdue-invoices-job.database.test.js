// Real-database proof for the overdue-invoice job (H6): every past-due
// invoice in every organization is processed, one failing step (activity
// logging, notifications, email) cannot abort the rest, and reminders go out
// through the templated overdue email with the invoice currency and the
// public invoice link.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { checkOverdueInvoices, checkOverdueInvoicesForOrganizations } from '../../services/automation.service.js';
import { runTenantJob } from '../../jobs/tenant-iteration.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

test('the overdue job processes every overdue invoice in every organization', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const orgs = [`overdue-org-a-${suffix}`, `overdue-org-b-${suffix}`];
  const sent = [];

  try {
    for (const [index, org] of orgs.entries()) {
      await raw.organization.create({ data: { id: org, name: `Overdue ${index}`, slug: `overdue-${index}-${suffix}` } });
      await raw.user.create({ data: { id: `${org}-admin`, email: `${org}@example.test`, name: 'Admin', password: 'x', role: 'ADMIN', organizationId: org } });
      await raw.client.create({ data: {
        id: `${org}-client`, name: `Client ${index}`, organizationId: org,
        contacts: { create: [{ name: `Contact ${index}`, email: `contact-${index}-${suffix}@example.test`, isPrimary: true }] },
      } });
      // Two just-overdue invoices (no project: activity logging cannot be
      // tenant-scoped for them) and one 10 days overdue, per organization.
      // The second one is VIEWED, which is chased and
      // moved to OVERDUE exactly like SENT.
      for (const [n, daysOverdue, currency] of [[1, 2, 'CAD'], [2, 3, 'USD'], [3, 10, 'CAD']]) {
        await raw.invoice.create({ data: {
          id: `${org}-inv-${n}`, invoiceNumber: `OVD-${n}`, clientId: `${org}-client`, createdById: `${org}-admin`,
          status: n === 2 ? 'VIEWED' : 'SENT', total: 100 * n, currency, dueDate: new Date(Date.now() - daysOverdue * DAY),
          sentAt: new Date(Date.now() - 30 * DAY), viewToken: `${org}-token-${n}`,
          publicAccessExpiresAt: new Date(Date.now() - daysOverdue * DAY),
        } });
      }
    }

    const sendOverdueEmail = async (message) => { sent.push(message); return { ok: true, id: `msg-${sent.length}` }; };
    // The same entry point the scheduled job uses, restricted to the fixture
    // organizations so a shared test database is not touched.
    const result = await checkOverdueInvoicesForOrganizations(orgs, { db: raw, sendOverdueEmail });
    assert.equal(result.failed.length, 0, JSON.stringify(result.failed));

    const invoices = await raw.invoice.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: 'asc' } });
    assert.equal(invoices.length, 6);
    for (const invoice of invoices) {
      assert.equal(invoice.status, 'OVERDUE', `${invoice.id} is marked overdue`);
      assert.ok(invoice.reminderSentAt, `${invoice.id} records its reminder`);
    }
    assert.equal(sent.length, 6, 'one templated reminder per invoice');
    assert.equal(sent.filter((message) => message.invoiceNumber === 'OVD-2').length, 2, 'past-due VIEWED invoices are reminded');
    const usd = sent.find((message) => message.invoiceNumber === 'OVD-2');
    assert.equal(usd.currency, 'USD');
    assert.match(usd.viewUrl, /\/portal\/invoice\/overdue-org-.*-token-2$/);
    assert.equal((await raw.client.findUnique({ where: { id: `${orgs[0]}-client` } })).paymentStatus, 'AT_RISK');

    // Idempotent: a second run sends nothing new.
    const again = await checkOverdueInvoicesForOrganizations(orgs, { db: raw, sendOverdueEmail });
    assert.equal(again.failed.length, 0);
    assert.equal(sent.length, 6);

    // The no-argument form used inside a tenant job still works.
    await runTenantJob(raw, orgs[0], () => checkOverdueInvoices(), raw);
  } finally {
    await raw.notification.deleteMany({ where: { user: { organizationId: { in: orgs } } } });
    await raw.activity.deleteMany({ where: { user: { organizationId: { in: orgs } } } });
    await raw.invoice.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.contact.deleteMany({ where: { client: { organizationId: { in: orgs } } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
