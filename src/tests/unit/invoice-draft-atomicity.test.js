import test from 'node:test';
import assert from 'node:assert/strict';
import invoiceRoutes from '../../routes/invoice.routes.js';
import { createFakeInvoiceDb, buildInvoiceApp } from '../helpers/fake-invoice-db.js';

function fixture() {
  const db = createFakeInvoiceDb({ clients: [{ id: 'client', name: 'Client' }], invoices: [{
    id: 'invoice', clientId: 'client', status: 'DRAFT', title: 'Original', subtotal: 100, taxRate: 13, tax: 13, total: 113,
    discountAmount: 0, lineItems: [{ description: 'Original work', quantity: 1, unitPrice: 100, total: 100, position: 0 }],
  }] });
  const transaction = db.$transaction;
  db.$transaction = async (work, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    const before = structuredClone(db.state);
    try { return await transaction(work); }
    catch (error) { Object.assign(db.state, before); throw error; }
  };
  db.invoiceLineItem.deleteMany = async () => { db.state.invoices[0].lineItems = []; return { count: 1 }; };
  db.invoiceLineItem.createMany = async ({ data }) => { db.state.invoices[0].lineItems = structuredClone(data); return { count: data.length }; };
  return db;
}
const payload = { title: 'Edited', lineItems: [{ description: 'Replacement work', quantity: 2, unitPrice: 50 }], taxRate: 0 };

test('failed draft line insertion retains original lines and header', async t => {
  const db = fixture(), before = structuredClone(db.state.invoices[0]);
  db.invoiceLineItem.createMany = async () => { throw new Error('Storage unavailable'); };
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const response = await app.inject({ method: 'PUT', url: '/invoice', payload });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(db.state.invoices[0], before);
});

test('failed draft header persistence rolls back replacement lines', async t => {
  const db = fixture(), before = structuredClone(db.state.invoices[0]);
  db.invoice.update = async () => { throw new Error('Write refused'); };
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const response = await app.inject({ method: 'PUT', url: '/invoice', payload });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(db.state.invoices[0], before);
});

test('a draft sent after the initial read refuses edits before touching any lines', async t => {
  const db = fixture(), originalRead = db.invoice.findUnique;
  db.invoice.findUnique = async query => {
    const observed = await originalRead(query);
    db.state.invoices[0].status = 'SENT';
    return observed;
  };
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const response = await app.inject({ method: 'PUT', url: '/invoice', payload });
  assert.equal(response.statusCode, 409);
  assert.equal(db.state.invoices[0].status, 'SENT');
  assert.equal(db.state.invoices[0].title, 'Original');
  assert.equal(db.state.invoices[0].lineItems[0].description, 'Original work');
});

test('a complete replacement saves header, lines and matching rounded totals together', async t => {
  const db = fixture();
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const response = await app.inject({ method: 'PUT', url: '/invoice', payload });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().title, 'Edited');
  assert.equal(response.json().total, 100);
  assert.equal(response.json().tax, 0);
  assert.equal(response.json().lineItems.length, 1);
  assert.equal(response.json().lineItems[0].description, 'Replacement work');
});
