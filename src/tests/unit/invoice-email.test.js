import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoiceDeliveryEmail } from '../../services/email.service.js';

test('invoice delivery falls back to the authorized portal URL when Stripe payment is unavailable', () => {
  const delivery = buildInvoiceDeliveryEmail({
    to: 'client@example.test',
    clientName: 'Avery Client',
    invoiceNumber: 'INV-1042',
    total: 1250,
    dueDate: new Date('2026-09-15T00:00:00.000Z'),
    viewUrl: 'https://hub.ashbi.test/portal/invoice/safe-token',
  });

  assert.equal(delivery.to, 'client@example.test');
  assert.equal(delivery.subject, 'Invoice INV-1042 from Ashbi');
  assert.equal(delivery.template, 'invoice-created.html');
  assert.equal(delivery.variables.clientName, 'Avery Client');
  assert.equal(delivery.variables.amount, '$1,250.00 CAD');
  assert.equal(delivery.variables.payLink, 'https://hub.ashbi.test/portal/invoice/safe-token');
  assert.match(delivery.variables.dueDate, /September 15, 2026/);
});
