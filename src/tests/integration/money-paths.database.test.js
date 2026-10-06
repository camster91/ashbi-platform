// Real-database proof for the money-path fixes: proposal-builder edits and
// approval, bulk void, estimate conversion, recurring invoices, partial
// payments, retainer billing periods, invoice project tenancy, decline/approve
// races and the invoice list sort. Built with the real application
// (buildApp), so authentication, role checks, the tenant proxy and the error
// handler are the production ones.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database (DATABASE_URL must point at the same database, as
// in CI, because the app uses its own client).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildApp } from '../../index.js';
import { signUserSession } from '../../auth/session.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { createPublicAccessWindow } from '../../utils/public-document-access.js';
import fs from 'node:fs';
import { firstRecurringDate, processRecurringInvoices } from '../../jobs/recurring-invoices.js';
import { handleCheckoutFailure, recordCompletedCheckout, recordRefusedCheckout } from '../../services/stripe.service.js';
import { retainerBillingPeriod } from '../../routes/retainer.routes.js';
import { computeEstimateTotals } from '../../routes/estimate.routes.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const ESTIMATE_LINES = [
  { description: 'Build', quantity: 2, rate: 100, amount: 200 },
  { description: 'Hosting', quantity: 1, rate: 50.5, amount: 50.5 },
];

