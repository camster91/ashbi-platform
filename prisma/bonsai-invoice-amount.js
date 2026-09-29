// A Bonsai source invoice is billed in exactly one currency: its amount is the
// source field for that currency, never a conversion from the other one.
export function bonsaiInvoiceAmount(inv) {
  const currency = inv.currency === 'USD' ? 'USD' : 'CAD';
  const amount = currency === 'USD' ? inv.amountUsd : inv.amountCad;
  if (!(Number(amount) > 0)) {
    throw new Error(`Bonsai invoice ${inv.number} has no ${currency} amount`);
  }
  return { currency, amount: Number(amount) };
}
