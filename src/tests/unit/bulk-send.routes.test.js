// Bulk send (H11): sending several drafts at once must do exactly what the
// single send does — issue a public link, email the client, audit — and
// report a result per item, instead of only flipping the status to SENT.
import assert from 'node:assert/strict';
import test from 'node:test';
import invoiceRoutes from '../../routes/invoice.routes.js';
import proposalRoutes from '../../routes/proposal.routes.js';
import { createFakeInvoiceDb, buildInvoiceApp } from '../helpers/fake-invoice-db.js';

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
      findUnique: async ({ where }) => (find(where.id) ? { ...find(where.id) } : null),
      update: async ({ where, data }) => {
        Object.assign(find(where.id), data);
        return { ...find(where.id), client: { id: 'client-a', name: 'Client A', contacts: [{ email: 'a@example.test', name: 'A' }] }, lineItems: [] };
      },
      updateMany: async () => { throw new Error('bulk send must not bypass the single-send path'); },
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
