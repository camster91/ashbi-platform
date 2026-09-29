// Real-database proof that overdue reminders are claimed before they are sent
// (S2) and that the job's working set cannot be starved (S8):
//   - a payment landing mid-job gets no reminder;
//   - two overlapping runs send each message once;
//   - a provider failure releases the claim and the retry sends once;
//   - a reminder on day 1 is followed by exactly one escalation on day 8;
//   - with more past-due invoices than a page, new ones are still reached.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { checkOverdueInvoicesForOrganizations } from '../../services/automation.service.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;
const skip = !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured';

async function withFixture(run) {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const org = `claims-org-${suffix}`;
  const client = `${org}-client`;
  const admin = `${org}-admin`;
  try {
    await raw.organization.create({ data: { id: org, name: 'Claims', slug: `claims-${suffix}` } });
    await raw.user.create({ data: { id: admin, email: `${org}@example.test`, name: 'Admin', password: 'x', role: 'ADMIN', organizationId: org } });
    await raw.client.create({ data: {
      id: client, name: 'Client', organizationId: org,
      contacts: { create: [{ name: 'Contact', email: `contact-${suffix}@example.test`, isPrimary: true }] },
    } });
    const invoice = (n, { dueDate, ...overrides } = {}) => raw.invoice.create({ data: {
      id: `${org}-inv-${n}`, invoiceNumber: `CLM-${n}`, clientId: client, createdById: admin, status: 'SENT',
      total: 100, currency: 'CAD', dueDate, sentAt: new Date(dueDate.getTime() - 30 * DAY),
      viewToken: `${org}-token-${n}`, publicAccessExpiresAt: new Date(dueDate.getTime() + 60 * DAY), ...overrides,
    } });
    await run({ raw, org, invoice });
  } finally {
    await raw.notification.deleteMany({ where: { user: { organizationId: org } } });
    await raw.activity.deleteMany({ where: { user: { organizationId: org } } });
    await raw.invoice.deleteMany({ where: { organizationId: org } });
    await raw.contact.deleteMany({ where: { clientId: client } });
    await raw.client.deleteMany({ where: { organizationId: org } });
    await raw.user.deleteMany({ where: { organizationId: org } });
    await raw.organization.deleteMany({ where: { id: org } });
    await raw.$disconnect();
  }
}

function recorder({ fail = () => false, beforeSend = async () => {} } = {}) {
  const sent = [];
  const send = async (message) => {
    await beforeSend(message);
    if (fail(message)) return { ok: false, error: 'provider down' };
    sent.push(message);
    return { ok: true };
  };
  return { sent, send };
}

test('a payment landing mid-job gets no reminder', { skip, timeout: 120_000 }, async () => {
  await withFixture(async ({ raw, org, invoice }) => {
    const due = new Date(Date.now() - 2 * DAY);
    await invoice(1, { dueDate: due });
    await invoice(2, { dueDate: due });
    const { sent, send } = recorder({
      // While the first reminder is being sent, the second invoice is paid.
      beforeSend: async (message) => {
        if (message.invoiceNumber === 'CLM-1') await raw.invoice.update({ where: { id: `${org}-inv-2` }, data: { status: 'PAID', paidAt: new Date() } });
      },
    });
    const result = await checkOverdueInvoicesForOrganizations([org], { db: raw, sendOverdueEmail: send });
    assert.equal(result.failed.length, 0);
    assert.deepEqual(sent.map((message) => message.invoiceNumber), ['CLM-1']);
    const paid = await raw.invoice.findUnique({ where: { id: `${org}-inv-2` } });
    assert.equal(paid.status, 'PAID');
    assert.equal(paid.reminderSentAt, null);
  });
});

