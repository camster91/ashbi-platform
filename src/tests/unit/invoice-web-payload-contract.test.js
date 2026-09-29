// Web payload → API contract for invoices (C1). The staff UI builds its
// create/edit payloads from <input type="date"> values ("YYYY-MM-DD"), an
// optional title and the line-item editor; those exact payloads must be
// accepted by the API validators and routes.
import assert from 'node:assert/strict';
import test from 'node:test';
import invoiceRoutes from '../../routes/invoice.routes.js';
import { createInvoiceSchema, updateInvoiceSchema } from '../../validators/schemas.js';
import { createFakeInvoiceDb, buildInvoiceApp } from '../helpers/fake-invoice-db.js';
import { buildInvoiceCreatePayload, buildInvoiceUpdatePayload, INVOICE_CURRENCY_OPTIONS } from '../../../web/src/lib/invoice-payloads.js';

// Exactly what Invoices.jsx submitted for a new invoice with no title, a
// due date picked from the date input and a "Custom" line item.
const UI_CREATE_PAYLOAD = {
  clientId: 'client-a',
  dueDate: '2026-10-11',
  taxRate: 13,
  taxType: 'HST',
  discountAmount: 0,
  isRecurring: false,
  lineItems: [
    { description: 'Design sprint', itemType: 'LABOR', quantity: 1, unitPrice: 250 },
    { description: 'Hosting setup', itemType: 'CUSTOM', quantity: 1, unitPrice: 50 },
  ],
};

// Exactly what InvoiceDetail.jsx submitted when saving an edited draft.
const UI_UPDATE_PAYLOAD = {
  title: 'Website retainer',
  notes: 'Net 15',
  dueDate: '2026-10-11',
  taxRate: 13,
  taxType: 'HST',
  discountAmount: 0,
  lineItems: [{ description: 'Design sprint', itemType: 'LABOR', quantity: 2, unitPrice: 250, position: 0 }],
};

const DUE_END_OF_DAY_UTC = '2026-10-11T23:59:59.999Z';

function fakeDb(extra = {}) {
  return createFakeInvoiceDb({
    clients: [{ id: 'client-a', name: 'Northwind Studio' }],
    ...extra,
  });
}

test('the create payload the UI sends is accepted and stores the due date at the end of that day (UTC)', async (t) => {
  const db = fakeDb();
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const response = await app.inject({ method: 'POST', url: '/', payload: UI_CREATE_PAYLOAD });
  assert.equal(response.statusCode, 200, response.body);
  const [stored] = db.state.invoices;
  assert.equal(new Date(stored.dueDate).toISOString(), DUE_END_OF_DAY_UTC);
  assert.equal(stored.title, 'Invoice for Northwind Studio', 'a missing title gets a derived default');
  assert.equal(stored.lineItems.length, 2);
});

test('the UI may leave the due date empty ("upon receipt")', async (t) => {
  const db = fakeDb();
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const { dueDate, ...withoutDue } = UI_CREATE_PAYLOAD;
  const response = await app.inject({ method: 'POST', url: '/', payload: withoutDue });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(db.state.invoices[0].dueDate, null);
  const explicitNull = await app.inject({ method: 'POST', url: '/', payload: { ...withoutDue, dueDate: null } });
  assert.equal(explicitNull.statusCode, 200, explicitNull.body);
});

test('the edit payload the UI sends is accepted, and clearing the due date stores "upon receipt"', async (t) => {
  const db = fakeDb({ invoices: [{ id: 'invoice-a', clientId: 'client-a', status: 'DRAFT', invoiceNumber: 'INV-2026-0001', taxRate: 13, discountAmount: 0, total: 0 }] });
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const response = await app.inject({ method: 'PUT', url: '/invoice-a', payload: UI_UPDATE_PAYLOAD });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(new Date(db.state.invoices[0].dueDate).toISOString(), DUE_END_OF_DAY_UTC);

  const cleared = await app.inject({ method: 'PUT', url: '/invoice-a', payload: { ...UI_UPDATE_PAYLOAD, dueDate: null } });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(db.state.invoices[0].dueDate, null);
});

test('full ISO datetimes stay accepted and invalid dates are rejected', () => {
  const iso = createInvoiceSchema.parse({ ...UI_CREATE_PAYLOAD, dueDate: '2027-04-30T23:59:59.000Z' });
  assert.equal(new Date(iso.dueDate).toISOString(), '2027-04-30T23:59:59.000Z');
  assert.equal(createInvoiceSchema.safeParse({ ...UI_CREATE_PAYLOAD, dueDate: '2026-02-30' }).success, false);
  assert.equal(createInvoiceSchema.safeParse({ ...UI_CREATE_PAYLOAD, dueDate: 'next tuesday' }).success, false);
  assert.equal(updateInvoiceSchema.safeParse({ dueDate: '2026-13-01' }).success, false);
  const issue = createInvoiceSchema.parse({ ...UI_CREATE_PAYLOAD, issueDate: '2026-10-01' });
  assert.equal(new Date(issue.issueDate).toISOString(), '2026-10-01T00:00:00.000Z');
});

test('the shared web payload builders produce payloads the API validators accept', () => {
  const form = {
    clientId: 'client-a', projectId: '', title: '', notes: '', dueDate: '2026-10-11', currency: 'USD',
    taxRate: '13', taxType: 'HST', discountAmount: '', isRecurring: false, recurringInterval: 'MONTHLY',
    lineItems: [{ description: 'Design sprint', itemType: 'CUSTOM', quantity: '2', unitPrice: '99.5' }],
  };
  const create = buildInvoiceCreatePayload(form);
  const parsedCreate = createInvoiceSchema.safeParse(create);
  assert.equal(parsedCreate.success, true, JSON.stringify(parsedCreate.error?.errors));
  assert.equal(parsedCreate.data.currency, 'USD');

  const blankTax = createInvoiceSchema.safeParse(buildInvoiceCreatePayload({ ...form, taxRate: '' }));
  assert.equal(blankTax.success, true, 'a cleared tax rate must not serialize as null');

  const update = buildInvoiceUpdatePayload({ ...form, internalNotes: '', dueDate: '' });
  assert.equal(update.dueDate, null, 'clearing the date input sends null ("upon receipt")');
  const parsedUpdate = updateInvoiceSchema.safeParse(update);
  assert.equal(parsedUpdate.success, true, JSON.stringify(parsedUpdate.error?.errors));

  for (const currency of INVOICE_CURRENCY_OPTIONS) {
    assert.equal(createInvoiceSchema.safeParse({ ...create, currency }).success, true, currency);
  }
});
