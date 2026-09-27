// Invoice currency (C3): the stored currency is persisted, defaults to CAD,
// and is what every client-facing rendering (PDF, emails) shows.
import assert from 'node:assert/strict';
import test from 'node:test';
import invoiceRoutes from '../../routes/invoice.routes.js';
import { buildInvoiceDeliveryEmail, buildInvoiceOverdueEmail } from '../../services/email.service.js';
import { generateInvoicePdf } from '../../utils/generate-invoice-pdf.js';
import { DEFAULT_INVOICE_CURRENCY, formatMoney } from '../../utils/money.js';
import { findInvoiceCurrencyMismatches } from '../../services/invoice-currency-audit.service.js';
import { createFakeInvoiceDb, buildInvoiceApp } from '../helpers/fake-invoice-db.js';

const PAYLOAD = {
  clientId: 'client-a',
  lineItems: [{ description: 'Retainer', quantity: 1, unitPrice: 1000 }],
};

function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  return [...raw.matchAll(/<([0-9a-f]+)>/g)]
    .map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1'))
    .join('');
}

test('new invoices persist the requested currency and default to CAD', async (t) => {
  const db = createFakeInvoiceDb({ clients: [{ id: 'client-a', name: 'Client A' }] });
  const app = await buildInvoiceApp(t, invoiceRoutes, db);

  const usd = await app.inject({ method: 'POST', url: '/', payload: { ...PAYLOAD, currency: 'usd' } });
  assert.equal(usd.statusCode, 200, usd.body);
  assert.equal(db.state.invoices[0].currency, 'USD');

  const defaulted = await app.inject({ method: 'POST', url: '/', payload: PAYLOAD });
  assert.equal(defaulted.statusCode, 200, defaulted.body);
  assert.equal(DEFAULT_INVOICE_CURRENCY, 'CAD');
  assert.equal(db.state.invoices[1].currency, 'CAD');

  const unsupported = await app.inject({ method: 'POST', url: '/', payload: { ...PAYLOAD, currency: 'XYZ' } });
  assert.equal(unsupported.statusCode, 400);
});

test('editing a draft can change its currency', async (t) => {
  const db = createFakeInvoiceDb({
    clients: [{ id: 'client-a', name: 'Client A' }],
    invoices: [{ id: 'invoice-a', clientId: 'client-a', status: 'DRAFT', currency: 'CAD', invoiceNumber: 'INV-2026-0001', taxRate: 13, discountAmount: 0 }],
  });
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const response = await app.inject({ method: 'PUT', url: '/invoice-a', payload: { currency: 'EUR' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(db.state.invoices[0].currency, 'EUR');
});

test('invoice emails render the invoice currency', () => {
  const usd = buildInvoiceDeliveryEmail({
    to: 'client@example.test', invoiceNumber: 'INV-1', total: 1250, currency: 'USD',
    viewUrl: 'https://hub.example.test/portal/invoice/token',
  });
  assert.equal(usd.variables.amount, '$1,250.00 USD');
  const fallback = buildInvoiceDeliveryEmail({ to: 'c@example.test', invoiceNumber: 'INV-2', total: 5, viewUrl: 'https://x.test' });
  assert.equal(fallback.variables.amount, '$5.00 CAD');

  const overdue = buildInvoiceOverdueEmail({
    to: 'client@example.test', clientName: 'Avery', invoiceNumber: 'INV-3', total: 99.5, currency: 'GBP', daysOverdue: 3,
    viewUrl: 'https://hub.example.test/portal/invoice/token',
  });
  assert.equal(overdue.template, 'invoice-overdue.html');
  assert.equal(overdue.variables.amount, '£99.50 GBP');
});

test('the invoice PDF renders amounts in the invoice currency, never a hard-coded CAD', async () => {
  const invoice = {
    invoiceNumber: 'INV-2026-0007', status: 'SENT', currency: 'USD',
    issueDate: new Date('2026-09-01T00:00:00Z'), dueDate: new Date('2026-09-30T23:59:59.999Z'),
    subtotal: 2500, discountAmount: 0, taxRate: 13, taxType: 'HST', tax: 325, total: 2825,
    client: { name: 'Client A' }, lineItems: [{ description: 'Build', quantity: 1, unitPrice: 2500, total: 2500 }], payments: [],
  };
  const text = pdfText(await generateInvoicePdf(invoice, { compress: false }));
  assert.ok(text.includes(formatMoney(2825, 'USD')), 'total is shown in USD');
  assert.ok(!text.includes('CAD'), 'no CAD label on a USD invoice');
  assert.ok(text.includes('September 30, 2026'), 'the due date is the chosen calendar day');
});

test('the currency audit reports suspected mismatches without deciding for the owner', () => {
  const findings = findInvoiceCurrencyMismatches([
    { id: 'a', invoiceNumber: 'INV-1', currency: 'USD', taxType: 'HST', bonsaiInvoiceId: null, status: 'SENT', stripeCheckoutCurrency: null },
    { id: 'b', invoiceNumber: 'INV-2', currency: 'CAD', taxType: 'HST', bonsaiInvoiceId: null, status: 'SENT', stripeCheckoutCurrency: 'usd' },
    { id: 'c', invoiceNumber: 'INV-3', currency: 'USD', taxType: 'NONE', bonsaiInvoiceId: 'bonsai-1', status: 'PAID', stripeCheckoutCurrency: null },
    { id: 'd', invoiceNumber: 'INV-4', currency: 'CAD', taxType: 'HST', bonsaiInvoiceId: null, status: 'DRAFT', stripeCheckoutCurrency: null },
  ]);
  assert.deepEqual(findings.map((finding) => [finding.id, finding.reason]), [
    ['a', 'CANADIAN_TAX_ON_USD_INVOICE'],
    ['b', 'CHECKOUT_CURRENCY_DIFFERS'],
  ]);
});
