import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getNextRecurringDate,
  processRecurringInvoices,
} from '../../jobs/recurring-invoices.js';

function recurringInvoice() {
  return {
    id: 'invoice-template-1',
    invoiceNumber: 'INV-2026-0001',
    recurringNextDate: new Date('2026-08-01T12:00:00.000Z'),
    recurringInterval: 'MONTHLY',
    isRecurring: true,
    status: 'SENT',
    title: 'Monthly services',
    notes: null,
    currency: 'CAD',
    taxRate: 13,
    taxType: 'HST',
    discountAmount: 0,
    clientId: 'client-1',
    projectId: null,
    createdById: 'user-1',
    client: { id: 'client-1', name: 'Test Client' },
    lineItems: [{
      description: 'Retainer',
      itemType: 'LABOR',
      quantity: 1,
      unitPrice: 100,
      total: 100,
      position: 0,
    }],
  };
}

test('recurring invoice occurrence is claimed once across competing workers', async () => {
  const invoice = recurringInvoice();
  let nextDate = invoice.recurringNextDate;
  const created = [];

  const client = {
    invoice: {
      findMany: async () => [{ ...invoice, recurringNextDate: invoice.recurringNextDate }],
    },
    $transaction: async (callback) => callback({
      invoice: {
        updateMany: async ({ where, data }) => {
          if (nextDate.getTime() !== where.recurringNextDate.getTime()) return { count: 0 };
          nextDate = data.recurringNextDate;
          return { count: 1 };
        },
        create: async ({ data }) => {
          created.push(data);
          return data;
        },
      },
    }),
  };

  const invoiceNumberGenerator = async () => 'INV-2026-0002';
  const results = await Promise.all([
    processRecurringInvoices(client, invoiceNumberGenerator),
    processRecurringInvoices(client, invoiceNumberGenerator),
  ]);

  assert.equal(created.length, 1);
  assert.equal(results.reduce((sum, result) => sum + result.generated, 0), 1);
  assert.equal(nextDate.toISOString(), '2026-09-01T12:00:00.000Z');
});

test('recurring date advances according to the configured interval', () => {
  const start = new Date('2026-08-15T12:00:00.000Z');
  assert.equal(getNextRecurringDate(start, 'MONTHLY').toISOString(), '2026-09-15T12:00:00.000Z');
  assert.equal(getNextRecurringDate(start, 'QUARTERLY').toISOString(), '2026-11-15T12:00:00.000Z');
  assert.equal(getNextRecurringDate(start, 'ANNUALLY').toISOString(), '2027-08-15T12:00:00.000Z');
  assert.equal(
    getNextRecurringDate(new Date('2026-01-31T12:00:00.000Z'), 'MONTHLY').toISOString(),
    '2026-02-28T12:00:00.000Z',
  );
});
