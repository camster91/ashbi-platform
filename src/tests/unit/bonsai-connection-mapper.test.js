import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBonsaiConnections } from '../../services/bonsaiConnectionMapper.service.js';

function map(connectionRows, overrides = {}) {
  return mapBonsaiConnections({
    connectionRows,
    projectRows: [{ client_or_company_name: 'Acme' }],
    invoiceRows: [{ client_or_company_name: 'Acme', client_email: 'billing@acme.ca' }],
    ...overrides,
  });
}

test('connection mapper promotes only evidence-linked operating clients', () => {
  const result = map([
    { Name: 'Acme', Email: 'owner@acme.ca', Domain: 'https://www.acme.ca/', 'Phone Number': '555-0100' },
    { Name: 'Billing Person', Email: 'billing@acme.ca', Domain: 'acme.ca' },
    { Name: 'Unrelated Prospect', Email: 'lead@example.com', Domain: 'example.com' },
  ]);
  assert.deepEqual(result.summary, {
    sourceConnections: 3, operationalClients: 1, mappedConnections: 2,
    ignoredConnections: 1, clientsWithPrimaryConnection: 1,
  });
  assert.equal(result.clients[0].primaryConnection.email, 'billing@acme.ca');
  assert.equal(result.clients[0].domain, 'acme.ca');
  assert.deepEqual(result.clients[0].invoiceEmails, ['billing@acme.ca']);
  assert.deepEqual(result.clients[0].connections.map(connection => connection.email), ['owner@acme.ca', 'billing@acme.ca']);
  assert.deepEqual(result.findings, []);
});

test('connection mapper never promotes generic mailbox domains to client identity', () => {
  const result = map([{ Name: 'Acme', Email: 'billing@acme.ca', Domain: 'gmail.com' }]);
  assert.equal(result.clients[0].domain, null);
  assert.deepEqual(result.findings, []);
});

test('connection mapper rejects one business domain claimed by multiple operational clients', () => {
  const result = map([
    { Name: 'Acme', Email: 'owner@shared.ca', Domain: 'shared.ca' },
    { Name: 'Beta', Email: 'owner@beta.ca', Domain: 'shared.ca' },
  ], {
    projectRows: [{ client_or_company_name: 'Acme' }, { client_or_company_name: 'Beta' }],
    invoiceRows: [],
  });
  assert.equal(result.clients.every(client => client.domain === null), true);
  assert.deepEqual(result.findings, [{
    code: 'CONNECTION_DOMAIN_CONFLICT', domain: 'shared.ca', clientNames: ['Acme', 'Beta'],
  }]);
});

test('connection mapper refuses a row whose name and invoice email point at different clients', () => {
  const result = map([{
    Name: 'Acme', Email: 'billing@beta.ca', Domain: 'acme.ca',
  }], {
    projectRows: [{ client_or_company_name: 'Acme' }, { client_or_company_name: 'Beta' }],
    invoiceRows: [
      { client_or_company_name: 'Acme', client_email: 'billing@acme.ca' },
      { client_or_company_name: 'Beta', client_email: 'billing@beta.ca' },
    ],
  });
  assert.deepEqual(result.findings, [{
    code: 'CONNECTION_TARGET_CONFLICT', sourceRow: 2, candidateClients: ['Acme', 'Beta'],
  }]);
});

test('connection mapper preserves multiple contacts without silently merging conflicting duplicate emails', () => {
  const result = map([
    { Name: 'First Person', Email: 'billing@acme.ca', Domain: 'acme.ca' },
    { Name: 'Different Person', Email: 'billing@acme.ca', Domain: 'other.ca' },
  ]);
  assert.deepEqual(result.clients[0].connections, []);
  assert.deepEqual(result.findings, [{
    code: 'DUPLICATE_CONNECTION_EMAIL_CONFLICT', clientName: 'Acme',
    sourceRows: [2, 3], fields: ['name', 'domain'],
  }]);
});

test('connection mapper leaves multiple invoice contacts pending instead of guessing a primary', () => {
  const result = map([
    { Name: 'Person One', Email: 'one@acme.ca' },
    { Name: 'Person Two', Email: 'two@acme.ca' },
  ], {
    invoiceRows: [
      { client_or_company_name: 'Acme', client_email: 'one@acme.ca' },
      { client_or_company_name: 'Acme', client_email: 'two@acme.ca' },
    ],
  });
  assert.equal(result.clients[0].primaryConnection, null);
  assert.deepEqual(result.findings, [{
    code: 'AMBIGUOUS_PRIMARY_CONNECTION', clientName: 'Acme', sourceRows: [2, 3],
    reason: 'multiple_invoice_emails',
  }]);
});

test('connection mapper excludes internal and test targets through the caller policy', () => {
  const result = map([{ Name: 'Ashbi Design', Email: 'internal@ashbi.ca' }], {
    projectRows: [{ client_or_company_name: 'Ashbi Design' }], invoiceRows: [],
    shouldSkipClient: name => name === 'Ashbi Design',
  });
  assert.equal(result.summary.operationalClients, 0);
  assert.equal(result.summary.ignoredConnections, 1);
});
