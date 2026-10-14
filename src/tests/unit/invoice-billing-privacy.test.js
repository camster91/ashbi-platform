import test from 'node:test';
import assert from 'node:assert/strict';
import invoiceRoutes from '../../routes/invoice.routes.js';
import { createFakeInvoiceDb, buildInvoiceApp } from '../helpers/fake-invoice-db.js';
import { withoutInvoiceBillingSources } from '../../utils/invoice-billing-privacy.js';

test('nested invoice privacy keeps dates and ordinary properties while omitting internal billing history', () => {
  const date = new Date('2026-10-14T00:00:00Z');
  const source = { id: 'invoice', invoiceNumber: 'INV-1', currency: 'CAD', updatedAt: date, billingSources: { suggestedHourlyRate: 10 }, billingSourcesReleasedAt: date };
  const output = withoutInvoiceBillingSources({ invoices: [source], untouched: { billingSources: 'ordinary property' } });
  assert.equal(output.invoices[0].updatedAt, date);
  assert.equal(output.invoices[0].currency, 'CAD');
  assert.equal(output.invoices[0].sourceBilling, true);
  assert.ok(!('billingSources' in output.invoices[0]));
  assert.ok(!('billingSourcesReleasedAt' in output.invoices[0]));
  assert.equal(source.billingSources.suggestedHourlyRate, 10, 'privacy does not modify the stored snapshot');
  assert.equal(output.untouched.billingSources, 'ordinary property');
});

test('staff invoice GET and edit responses retain snapshots only for administrators', async t => {
  for (const role of ['ADMIN', 'TEAM']) {
    const db = createFakeInvoiceDb({ clients: [{ id: 'client' }], invoices: [{ id: 'invoice', clientId: 'client', invoiceNumber: 'INV-1', status: 'DRAFT', currency: 'CAD', billingSources: { private: 'original rate' } }] });
    db.user = { findFirst: async ({ where }) => where.id === 'staff' && where.role === role ? { id: 'staff', organizationId: 'org-a', role } : null };
    const app = await buildInvoiceApp(t, invoiceRoutes, db, { user: { id: 'staff', organizationId: 'org-a', role } });
    const read = await app.inject({ method: 'GET', url: '/invoice' });
    assert.equal(read.statusCode, 200);
    assert.equal('billingSources' in read.json(), role === 'ADMIN');
    const edit = await app.inject({ method: 'PUT', url: '/invoice', payload: { title: 'Reviewed title' } });
    assert.equal(edit.statusCode, role === 'ADMIN' ? 200 : 403, edit.body);
    assert.equal('billingSources' in edit.json(), role === 'ADMIN');
  }
});

test('source-backed bulk writes and stale administrator claims are denied before sending or settlement', async t => {
  for (const role of ['TEAM', 'ADMIN']) {
    const db = createFakeInvoiceDb({ clients: [{ id: 'client' }], invoices: [
      { id: 'invoice', clientId: 'client', invoiceNumber: 'INV-1', status: 'DRAFT', billingSources: { version: 1 } },
      { id: 'legacy', clientId: 'client', invoiceNumber: 'INV-2', status: 'DRAFT' },
    ] });
    db.user = { findFirst: async () => null }; // The signed-in claim is no longer an active administrator.
    let providerCalls = 0;
    const app = await buildInvoiceApp(t, invoiceRoutes, db, { user: { id: 'staff', organizationId: 'org-a', role }, routeOptions: {
      createPaymentLink: async () => { providerCalls++; throw new Error('Provider must not run'); },
      sendInvoiceDeliveryEmail: async () => { providerCalls++; throw new Error('Provider must not run'); },
    } });
    const read = await app.inject({ method: 'GET', url: '/invoice' });
    assert.equal(read.statusCode, 200);
    assert.equal('billingSources' in read.json(), false, 'stale administrator claims cannot read original source rates');
    for (const url of ['/bulk/send', '/bulk/mark-paid']) {
      const response = await app.inject({ method: 'POST', url, payload: { ids: ['invoice', 'legacy'] } });
      assert.equal(response.statusCode, 403, response.body);
    }
    assert.equal(providerCalls, 0);
    assert.equal(db.state.payments.length, 0);
    assert.equal(db.state.invoices[0].status, 'DRAFT');
    const ordinaryEdit = await app.inject({ method: 'PUT', url: '/legacy', payload: { title: 'Ordinary draft' } });
    assert.equal(ordinaryEdit.statusCode, 200, ordinaryEdit.body);
  }
});
