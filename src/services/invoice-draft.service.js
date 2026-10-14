import { invoiceTotals } from '../utils/money-totals.js';

function conflict() {
  return Object.assign(new Error('Invoice changed while saving. Reload before editing.'), { statusCode: 409 });
}

// Claim the observed draft before replacing its lines. The invoice row lock is
// shared with sending/payment transitions; any failed replacement rolls back
// both the claim and every line/header change.
export async function updateDraftInvoice(prisma, invoice, { data, lineItems, recalculate }, organizationId) {
  if (!organizationId || invoice.organizationId !== organizationId) {
    throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
  }
  const observedTime = new Date(invoice.updatedAt).getTime();
  if (!Number.isFinite(observedTime)) throw conflict();
  const updatedAt = new Date(Math.max(Date.now(), observedTime + 1));
  if (invoice.billingSources && ['clientId', 'projectId', 'currency'].some(key => data[key] !== undefined && data[key] !== invoice[key])) {
    throw Object.assign(new Error('The original billing client, project and currency must remain unchanged. Release sources and create a new draft to change them.'), { statusCode: 409 });
  }
  if (invoice.billingSources && data.isRecurring === true) throw Object.assign(new Error('Reviewed work is billed once. Use a separate recurring invoice template.'), { statusCode: 409 });
  try {
    return await prisma.$transaction(async tx => {
      const claimed = await tx.invoice.updateMany({
        where: { id: invoice.id, organizationId, deletedAt: null, status: 'DRAFT', updatedAt: invoice.updatedAt },
        data: { updatedAt },
      });
      if (claimed.count !== 1) throw conflict();
      const update = { ...data, updatedAt };
      if (lineItems !== undefined || recalculate) {
        const items = lineItems ?? await tx.invoiceLineItem.findMany({ where: { invoiceId: invoice.id } });
        const { subtotal, tax, total } = invoiceTotals(items, update.taxRate ?? invoice.taxRate, update.discountAmount ?? invoice.discountAmount);
        Object.assign(update, { subtotal, tax, total });
      }
      if (lineItems !== undefined) {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } });
        await tx.invoiceLineItem.createMany({ data: lineItems.map(line => ({ ...line, invoiceId: invoice.id })) });
      }
      return tx.invoice.update({ where: { id: invoice.id }, data: update, include: {
        client: { select: { id: true, name: true } },
        lineItems: { orderBy: { position: 'asc' } },
        payments: true,
      } });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error?.code === 'P2034') throw conflict();
    throw error;
  }
}
