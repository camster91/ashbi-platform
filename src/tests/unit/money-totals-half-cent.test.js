// Half-cent tax amounts: an estimate, the proposal made from it, the invoice
// made from that proposal and the invoice's recurring copies all use one
// arithmetic (src/utils/money-totals.js), so they show and bill the same
// cents. toFixed(2) used to round 130.065 down to 130.06 on the invoice while
// the proposal rounded it up to 130.07.
import assert from 'node:assert/strict';
import test from 'node:test';
import { computeEstimateTotals, proposalDataFromEstimate } from '../../routes/estimate.routes.js';
import { proposalInvoiceTaxRate } from '../../routes/invoice.routes.js';
import { proposalTaxSummary } from '../../utils/proposal-totals.js';
import { invoiceTotals, lineTotal } from '../../utils/money-totals.js';
import { processRecurringInvoices } from '../../jobs/recurring-invoices.js';
import { proposalContractContent } from '../../services/automation.service.js';

// subtotal -> [tax, total] at 13%, rounded half-up to cents.
const CASES = [
  [1000.5, 130.07, 1130.57],
  [2500.5, 325.07, 2825.57],
  [350.5, 45.57, 396.07],
  [4.5, 0.59, 5.09],
];

async function recurringCopyTotals(unitPrice) {
  const created = [];
  const source = {
    id: 'inv-1', invoiceNumber: 'INV-1', recurringNextDate: new Date('2026-08-01T12:00:00.000Z'), recurringInterval: 'MONTHLY',
    isRecurring: true, status: 'SENT', title: 'Monthly', notes: null, currency: 'CAD', taxRate: 13, taxType: 'HST',
    discountAmount: 0, clientId: 'c1', projectId: null, createdById: 'u1', client: { id: 'c1', name: 'C' },
    lineItems: [{ description: 'Retainer', itemType: 'LABOR', quantity: 1, unitPrice, total: lineTotal(1, unitPrice), position: 0 }],
  };
  const client = {
    invoice: { findMany: async () => [source] },
    $transaction: async (callback) => callback({
      invoice: {
        updateMany: async () => ({ count: 1 }),
        create: async ({ data }) => { created.push(data); return data; },
      },
    }),
  };
  await processRecurringInvoices(client, async () => ({ invoiceNumber: 'INV-2', organizationId: 'org-1' }), { now: new Date('2026-08-01T13:00:00.000Z') });
  return { tax: created[0].tax, total: created[0].total };
}

for (const [subtotal, tax, total] of CASES) {
  test(`$${subtotal} at 13%: estimate, proposal, invoice and recurring copy agree on $${total}`, async () => {
    const lines = [{ description: 'Work', quantity: 1, rate: subtotal }];
    const estimate = { id: 'e1', clientId: 'c1', title: 'Work', lineItems: lines, taxRate: 13, ...computeEstimateTotals(lines, { taxRate: 13 }) };
    assert.deepEqual([estimate.subtotal, estimate.tax, estimate.total], [subtotal, tax, total], 'estimate');

    const data = proposalDataFromEstimate(estimate, { createdById: 'u1' });
    const proposal = { ...data, lineItems: data.lineItems.create };
    const summary = proposalTaxSummary(proposal);
    assert.deepEqual([summary.tax, summary.totalWithTax], [tax, total], 'proposal');

    // POST /api/invoices/from-proposal: the proposal's lines, rate and discount.
    const invoice = invoiceTotals(proposal.lineItems, proposalInvoiceTaxRate(proposal), proposal.discount);
    assert.deepEqual([invoice.subtotal, invoice.tax, invoice.total], [subtotal, tax, total], 'invoice');

    assert.deepEqual(await recurringCopyTotals(subtotal), { tax, total }, 'recurring copy');
  });
}

test('the auto-generated contract states the subtotal, the tax and the total with tax', () => {
  const content = proposalContractContent({
    title: 'Website', subtotal: 1000, discount: 0, total: 1000, metadata: null,
    lineItems: [{ description: 'Design', quantity: 1, unitPrice: 1000, total: 1000 }],
  });
  assert.match(content, /Subtotal: \$1,000\.00 CAD/);
  assert.match(content, /HST \(13%\): \$130\.00 CAD/);
  assert.match(content, /Total: \$1,130\.00 CAD/);
  assert.doesNotMatch(content, /Discount/, 'a zero discount is not printed');

  const fromEstimate = proposalContractContent({
    title: 'Estimate work', subtotal: 1500, discount: 100, total: 1400,
    metadata: JSON.stringify({ source: 'estimate', taxRate: 5 }),
    lineItems: [{ description: 'Build', quantity: 1, unitPrice: 1500, total: 1500 }],
  });
  assert.match(fromEstimate, /Discount: -\$100\.00 CAD/);
  assert.match(fromEstimate, /Tax \(5%\): \$70\.00 CAD/);
  assert.match(fromEstimate, /Total: \$1,470\.00 CAD/);
});
