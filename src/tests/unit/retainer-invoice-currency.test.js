// Retainer invoices (S7): default to CAD, bill only the plan amount set in
// the invoice currency (a USD rate is never invoiced labelled CAD or the
// reverse), and refuse to bill when that amount is missing.
import assert from 'node:assert/strict';
import test from 'node:test';
import retainerRoutes from '../../routes/retainer.routes.js';
import { createFakeInvoiceDb, buildInvoiceApp } from '../helpers/fake-invoice-db.js';

function retainerApp(t, plan) {
  const db = createFakeInvoiceDb({ clients: [{ id: 'client-a', name: 'Client A' }] });
  db.retainerPlan = {
    findUnique: async () => ({ clientId: 'client-a', hoursPerMonth: 10, client: { id: 'client-a', name: 'Client A' }, ...plan }),
    update: async ({ data }) => data,
  };
  return buildInvoiceApp(t, retainerRoutes, db).then((app) => ({ app, db }));
}

const url = '/retainer/client-a/generate-invoice';

test('a retainer invoice defaults to CAD and bills the CAD amount', async (t) => {
  const { app, db } = await retainerApp(t, { monthlyAmountCad: 2000, monthlyAmountUsd: 1500 });
  const response = await app.inject({ method: 'POST', url, payload: {} });
  assert.equal(response.statusCode, 200, response.body);
  const [invoice] = db.state.invoices;
  assert.equal(invoice.currency, 'CAD');
  assert.equal(invoice.subtotal, 2000);
  assert.equal(invoice.createdById, 'user-a');
  assert.match(invoice.invoiceNumber, /^INV-\d{4}-0001$/);
});

test('a USD retainer invoice bills the USD amount', async (t) => {
  const { app, db } = await retainerApp(t, { monthlyAmountCad: 2000, monthlyAmountUsd: 1500 });
  const response = await app.inject({ method: 'POST', url, payload: { currency: 'USD' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(db.state.invoices[0].currency, 'USD');
  assert.equal(db.state.invoices[0].subtotal, 1500);
});

test('billing refuses when the plan has no amount in the invoice currency', async (t) => {
  const { app, db } = await retainerApp(t, { monthlyAmountCad: null, monthlyAmountUsd: 1500 });
  const response = await app.inject({ method: 'POST', url, payload: { currency: 'CAD' } });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().code, 'RETAINER_RATE_MISSING');
  assert.equal(db.state.invoices.length, 0, 'no USD amount is billed labelled CAD');

  const eur = await app.inject({ method: 'POST', url, payload: { currency: 'EUR' } });
  assert.equal(eur.statusCode, 400, 'plans have no EUR amount to bill');
});