test('money paths hold their invariants against the real database', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 180_000,
}, async (t) => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().replace(/-/g, '').slice(0, 16);
  const orgA = `money-org-a-${suffix}`;
  const orgB = `money-org-b-${suffix}`;
  const adminId = `money-admin-${suffix}`;
  const teamId = `money-team-${suffix}`;
  const clientA = `money-client-a-${suffix}`;
  const clientB = `money-client-b-${suffix}`;
  const projectA = `money-project-a-${suffix}`;
  const projectB = `money-project-b-${suffix}`;
  let app;

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Money A', slug: `money-a-${suffix}` },
      { id: orgB, name: 'Money B', slug: `money-b-${suffix}` },
    ] });
    await raw.user.createMany({ data: [
      { id: adminId, email: `money-admin-${suffix}@example.test`, name: 'Admin', password: 'x', role: 'ADMIN', organizationId: orgA },
      { id: teamId, email: `money-team-${suffix}@example.test`, name: 'Team', password: 'x', role: 'TEAM', organizationId: orgA },
    ] });
    await raw.client.createMany({ data: [
      { id: clientA, name: 'Client A', organizationId: orgA },
      { id: clientB, name: 'Client B', organizationId: orgB },
    ] });
    await raw.project.createMany({ data: [
      { id: projectA, name: 'Project A', clientId: clientA, organizationId: orgA },
      { id: projectB, name: 'Project B', clientId: clientB, organizationId: orgB },
    ] });

    app = await buildApp({ initializeRuntime: false, jwtSecret: 'money-paths-test-secret' });
    const tokens = {
      admin: signUserSession(app.jwt, await raw.user.findUnique({ where: { id: adminId } })),
      team: signUserSession(app.jwt, await raw.user.findUnique({ where: { id: teamId } })),
    };
    const api = (as, method, url, payload) => app.inject({
      method, url, payload, headers: as ? { authorization: `Bearer ${tokens[as]}` } : {},
    });
    const newInvoice = (data = {}) => raw.invoice.create({ data: {
      invoiceNumber: `MONEY-${randomUUID()}`, clientId: clientA, organizationId: orgA, createdById: adminId,
      status: 'SENT', total: 113, subtotal: 100, tax: 13, ...data,
    } });

    await t.test('1. a staff member cannot approve a proposal or set its total through the builder', async () => {
      const proposal = await raw.proposal.create({ data: {
        title: 'Builder draft', clientId: clientA, createdById: adminId, status: 'DRAFT', subtotal: 500, total: 500,
        lineItems: { create: [{ description: 'Design', quantity: 1, unitPrice: 500, total: 500 }] },
      } });

      const forged = await api('team', 'PUT', `/api/proposal-builder/${proposal.id}`, { status: 'APPROVED', total: 1 });
      assert.equal(forged.statusCode, 400, forged.body);
      const forgedSubtotal = await api('team', 'PUT', `/api/proposal-builder/${proposal.id}`, { title: 'x', subtotal: 1 });
      assert.equal(forgedSubtotal.statusCode, 400, forgedSubtotal.body);
      let stored = await raw.proposal.findUnique({ where: { id: proposal.id } });
      assert.deepEqual([stored.status, stored.total], ['DRAFT', 500]);

      // Totals come from the line items and discount, computed on the server.
      const edited = await api('team', 'PUT', `/api/proposal-builder/${proposal.id}`, {
        title: 'Builder draft v2', lineItems: [{ description: 'Design', quantity: 2, unitPrice: 50 }], discount: 10,
      });
      assert.equal(edited.statusCode, 200, edited.body);
      assert.deepEqual([edited.json().proposal.subtotal, edited.json().proposal.total], [100, 90]);
      assert.equal(await raw.proposalLineItem.count({ where: { proposalId: proposal.id } }), 1);

      // There is no staff accept route; the invoice still requires approval.
      const accepted = await api('team', 'POST', `/api/proposal-builder/${proposal.id}/accept`);
      assert.equal(accepted.statusCode, 404, accepted.body);
      const invoiced = await api('team', 'POST', `/api/invoices/from-proposal/${proposal.id}`);
      assert.equal(invoiced.statusCode, 400, invoiced.body);

      // Once sent, the builder can no longer edit it (compare-and-set on DRAFT).
      await raw.proposal.update({ where: { id: proposal.id }, data: { status: 'SENT' } });
      const late = await api('team', 'PUT', `/api/proposal-builder/${proposal.id}`, { title: 'Too late' });
      assert.equal(late.statusCode, 409, late.body);
      stored = await raw.proposal.findUnique({ where: { id: proposal.id } });
      assert.deepEqual([stored.title, stored.status], ['Builder draft v2', 'SENT']);

      // Concurrent edits racing a send: every edit either lands while DRAFT or gets 409.
      await raw.proposal.update({ where: { id: proposal.id }, data: { status: 'DRAFT' } });
      const [sent, ...edits] = await Promise.all([
        raw.proposal.updateMany({ where: { id: proposal.id, status: 'DRAFT' }, data: { status: 'SENT' } }),
        ...Array.from({ length: 4 }, (_, i) => api('team', 'PUT', `/api/proposal-builder/${proposal.id}`, { title: `Race ${i}` })),
      ]);
      assert.equal(sent.count, 1);
      for (const response of edits) assert.ok([200, 409].includes(response.statusCode), response.body);
      assert.equal((await raw.proposal.findUnique({ where: { id: proposal.id } })).status, 'SENT');
    });

    await t.test('2. bulk void is admin-only, compare-and-set and audited', async () => {
      const open = await newInvoice({ status: 'SENT' });
      const paid = await newInvoice({ status: 'PAID' });

      const denied = await api('team', 'POST', '/api/invoices/bulk/archive', { ids: [open.id] });
      assert.equal(denied.statusCode, 403, denied.body);
      assert.equal((await raw.invoice.findUnique({ where: { id: open.id } })).status, 'SENT');

      const voided = await api('admin', 'POST', '/api/invoices/bulk/archive', { ids: [open.id, paid.id] });
      assert.equal(voided.statusCode, 200, voided.body);
      assert.deepEqual(voided.json(), { archived: 1, skipped: [{ id: paid.id, reason: 'paid' }] });
      const stored = await raw.invoice.findUnique({ where: { id: open.id } });
      assert.deepEqual([stored.status, stored.voidedFromStatus], ['VOID', 'SENT']);
      assert.equal((await raw.invoice.findUnique({ where: { id: paid.id } })).status, 'PAID');
      const audit = await raw.auditEvent.findMany({ where: { organizationId: orgA, action: 'invoice.voided', entityId: open.id } });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].actorUserId, adminId);
      assert.deepEqual(audit[0].metadata, { fromStatus: 'SENT', toStatus: 'VOID', total: 113, currency: 'CAD', bulk: true });

      const again = await api('admin', 'POST', '/api/invoices/bulk/archive', { ids: [open.id] });
      assert.deepEqual(again.json(), { archived: 0, skipped: [{ id: open.id, reason: 'void' }] });

      // An invoice with a recorded payment is never voided (single or bulk).
      const partlyPaid = await newInvoice({ status: 'SENT' });
      await raw.invoicePayment.create({ data: { invoiceId: partlyPaid.id, amount: 10, method: 'BANK' } });
      const single = await api('admin', 'DELETE', `/api/invoices/${partlyPaid.id}`);
      assert.equal(single.statusCode, 409, single.body);
      assert.equal(single.json().code, 'INVOICE_HAS_PAYMENTS');
      const bulk = await api('admin', 'POST', '/api/invoices/bulk/archive', { ids: [partlyPaid.id] });
      assert.deepEqual(bulk.json(), { archived: 0, skipped: [{ id: partlyPaid.id, reason: 'has_payments' }] });
      assert.equal((await raw.invoice.findUnique({ where: { id: partlyPaid.id } })).status, 'SENT');
    });

    await t.test('3. an estimate converts once into a proposal with matching money', async () => {
      const estimate = await raw.estimate.create({ data: {
        clientId: clientA, title: 'Website estimate', description: 'Scope', status: 'APPROVED',
        lineItems: ESTIMATE_LINES,
        ...computeEstimateTotals(ESTIMATE_LINES, { taxRate: 13 }), taxRate: 13,
      } });

      const results = await Promise.all([1, 2, 3].map(() => api('team', 'POST', `/api/estimates/${estimate.id}/convert`)));
      const ok = results.filter((response) => response.statusCode === 200);
      assert.equal(ok.length, 1, results.map((r) => `${r.statusCode} ${r.body}`).join('\n'));
      for (const response of results) assert.ok([200, 400, 409].includes(response.statusCode), response.body);

      const proposals = await raw.proposal.findMany({ where: { clientId: clientA, title: 'Website estimate' }, include: { lineItems: true } });
      assert.equal(proposals.length, 1);
      const [proposal] = proposals;
      assert.deepEqual(
        [proposal.status, proposal.createdById, proposal.notes, proposal.subtotal, proposal.total, proposal.lineItems.length],
        ['DRAFT', teamId, 'Scope', 250.5, 250.5, 2],
      );
      assert.equal(JSON.parse(proposal.metadata).taxRate, 13);
      assert.ok(proposal.validUntil > new Date(), 'the converted draft gets a future validity');
      assert.equal((await raw.estimate.findUnique({ where: { id: estimate.id } })).status, 'CONVERTED');

      // A converted (or draft) estimate cannot be converted again.
      const twice = await api('team', 'POST', `/api/estimates/${estimate.id}/convert`);
      assert.equal(twice.statusCode, 400, twice.body);

      // Approved and invoiced, the proposal bills the estimate's total.
      await raw.proposal.update({ where: { id: proposal.id }, data: { status: 'APPROVED' } });
      const invoice = await api('admin', 'POST', `/api/invoices/from-proposal/${proposal.id}`);
      assert.equal(invoice.statusCode, 200, invoice.body);
      const estimateTotals = computeEstimateTotals(ESTIMATE_LINES, { taxRate: 13 });
      assert.deepEqual([invoice.json().taxRate, invoice.json().tax, invoice.json().total], [13, estimateTotals.tax, estimateTotals.total]);
    });

    await t.test('4. recurring invoices get a next date and only issued invoices recur, once per occurrence', async () => {
      const created = await api('admin', 'POST', '/api/invoices', {
        clientId: clientA, isRecurring: true, recurringInterval: 'MONTHLY', issueDate: '2026-01-15',
        lineItems: [{ description: 'Care plan', quantity: 1, unitPrice: 100 }],
      });
      assert.equal(created.statusCode, 200, created.body);
      const nextDate = new Date(created.json().recurringNextDate);
      assert.ok(nextDate > new Date(), 'the first occurrence is in the future');
      assert.equal(nextDate.getUTCDate(), 15);

      const missingInterval = await api('admin', 'POST', '/api/invoices', {
        clientId: clientA, isRecurring: true, lineItems: [{ description: 'x', quantity: 1, unitPrice: 1 }],
      });
      assert.equal(missingInterval.statusCode, 400, missingInterval.body);

      const quarterly = await api('admin', 'PUT', `/api/invoices/${created.json().id}`, { recurringInterval: 'QUARTERLY' });
      assert.equal(quarterly.statusCode, 200, quarterly.body);
      assert.ok(new Date(quarterly.json().recurringNextDate) > new Date());
      const stopped = await api('admin', 'PUT', `/api/invoices/${created.json().id}`, { isRecurring: false });
      assert.equal(stopped.statusCode, 200, stopped.body);
      assert.deepEqual([stopped.json().isRecurring, stopped.json().recurringNextDate, stopped.json().recurringInterval], [false, null, null]);

      const due = new Date(Date.now() - 60_000);
      const sentSource = await newInvoice({ title: `Recurring sent ${suffix}`, isRecurring: true, recurringInterval: 'MONTHLY', recurringNextDate: due,
        lineItems: { create: [{ description: 'Care plan', quantity: 1, unitPrice: 100, total: 100 }] } });
      const draftSource = await newInvoice({ status: 'DRAFT', title: `Recurring draft ${suffix}`, isRecurring: true, recurringInterval: 'MONTHLY', recurringNextDate: due });

      const tenant = createScopedPrisma(raw, orgA);
      // Two workers at once: the loser either finds the occurrence claimed or
      // gets a serialization failure, which BullMQ retries; never a second copy.
      const runs = await Promise.allSettled([processRecurringInvoices(tenant), processRecurringInvoices(tenant)]);
      assert.ok(runs.some((run) => run.status === 'fulfilled'), runs.map((run) => run.reason?.message).join('\n'));
      for (const run of runs.filter((r) => r.status === 'rejected')) assert.match(run.reason.message, /Failed to process 1 recurring invoice/);
      const copies = await raw.invoice.findMany({ where: { clientId: clientA, title: `Recurring sent ${suffix}`, isRecurring: false } });
      assert.equal(copies.length, 1, 'one copy for one occurrence, even with two workers');
      assert.deepEqual([copies[0].status, copies[0].total], ['DRAFT', 113]);
      assert.equal(await raw.invoice.count({ where: { title: `Recurring draft ${suffix}`, isRecurring: false } }), 0, 'a draft never recurs');
      assert.ok((await raw.invoice.findUnique({ where: { id: sentSource.id } })).recurringNextDate > new Date());
      assert.equal((await raw.invoice.findUnique({ where: { id: draftSource.id } })).recurringNextDate.getTime(), due.getTime());

      // A retry of the same run finds nothing due.
      await processRecurringInvoices(tenant);
      assert.equal(await raw.invoice.count({ where: { clientId: clientA, title: `Recurring sent ${suffix}`, isRecurring: false } }), 1);

      // A source whose project is in the trash still recurs: the project is
      // still this organization's (the tenant check includes trashed rows).
      const trashedProject = await raw.project.create({ data: { name: 'Trashed', clientId: clientA, organizationId: orgA, deletedAt: new Date() } });
      await newInvoice({ title: `Recurring trashed ${suffix}`, projectId: trashedProject.id, isRecurring: true, recurringInterval: 'MONTHLY', recurringNextDate: due });
      await processRecurringInvoices(tenant);
      const trashedCopies = await raw.invoice.findMany({ where: { title: `Recurring trashed ${suffix}`, isRecurring: false } });
      assert.deepEqual(trashedCopies.map((copy) => copy.projectId), [trashedProject.id]);
      // ...while another organization's project is still refused.
      await assert.rejects(tenant.invoice.create({ data: { invoiceNumber: `X-${suffix}`, clientId: clientA, createdById: adminId, projectId: projectB } }), /does not belong/);

      // The release backfill (in the migration) gives issued recurring
      // invoices without a date the one firstRecurringDate computes.
      const migration = fs.readFileSync(new URL('../../../prisma/migrations/20261001180000_invoice_retainer_period/migration.sql', import.meta.url), 'utf8');
      const backfill = migration.slice(migration.indexOf('-- backfill:recurring-next-date:start'), migration.indexOf('-- backfill:recurring-next-date:end'));
      const fixtures = [
        ['MONTHLY', '2026-01-31T10:30:00.000Z', 'SENT'],
        ['QUARTERLY', '2025-11-30T00:00:00.000Z', 'PAID'],
        ['ANNUALLY', '2024-02-29T08:00:00.000Z', 'OVERDUE'],
        ['MONTHLY', '2026-01-15T00:00:00.000Z', 'DRAFT'],
      ];
      const legacy = [];
      for (const [interval, issueDate, status] of fixtures) {
        legacy.push(await newInvoice({ title: `Legacy ${suffix}`, status, isRecurring: true, recurringInterval: interval, issueDate: new Date(issueDate), recurringNextDate: null }));
      }
      await raw.$executeRawUnsafe(backfill);
      const backfilledAt = new Date();
      for (const [index, [interval, issueDate, status]] of fixtures.entries()) {
        const stored = await raw.invoice.findUnique({ where: { id: legacy[index].id } });
        if (status === 'DRAFT') {
          assert.equal(stored.recurringNextDate, null, 'drafts are left alone');
        } else {
          assert.equal(stored.recurringNextDate.toISOString(), firstRecurringDate(new Date(issueDate), interval, backfilledAt).toISOString(), interval);
        }
      }
      // A recurring draft the backfill skipped starts its schedule when sent.
      const legacyDraft = legacy[fixtures.length - 1];
      const sentDraft = await api('admin', 'POST', `/api/invoices/${legacyDraft.id}/send`, {});
      assert.equal(sentDraft.statusCode, 200, sentDraft.body);
      const afterSend = await raw.invoice.findUnique({ where: { id: legacyDraft.id } });
      assert.equal(afterSend.status, 'SENT');
      assert.equal(afterSend.recurringNextDate.toISOString(), firstRecurringDate(new Date('2026-01-15T00:00:00.000Z'), 'MONTHLY').toISOString());

      // Idempotent: a second run changes nothing.
      const before = await raw.invoice.findMany({ where: { title: `Legacy ${suffix}` }, orderBy: { id: 'asc' } });
      await raw.$executeRawUnsafe(backfill);
      const after = await raw.invoice.findMany({ where: { title: `Legacy ${suffix}` }, orderBy: { id: 'asc' } });
      assert.deepEqual(after.map((row) => row.recurringNextDate?.toISOString() ?? null), before.map((row) => row.recurringNextDate?.toISOString() ?? null));
    });

    await t.test('5. a partial payment keeps the invoice open; only the full balance marks it PAID', async () => {
      const statsBefore = (await api('team', 'GET', '/api/invoices/stats')).json();
      const dashboardBefore = (await api('admin', 'GET', '/api/dashboard/stats')).json();
      const invoice = await newInvoice({ status: 'SENT', stripeCheckoutSessionId: null, dueDate: new Date(Date.now() + 86_400_000) });

      const draft = await newInvoice({ status: 'DRAFT' });
      const draftPayment = await api('team', 'POST', `/api/invoices/${draft.id}/mark-paid`, { amount: 10, paymentMethod: 'BANK' });
      assert.equal(draftPayment.statusCode, 400, draftPayment.body);
      assert.equal(draftPayment.json().code, 'INVOICE_NOT_SENT');
      const zero = await api('team', 'POST', `/api/invoices/${invoice.id}/mark-paid`, { amount: 0, paymentMethod: 'BANK' });
      assert.equal(zero.statusCode, 400, zero.body);

      const partial = await api('team', 'POST', `/api/invoices/${invoice.id}/mark-paid`, { amount: 50, paymentMethod: 'BANK' });
      assert.equal(partial.statusCode, 200, partial.body);
      assert.deepEqual([partial.json().status, partial.json().amountPaid, partial.json().balanceDue], ['SENT', 50, 63]);

      const over = await api('team', 'POST', `/api/invoices/${invoice.id}/mark-paid`, { amount: 63.01, paymentMethod: 'BANK' });
      assert.equal(over.statusCode, 400, over.body);
      assert.equal(over.json().code, 'PAYMENT_EXCEEDS_BALANCE');

      const detail = await api('team', 'GET', `/api/invoices/${invoice.id}`);
      assert.deepEqual([detail.json().status, detail.json().amountPaid, detail.json().balanceDue], ['SENT', 50, 63]);
      const listed = (await api('team', 'GET', '/api/invoices')).json().invoices.find((row) => row.id === invoice.id);
      assert.deepEqual([listed.amountPaid, listed.balanceDue], [50, 63]);

      // Outstanding money is the balance: the new invoice adds 63, not 113.
      const statsAfter = (await api('team', 'GET', '/api/invoices/stats')).json();
      assert.equal(Math.round((statsAfter.sent.amount - statsBefore.sent.amount) * 100) / 100, 63);
      assert.equal(Math.round((statsAfter.totalOutstanding - statsBefore.totalOutstanding) * 100) / 100, 63);
      const dashboardAfter = (await api('admin', 'GET', '/api/dashboard/stats')).json();
      assert.equal(Math.round((dashboardAfter.totalOutstanding - dashboardBefore.totalOutstanding) * 100) / 100, 63);

      // Concurrent payments of the rest: exactly one lands, nothing is overpaid.
      const rest = await Promise.all([1, 2, 3].map(() => api('team', 'POST', `/api/invoices/${invoice.id}/mark-paid`, { amount: 63, paymentMethod: 'BANK' })));
      assert.equal(rest.filter((response) => response.statusCode === 200).length, 1, rest.map((r) => r.body).join('\n'));
      const stored = await raw.invoice.findUnique({ where: { id: invoice.id }, include: { payments: true } });
      assert.equal(stored.status, 'PAID');
      assert.equal(stored.payments.reduce((sum, payment) => sum + payment.amount, 0), 113);
      assert.equal(await raw.domainEvent.count({ where: { aggregateId: invoice.id, type: 'invoice.paid' } }), 1);

      // Stripe charges (and must match) the remaining balance.
      const stripeInvoice = await newInvoice({ status: 'SENT' });
      await raw.invoicePayment.create({ data: { invoiceId: stripeInvoice.id, amount: 13, method: 'BANK' } });
      const event = (amountTotal, id) => ({
        id, created: Math.floor(Date.now() / 1000),
        data: { object: {
          id: `cs_${id}`, payment_intent: `pi_${id}`, payment_status: 'paid', amount_total: amountTotal, currency: 'cad',
          metadata: { invoiceId: stripeInvoice.id, invoiceNumber: stripeInvoice.invoiceNumber },
        } },
      });
      // A session priced at the old total (before the manual 13) charges more
      // than is owed: refused with its own alerting code, nothing recorded.
      await assert.rejects(recordCompletedCheckout(raw, event(11300, `full_${suffix}`)), { code: 'CHECKOUT_BALANCE_CHANGED' });
      assert.equal((await raw.invoice.findUnique({ where: { id: stripeInvoice.id } })).status, 'SENT');
      // A stale session smaller than the balance is a partial payment.
      const stalePartial = await recordCompletedCheckout(raw, event(4000, `partial_${suffix}`));
      assert.deepEqual([stalePartial.duplicate, stalePartial.fullyPaid], [false, false]);
      assert.equal((await raw.invoice.findUnique({ where: { id: stripeInvoice.id } })).status, 'SENT');
      assert.equal(await raw.domainEvent.count({ where: { aggregateId: stripeInvoice.id, type: 'invoice.paid' } }), 0);
      const settled = await recordCompletedCheckout(raw, event(6000, `rest_${suffix}`));
      assert.deepEqual([settled.duplicate, settled.fullyPaid], [false, true]);
      const afterStripe = await raw.invoice.findUnique({ where: { id: stripeInvoice.id }, include: { payments: true } });
      assert.equal(afterStripe.status, 'PAID');
      assert.deepEqual(afterStripe.payments.map((payment) => payment.amount).sort((a, b) => a - b), [13, 40, 60]);
      assert.equal(await raw.domainEvent.count({ where: { aggregateId: stripeInvoice.id, type: 'invoice.paid' } }), 1);

      // Manual full payment, then the stale full-price session: already paid.
      const manualFirst = await newInvoice({ status: 'SENT' });
      const manualPaid = await api('team', 'POST', `/api/invoices/${manualFirst.id}/mark-paid`, { amount: 113, paymentMethod: 'BANK' });
      assert.equal(manualPaid.json().status, 'PAID');
      await assert.rejects(recordCompletedCheckout(raw, {
        id: `late_${suffix}`, created: Math.floor(Date.now() / 1000),
        data: { object: {
          id: `cs_late_${suffix}`, payment_intent: `pi_late_${suffix}`, payment_status: 'paid', amount_total: 11300, currency: 'cad',
          metadata: { invoiceId: manualFirst.id, invoiceNumber: manualFirst.invoiceNumber },
        } },
      }), { code: 'INVOICE_ALREADY_PAID' });
      assert.equal(await raw.invoicePayment.count({ where: { invoiceId: manualFirst.id } }), 1);

      // Refused charges are kept in the audit log (payment.refused).
      await recordRefusedCheckout(raw, { id: `req-refused-${suffix}` }, {
        id: `late_${suffix}`,
        data: { object: { id: `cs_late_${suffix}`, payment_intent: `pi_late_${suffix}`, amount_total: 11300, currency: 'cad', metadata: { invoiceId: manualFirst.id } } },
      }, { code: 'INVOICE_ALREADY_PAID' });
      const refused = await raw.auditEvent.findMany({ where: { organizationId: orgA, action: 'payment.refused', entityId: manualFirst.id } });
      assert.equal(refused.length, 1);
      assert.deepEqual(refused[0].metadata, { code: 'INVOICE_ALREADY_PAID', amount: 113, currency: 'cad', stripeEventId: `late_${suffix}`, transactionId: `pi_late_${suffix}` });

      // Three concurrent deliveries of one full-payment event: one records
      // the payment, two are duplicates; none is refused (so none alerts).
      const replayed = await newInvoice({ status: 'SENT' });
      const replayEvent = {
        id: `replay_${suffix}`, created: Math.floor(Date.now() / 1000),
        data: { object: {
          id: `cs_replay_${suffix}`, payment_intent: `pi_replay_${suffix}`, payment_status: 'paid', amount_total: 11300, currency: 'cad',
          metadata: { invoiceId: replayed.id, invoiceNumber: replayed.invoiceNumber },
        } },
      };
      const deliveries = await Promise.allSettled([1, 2, 3].map(() => recordCompletedCheckout(raw, replayEvent)));
      const alerts = [];
      for (const delivery of deliveries.filter((d) => d.status === 'rejected')) {
        handleCheckoutFailure(delivery.reason, { event: replayEvent, route: 'test', log: { warn: () => {}, error: () => {} }, alert: async (a) => { alerts.push(a.event); } });
      }
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(deliveries.map((d) => d.status), ['fulfilled', 'fulfilled', 'fulfilled'], deliveries.map((d) => d.reason?.message).join('\n'));
      assert.deepEqual(deliveries.map((d) => d.value.duplicate).sort(), [false, true, true]);
      assert.deepEqual(alerts, []);
      assert.equal(await raw.invoicePayment.count({ where: { invoiceId: replayed.id } }), 1);
      assert.equal(await raw.domainEvent.count({ where: { aggregateId: replayed.id, type: 'invoice.paid' } }), 1);
    });

    await t.test('6. a retainer month is invoiced once and the hours reset with it', async () => {
      await raw.retainerPlan.create({ data: { clientId: clientA, tier: 'STANDARD', hoursPerMonth: 40, hoursUsed: 12, monthlyAmountCad: 2000 } });
      const period = retainerBillingPeriod(new Date());

      const results = await Promise.all([1, 2, 3].map(() => api('admin', 'POST', `/api/retainers/${clientA}/generate-invoice`, { resetHours: true })));
      const ok = results.filter((response) => response.statusCode === 200);
      assert.equal(ok.length, 1, results.map((r) => `${r.statusCode} ${r.body}`).join('\n'));
      for (const response of results.filter((r) => r.statusCode !== 200)) {
        assert.equal(response.statusCode, 409, response.body);
        assert.equal(response.json().code, 'RETAINER_PERIOD_ALREADY_INVOICED');
      }
      const invoices = await raw.invoice.findMany({ where: { clientId: clientA, retainerPeriod: period } });
      assert.equal(invoices.length, 1);
      assert.equal((await raw.retainerPlan.findUnique({ where: { clientId: clientA } })).hoursUsed, 0);

      // A voided month can be billed again; the voided one cannot come back.
      const voided = await api('admin', 'DELETE', `/api/invoices/${invoices[0].id}`);
      assert.equal(voided.statusCode, 200, voided.body);
      const again = await api('admin', 'POST', `/api/retainers/${clientA}/generate-invoice`, {});
      assert.equal(again.statusCode, 200, again.body);
      const undo = await api('admin', 'POST', `/api/invoices/${invoices[0].id}/undo-void`);
      assert.equal(undo.statusCode, 409, undo.body);

      // Staff can name the month explicitly; it is guarded the same way.
      const explicit = await api('admin', 'POST', `/api/retainers/${clientA}/generate-invoice`, { period: '2020-01' });
      assert.equal(explicit.statusCode, 200, explicit.body);
      assert.deepEqual([explicit.json().period, explicit.json().invoice.retainerPeriod], ['2020-01', '2020-01']);
      assert.match(explicit.json().invoice.title, /January 2020/);
      const explicitAgain = await api('admin', 'POST', `/api/retainers/${clientA}/generate-invoice`, { period: '2020-01' });
      assert.equal(explicitAgain.statusCode, 409, explicitAgain.body);
    });

    await t.test('7. an invoice cannot reference another organization\'s project', async () => {
      const foreign = await api('admin', 'POST', '/api/invoices', {
        clientId: clientA, projectId: projectB, lineItems: [{ description: 'x', quantity: 1, unitPrice: 1 }],
      });
      assert.equal(foreign.statusCode, 404, foreign.body);
      const own = await api('admin', 'POST', '/api/invoices', {
        clientId: clientA, projectId: projectA, lineItems: [{ description: 'x', quantity: 1, unitPrice: 1 }],
      });
      assert.equal(own.statusCode, 200, own.body);
      const moved = await api('admin', 'PUT', `/api/invoices/${own.json().id}`, { projectId: projectB });
      assert.equal(moved.statusCode, 404, moved.body);
      assert.equal((await raw.invoice.findUnique({ where: { id: own.json().id } })).projectId, projectA);
    });

    await t.test('8. a decline never overwrites an approval (and the reverse)', async () => {
      for (const route of ['portal', 'proposals']) {
        const access = createPublicAccessWindow();
        const proposal = await raw.proposal.create({ data: {
          title: `Race ${route}`, clientId: clientA, createdById: adminId, status: 'SENT', total: 100,
          viewToken: access.token, publicAccessExpiresAt: access.expiresAt,
        } });
        const approveUrl = route === 'portal' ? `/api/portal/proposal/${access.token}/approve` : `/api/proposals/client/${access.token}/approve`;
        const declineUrl = route === 'portal' ? `/api/portal/proposal/${access.token}/decline` : `/api/proposals/client/${access.token}/decline`;
        const [approve, decline] = await Promise.all([
          api(null, 'POST', approveUrl, {}),
          api(null, 'POST', declineUrl, {}),
        ]);
        const winners = [approve, decline].filter((response) => response.statusCode === 200);
        assert.equal(winners.length, 1, `${route}: ${approve.statusCode} ${approve.body} / ${decline.statusCode} ${decline.body}`);
        const stored = await raw.proposal.findUnique({ where: { id: proposal.id } });
        assert.equal(stored.status, approve.statusCode === 200 ? 'APPROVED' : 'DECLINED', route);
        if (stored.status === 'APPROVED') assert.equal(stored.declinedAt, null);
      }

      // A decline after an approval is refused even with an open link.
      const access = createPublicAccessWindow();
      const approved = await raw.proposal.create({ data: {
        title: 'Approved already', clientId: clientA, createdById: adminId, status: 'APPROVED', total: 100,
        viewToken: access.token, publicAccessExpiresAt: access.expiresAt,
      } });
      const late = await api(null, 'POST', `/api/proposals/client/${access.token}/decline`, {});
      assert.equal(late.statusCode, 409, late.body);
      assert.equal((await raw.proposal.findUnique({ where: { id: approved.id } })).status, 'APPROVED');
    });

    await t.test('9. the invoice list sort is allowlisted', async () => {
      const bogus = await api('team', 'GET', '/api/invoices?sort=client&order=sideways');
      assert.equal(bogus.statusCode, 200, bogus.body);
      const injected = await api('team', 'GET', '/api/invoices?sort=__proto__&order=desc');
      assert.equal(injected.statusCode, 200, injected.body);
      const byTotal = await api('team', 'GET', '/api/invoices?sort=total&order=asc');
      assert.equal(byTotal.statusCode, 200, byTotal.body);
      const totals = byTotal.json().invoices.map((invoice) => invoice.total);
      assert.deepEqual(totals, [...totals].sort((a, b) => a - b));
    });

    await t.test('10. a sent estimate converts to a proposal that shows the tax its invoice bills', async () => {
      const created = await api('team', 'POST', '/api/estimates', {
        clientId: clientA, title: 'Tax estimate', taxRate: 5,
        lineItems: [{ description: 'Website', quantity: 1, rate: 1500 }],
      });
      assert.equal(created.statusCode, 201, created.body);
      assert.deepEqual([created.json().subtotal, created.json().tax, created.json().total], [1500, 75, 1575]);

      // Client A has no email address: the estimate is sent (and its link
      // works) but the response says no email went out.
      const sent = await api('team', 'POST', `/api/estimates/${created.json().id}/send`);
      assert.equal(sent.statusCode, 200, sent.body);
      assert.equal(sent.json().status, 'SENT');
      assert.equal(sent.json().emailSent, false);
      assert.equal(sent.json().emailStatus, 'NO_CLIENT_EMAIL');
      assert.ok(sent.json().clientLink.endsWith(`/portal/estimate/${sent.json().viewToken}`));

      // Staff can convert a sent estimate the client has not answered.
      const converted = await api('team', 'POST', `/api/estimates/${created.json().id}/convert`);
      assert.equal(converted.statusCode, 200, converted.body);
      const proposalId = converted.json().proposal.id;
      assert.equal((await raw.estimate.findUnique({ where: { id: created.json().id } })).status, 'CONVERTED');

      const staffView = (await api('team', 'GET', `/api/proposals/${proposalId}`)).json();
      assert.deepEqual(
        [staffView.total, staffView.taxRate, staffView.taxType, staffView.tax, staffView.totalWithTax],
        [1500, 5, 'TAX', 75, 1575],
      );

      // The client's proposal page shows the tax and the total they will be billed.
      const access = createPublicAccessWindow();
      await raw.proposal.update({ where: { id: proposalId }, data: {
        status: 'SENT', viewToken: access.token, publicAccessExpiresAt: access.expiresAt, publicAccessRevokedAt: null,
      } });
      const portalView = await api(null, 'GET', `/api/portal/proposal/${access.token}`);
      assert.equal(portalView.statusCode, 200, portalView.body);
      assert.deepEqual([portalView.json().tax, portalView.json().totalWithTax], [75, 1575]);
      assert.equal('metadata' in portalView.json(), false, 'proposal metadata stays private');
      const legacyView = await api(null, 'GET', `/api/proposals/client/${access.token}`);
      assert.equal(legacyView.statusCode, 200, legacyView.body);
      assert.deepEqual([legacyView.json().tax, legacyView.json().totalWithTax], [75, 1575]);
      assert.equal('metadata' in legacyView.json(), false);
      // The public link shows the client's name and email, never the Client row.
      assert.deepEqual(Object.keys(legacyView.json().client).sort(), ['email', 'id', 'name']);
      assert.equal('internalNotes' in legacyView.json(), false);

      // The invoice bills exactly what the client approved, labelled "Tax".
      await raw.proposal.update({ where: { id: proposalId }, data: { status: 'APPROVED' } });
      const invoice = await api('admin', 'POST', `/api/invoices/from-proposal/${proposalId}`);
      assert.equal(invoice.statusCode, 200, invoice.body);
      assert.deepEqual(
        [invoice.json().taxRate, invoice.json().taxType, invoice.json().tax, invoice.json().total],
        [5, 'TAX', 75, portalView.json().totalWithTax],
      );

      // Half-cent tax: estimate, proposal and invoice agree to the cent.
      for (const [rate, expected] of [[1000.5, 1130.57], [4.5, 5.09]]) {
        const halfCent = await api('team', 'POST', '/api/estimates', {
          clientId: clientA, title: `Half cent ${rate}`, taxRate: 13, lineItems: [{ description: 'Work', quantity: 1, rate }],
        });
        assert.equal(halfCent.json().total, expected, halfCent.body);
        await api('team', 'POST', `/api/estimates/${halfCent.json().id}/send`);
        const halfProposal = (await api('team', 'POST', `/api/estimates/${halfCent.json().id}/convert`)).json().proposal;
        assert.equal((await api('team', 'GET', `/api/proposals/${halfProposal.id}`)).json().totalWithTax, expected);
        await raw.proposal.update({ where: { id: halfProposal.id }, data: { status: 'APPROVED' } });
        const halfInvoice = await api('admin', 'POST', `/api/invoices/from-proposal/${halfProposal.id}`);
        assert.equal(halfInvoice.json().total, expected, halfInvoice.body);
      }
    });

    await t.test('11. the client page counts what is still owed, after payments, on every open invoice', async () => {
      const clientC = `money-client-c-${suffix}`;
      await raw.client.create({ data: { id: clientC, name: 'Client C', organizationId: orgA } });
      const owed = (data) => newInvoice({ clientId: clientC, currency: 'CAD', ...data });
      const partlyPaid = await owed({ status: 'SENT', subtotal: 1000, tax: 130, total: 1130 });
      await raw.invoicePayment.create({ data: { invoiceId: partlyPaid.id, amount: 300, method: 'BANK' } });
      await owed({ status: 'OVERDUE', total: 200 });
      await owed({ status: 'VIEWED', total: 50, dueDate: new Date(Date.now() + 86_400_000) });
      await owed({ status: 'PAID', total: 500 });
      await owed({ status: 'DRAFT', total: 999 });
      await owed({ status: 'VOID', total: 777 });

      const response = await api('admin', 'GET', `/api/clients/${clientC}`);
      assert.equal(response.statusCode, 200, response.body);
      const client = response.json();
      assert.equal(client.outstandingBalance, 830 + 200 + 50, 'balances of SENT, OVERDUE and VIEWED invoices');
      assert.equal(client.outstandingCurrency, 'CAD');
      assert.deepEqual(client.outstandingByCurrency, { CAD: 1080 });
      assert.equal(client.totalRevenue, 500);
      const row = client.invoices.find((invoice) => invoice.id === partlyPaid.id);
      assert.deepEqual([row.amountPaid, row.balanceDue], [300, 830]);
      assert.equal('payments' in row, false, 'the page gets the balance, not the payment rows');

      // A second currency is never added to the first.
      await owed({ status: 'SENT', total: 100, currency: 'USD' });
      const mixed = (await api('admin', 'GET', `/api/clients/${clientC}`)).json();
      assert.equal(mixed.outstandingBalance, null);
      assert.deepEqual(mixed.outstandingByCurrency, { CAD: 1080, USD: 100 });
    });

    await t.test('12. MRR is reported in each retainer\'s own currency', async () => {
      // Subtest 6 gave client A a CAD-only retainer of 2,000.
      const cadOnly = (await api('admin', 'GET', '/api/dashboard/stats')).json();
      assert.deepEqual([cadOnly.mrr, cadOnly.mrrCurrency], [2000, 'CAD']);
      assert.deepEqual(cadOnly.mrrByCurrency, { CAD: 2000 });

      const clientD = `money-client-d-${suffix}`;
      await raw.client.create({ data: { id: clientD, name: 'Client D', organizationId: orgA } });
      await raw.retainerPlan.create({ data: { clientId: clientD, tier: 'STANDARD', hoursPerMonth: 10, monthlyAmountUsd: 999 } });
      const mixed = (await api('admin', 'GET', '/api/dashboard/stats')).json();
      assert.deepEqual([mixed.mrr, mixed.mrrCurrency], [null, null]);
      assert.deepEqual(mixed.mrrByCurrency, { CAD: 2000, USD: 999 });
      assert.equal(mixed.activeRetainerCount, 2);
    });
  } finally {
    await app?.close();
    if (await purgeFixtureAuditEvents(raw, { ids: [orgA, orgB] })) {
      // Domain events and other fixture rows go with the organizations when
      // the database allows it; the database is disposable either way.
      await raw.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRawUnsafe('DELETE FROM "domain_events" WHERE "organizationId" = ANY($1::text[])', [orgA, orgB]);
      }).catch(() => null);
      await raw.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } }).catch(() => null);
      await raw.$executeRawUnsafe('DELETE FROM "document_number_sequences" WHERE "organizationId" = ANY($1::text[])', [orgA, orgB]).catch(() => null);
      await raw.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } }).catch(() => null);
      await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }).catch(() => null);
    }
    await raw.$disconnect();
  }
});
