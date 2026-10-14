// Billing origin snapshots contain internal source identities and suggested
// rates. Staff invoice responses keep them administrator-only; public portal
// invoices already use a separate field allowlist.
export function hasInvoiceBillingSources(value) {
  if (Array.isArray(value)) return value.some(hasInvoiceBillingSources);
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return (typeof value.invoiceNumber === 'string' && Boolean(value.billingSources)) || Object.values(value).some(hasInvoiceBillingSources);
}
export function withoutInvoiceBillingSources(value) {
  if (Array.isArray(value)) return value.map(withoutInvoiceBillingSources);
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return value;
  const output = Object.fromEntries(Object.entries(value)
    .filter(([key]) => typeof value.invoiceNumber !== 'string' || !['billingSources', 'billingSourcesReleasedAt'].includes(key))
    .map(([key, nested]) => [key, withoutInvoiceBillingSources(nested)]));
  if (typeof value.invoiceNumber === 'string' && value.billingSources) output.sourceBilling = true;
  return output;
}
