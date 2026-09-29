// Bulk send (H11): sending several drafts at once must do exactly what the
// single send does — issue a public link, email the client, audit — and
// report a result per item, instead of only flipping the status to SENT.
import assert from 'node:assert/strict';
import test from 'node:test';
import invoiceRoutes from '../../routes/invoice.routes.js';
import proposalRoutes from '../../routes/proposal.routes.js';
import { createFakeInvoiceDb, buildInvoiceApp } from '../helpers/fake-invoice-db.js';
import { invoicePublicAccessFailure } from '../../utils/public-document-access.js';

function draft(id, overrides = {}) {
  return {
    id, invoiceNumber: `INV-2026-${id}`, clientId: 'client-a', status: 'DRAFT', total: 100, currency: 'CAD',
    viewToken: `default-${id}`, publicAccessExpiresAt: null, publicAccessRevokedAt: null, ...overrides,
  };
}

test('bulk invoice send issues links like the single send and reports each item', async (t) => {
  const db = createFakeInvoiceDb({
    clients: [{ id: 'client-a', name: 'Client A', contacts: [{ email: 'a@example.test', name: 'A', isPrimary: true }] }],
    invoices: [draft('1'), draft('2'), draft('3', { status: 'PAID' })],
  });
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const response = await app.inject({ method: 'POST', url: '/bulk/send', payload: { ids: ['1', '2', '3', 'missing'] } });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.sent, 2);
  assert.deepEqual(body.results.map((result) => [result.id, result.ok]), [['1', true], ['2', true], ['3', false], ['missing', false]]);
  assert.equal(body.results.find((result) => result.id === 'missing').statusCode, 404);
  assert.equal(body.results.find((result) => result.id === '3').statusCode, 400);
  for (const id of ['1', '2']) {
    const invoice = db.state.invoices.find((row) => row.id === id);
    assert.equal(invoice.status, 'SENT');
    assert.ok(invoice.sentAt);
    assert.ok(invoice.publicAccessExpiresAt, 'a public link window was issued');
    assert.notEqual(invoice.viewToken, `default-${id}`, 'a fresh high-entropy token replaces the default one');
    assert.match(invoice.viewToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(body.results.find((result) => result.id === id).emailSent, false, 'test mode reports no delivery');
  }
});

function proposalDb() {
  const proposals = [
    { id: 'p1', title: 'One', status: 'DRAFT', validUntil: null, clientId: 'client-a' },
    { id: 'p2', title: 'Two', status: 'SENT', validUntil: null, clientId: 'client-a' },
  ];
  const find = (id) => proposals.find((proposal) => proposal.id === id) || null;
  return {
    proposals,
    proposal: {
      findUnique: async ({ where, include }) => (find(where.id)
        ? { ...find(where.id), ...(include ? { client: { id: 'client-a', name: 'Client A', contacts: [{ email: 'a@example.test', name: 'A' }] }, lineItems: [] } : {}) }
        : null),
      update: async ({ where, data }) => {
        Object.assign(find(where.id), data);
        return { ...find(where.id), client: { id: 'client-a', name: 'Client A', contacts: [{ email: 'a@example.test', name: 'A' }] }, lineItems: [] };
      },
      updateMany: async ({ where, data }) => {
        const row = find(where.id);
        if (!row || (where.status && row.status !== where.status)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    auditEvent: { create: async ({ data }) => data },
  };
}

test('bulk proposal send issues links like the single send and reports each item', async (t) => {
  const db = proposalDb();
  const app = await buildInvoiceApp(t, proposalRoutes, db);
  const response = await app.inject({ method: 'POST', url: '/bulk/send', payload: { ids: ['p1', 'p2'] } });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.sent, 1);
  assert.deepEqual(body.results.map((result) => [result.id, result.ok]), [['p1', true], ['p2', false]]);
  const [sent] = db.proposals;
  assert.equal(sent.status, 'SENT');
  assert.match(sent.viewToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(sent.publicAccessExpiresAt);
});

test('concurrent single and bulk sends of one draft email once, create one session, and the emailed link works', async (t) => {
  const db = createFakeInvoiceDb({
    clients: [{ id: 'client-a', name: 'Client A', contacts: [{ email: 'a@example.test', name: 'A', isPrimary: true }] }],
    invoices: [draft('1')],
  });
  const sessions = [];
  const emails = [];
  const slow = () => new Promise((resolve) => setTimeout(resolve, 20));
  const app = await buildInvoiceApp(t, invoiceRoutes, db, {
    routeOptions: {
      createPaymentLink: async (invoice) => {
        await slow();
        sessions.push(invoice.viewToken);
        return { paymentLink: `https://checkout.stripe.test/${sessions.length}`, checkoutSessionId: `cs_${sessions.length}`, paymentIntentId: null, amountMinor: 10000, currency: 'cad', expiresAt: null };
      },
      sendInvoiceDeliveryEmail: async (message) => { await slow(); emails.push(message); return { ok: true, id: `msg-${emails.length}` }; },
    },
  });

  const [single, again, bulk] = await Promise.all([
    app.inject({ method: 'POST', url: '/1/send' }),
    app.inject({ method: 'POST', url: '/1/send' }),
    app.inject({ method: 'POST', url: '/bulk/send', payload: { ids: ['1'] } }),
  ]);
  const bulkResult = bulk.json().results[0];
  const winners = [single, again].filter((response) => response.statusCode === 200).length + (bulkResult.ok ? 1 : 0);
  assert.equal(winners, 1, 'exactly one send wins');
  for (const response of [single, again]) {
    if (response.statusCode !== 200) {
      assert.ok([400, 409].includes(response.statusCode), response.body);
      assert.equal(response.json().code, 'ALREADY_SENT');
    }
  }
  if (!bulkResult.ok) assert.equal(bulkResult.reason, 'already_sent');

  assert.equal(sessions.length, 1, 'one Checkout session');
  assert.equal(emails.length, 1, 'one email');
  const [stored] = db.state.invoices;
  assert.equal(emails[0].viewUrl.split('/').pop(), stored.viewToken, 'the emailed link is the stored token');
  assert.equal(sessions[0], stored.viewToken, 'Checkout returns to the stored link');
  assert.equal(invoicePublicAccessFailure(stored), null, 'the emailed link opens');
});

test('bulk send is capped per request', async (t) => {
  const app = await buildInvoiceApp(t, invoiceRoutes, createFakeInvoiceDb());
  const ids = Array.from({ length: 26 }, (_, index) => `id-${index}`);
  const response = await app.inject({ method: 'POST', url: '/bulk/send', payload: { ids } });
  assert.equal(response.statusCode, 400);
});
