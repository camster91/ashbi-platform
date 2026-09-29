// Invoice create/edit payloads sent by the staff UI. Kept free of React so the
// backend contract test (src/tests/unit/invoice-web-payload-contract.test.js)
// can validate these exact payloads against the API schemas.
//
// Dates come straight from <input type="date"> ("YYYY-MM-DD"). The API stores a
// date-only due date as the end of that calendar day in UTC, and the UI shows
// invoice dates in UTC, so the chosen day round-trips unchanged.

export const INVOICE_CURRENCY_OPTIONS = ['CAD', 'USD', 'EUR', 'GBP'];

function toNumber(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function lineItemsPayload(lineItems = [], { withPosition = false } = {}) {
  return lineItems.map((item, index) => ({
    description: item.description,
    itemType: item.itemType,
    quantity: toNumber(item.quantity, 1) || 1,
    unitPrice: toNumber(item.unitPrice, 0),
    ...(withPosition ? { position: index } : {}),
  }));
}

/** Payload for POST /api/invoices from the "New Invoice" form. */
export function buildInvoiceCreatePayload(form) {
  return {
    clientId: form.clientId,
    projectId: form.projectId || undefined,
    title: form.title || undefined,
    notes: form.notes || undefined,
    // Empty means "due upon receipt".
    dueDate: form.dueDate || undefined,
    currency: form.currency || undefined,
    taxRate: toNumber(form.taxRate, 0),
    taxType: form.taxType,
    discountAmount: toNumber(form.discountAmount, 0),
    isRecurring: Boolean(form.isRecurring),
    recurringInterval: form.isRecurring ? form.recurringInterval : undefined,
    lineItems: lineItemsPayload(form.lineItems),
  };
}

/** Payload for PUT /api/invoices/:id from the draft edit form. */
export function buildInvoiceUpdatePayload(editForm) {
  return {
    title: editForm.title || undefined,
    notes: editForm.notes || undefined,
    internalNotes: editForm.internalNotes || undefined,
    // Clearing the date input removes the due date ("upon receipt").
    dueDate: editForm.dueDate || null,
    currency: editForm.currency || undefined,
    taxRate: toNumber(editForm.taxRate, 0),
    taxType: editForm.taxType,
    discountAmount: toNumber(editForm.discountAmount, 0),
    lineItems: lineItemsPayload(editForm.lineItems, { withPosition: true }),
  };
}
