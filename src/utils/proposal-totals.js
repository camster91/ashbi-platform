// Proposal money, computed on the server from the stored line items. Shared by
// the proposals routes, the proposal builder and estimate conversion so no
// path accepts a client-supplied subtotal or total.

import { invoiceTotals, lineTotal, roundMoney } from './money-totals.js';

export { roundMoney };

/**
 * Line items as stored: quantity defaults to 1 and each line total is
 * round2(quantity * unitPrice).
 * @param {Array<{ description: string, quantity?: number, unitPrice: number }>} lineItems
 */
export function computeProposalLineItems(lineItems) {
  return lineItems.map(item => {
    const quantity = item.quantity ?? 1;
    return {
      description: item.description,
      quantity,
      unitPrice: item.unitPrice,
      total: lineTotal(quantity, item.unitPrice),
    };
  });
}

// Subtotal from the line items; a discount can reduce the total to zero but
// never below it.
export function proposalTotals(lineItems, discount = 0) {
  const subtotal = roundMoney(lineItems.reduce((sum, item) => sum + (Number(item.total) || 0), 0));
  const total = roundMoney(Math.max(0, subtotal - (Number(discount) || 0)));
  return { subtotal, total };
}

// Proposals store pre-tax money (subtotal minus discount). The invoice made
// from an approved proposal (POST /api/invoices/from-proposal/:id) adds tax at
// proposalTaxRate(), so every view of a proposal shows that tax and the total
// the invoice will bill: proposalTaxSummary() is the one place it is worked
// out, with the invoice's own arithmetic.

// The Ontario HST default every proposal without its own rate is invoiced at.
export const DEFAULT_PROPOSAL_TAX_RATE = 13;

/**
 * The tax rate the proposal's invoice uses: the estimate's rate for a
 * proposal converted from an estimate (metadata.taxRate, written by
 * proposalDataFromEstimate in estimate.routes.js), otherwise the HST default.
 */
export function proposalTaxRate(proposal) {
  try {
    const metadata = proposal?.metadata ? JSON.parse(proposal.metadata) : null;
    const rate = Number(metadata?.taxRate);
    if (metadata?.source === 'estimate' && metadata.taxRate !== null && metadata.taxRate !== undefined
      && Number.isFinite(rate) && rate >= 0 && rate <= 100) return rate;
  } catch {
    // Unparseable metadata: fall back to the default rate.
  }
  return DEFAULT_PROPOSAL_TAX_RATE;
}

/**
 * The invoice taxType for a rate: HST for the 13% Ontario default, NONE for
 * no tax, otherwise the neutral TAX ("Tax" on the page and PDF) rather than
 * naming a tax the rate may not be.
 */
export function taxTypeForRate(rate) {
  const value = Number(rate) || 0;
  if (value <= 0) return 'NONE';
  if (value === DEFAULT_PROPOSAL_TAX_RATE) return 'HST';
  return 'TAX';
}

/**
 * The tax a proposal's invoice will add and the total it will bill, worked
 * out as the invoice does: tax = round2((subtotal - discount) * rate / 100)
 * on the line totals, total = round2(pre-tax + tax).
 * @returns {{ taxRate: number, taxType: string, tax: number, totalWithTax: number }}
 */
export function proposalTaxSummary(proposal) {
  const taxRate = proposalTaxRate(proposal);
  const lines = Array.isArray(proposal?.lineItems)
    ? proposal.lineItems
    : [{ total: Math.max(0, Number(proposal?.total) || 0) }];
  const discount = Array.isArray(proposal?.lineItems) ? proposal?.discount : 0;
  const { tax, total } = invoiceTotals(lines, taxRate, discount);
  return { taxRate, taxType: taxTypeForRate(taxRate), tax, totalWithTax: total };
}