test('two overlapping runs send each reminder once', { skip, timeout: 120_000 }, async () => {
  await withFixture(async ({ raw, org, invoice }) => {
    for (const n of [1, 2, 3]) await invoice(n, { dueDate: new Date(Date.now() - 2 * DAY) });
    const { sent, send } = recorder({ beforeSend: () => new Promise((resolve) => setTimeout(resolve, 50)) });
    await Promise.all([
      checkOverdueInvoicesForOrganizations([org], { db: raw, sendOverdueEmail: send }),
      checkOverdueInvoicesForOrganizations([org], { db: raw, sendOverdueEmail: send }),
    ]);
    assert.deepEqual(sent.map((message) => message.invoiceNumber).sort(), ['CLM-1', 'CLM-2', 'CLM-3']);
  });
});

test('a provider failure releases the claim and the retry sends once', { skip, timeout: 120_000 }, async () => {
  await withFixture(async ({ raw, org, invoice }) => {
    await invoice(1, { dueDate: new Date(Date.now() - 2 * DAY) });
    const failing = recorder({ fail: () => true });
    await checkOverdueInvoicesForOrganizations([org], { db: raw, sendOverdueEmail: failing.send });
    assert.equal((await raw.invoice.findUnique({ where: { id: `${org}-inv-1` } })).reminderSentAt, null, 'the claim was released');

    const working = recorder();
    await checkOverdueInvoicesForOrganizations([org], { db: raw, sendOverdueEmail: working.send });
    await checkOverdueInvoicesForOrganizations([org], { db: raw, sendOverdueEmail: working.send });
    assert.equal(working.sent.length, 1);
    assert.ok((await raw.invoice.findUnique({ where: { id: `${org}-inv-1` } })).reminderSentAt);
  });
});

test('a day-1 reminder is followed by exactly one day-8 escalation', { skip, timeout: 120_000 }, async () => {
  await withFixture(async ({ raw, org, invoice }) => {
    const due = new Date(Date.now() - 1 * DAY);
    await invoice(1, { dueDate: due });
    const { sent, send } = recorder();
    const run = (now) => checkOverdueInvoicesForOrganizations([org], { db: raw, sendOverdueEmail: send, now });

    await run(new Date(due.getTime() + 1 * DAY));
    await run(new Date(due.getTime() + 2 * DAY));
    assert.equal(sent.length, 1, 'one reminder in the first week');
    assert.equal(sent[0].daysOverdue, 1);

    await run(new Date(due.getTime() + 8 * DAY));
    await run(new Date(due.getTime() + 9 * DAY));
    assert.equal(sent.length, 2, 'exactly one escalation');
    assert.equal(sent[1].daysOverdue, 8);
    const escalated = await raw.invoice.findUnique({ where: { id: `${org}-inv-1` } });
    assert.ok(escalated.overdueEscalatedAt);
    assert.equal((await raw.client.findFirst({ where: { organizationId: org } })).paymentStatus, 'AT_RISK');
  });
});

test('new overdue invoices are reached even when older ones fill a page', { skip, timeout: 120_000 }, async () => {
  await withFixture(async ({ raw, org, invoice }) => {
    const due = new Date(Date.now() - 2 * DAY);
    // Five already-reminded invoices that need nothing, then two new ones
    // (ids sort after the old ones).
    for (const n of [1, 2, 3, 4, 5]) await invoice(n, { dueDate: due, status: 'OVERDUE', reminderSentAt: new Date(due.getTime() + DAY) });
    // Escalated invoices are outside the working set entirely.
    await invoice(6, { dueDate: new Date(Date.now() - 20 * DAY), status: 'OVERDUE', reminderSentAt: new Date(), overdueEscalatedAt: new Date() });
    for (const n of [7, 8]) await invoice(n, { dueDate: due });
    const { sent, send } = recorder();
    const result = await checkOverdueInvoicesForOrganizations([org], { db: raw, sendOverdueEmail: send, pageSize: 3 });
    assert.equal(result.failed.length, 0);
    assert.equal(result.processed, 7, 'the escalated invoice is not in the working set');
    assert.deepEqual(sent.map((message) => message.invoiceNumber).sort(), ['CLM-7', 'CLM-8']);
  });
});
