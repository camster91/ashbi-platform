// Proposal money, computed on the server from the stored line items. Shared by
// the proposals routes, the proposal builder and estimate conversion so no
// path accepts a client-supplied subtotal or total.

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

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
      total: roundMoney(quantity * item.unitPrice),
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
