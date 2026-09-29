// Per-organization invoice numbering: INV-<year>-<n>, where n comes from the
// organization's DocumentNumberSequence row for that (UTC) year.
//
// allocateInvoiceNumber must run inside the transaction that creates the
// invoice. The counter row is incremented with INSERT ... ON CONFLICT DO
// UPDATE ... RETURNING, which takes a row lock held until commit: concurrent
// creates in one organization are serialized on that row and receive
// consecutive numbers, and a rolled-back create releases its number.

export const INVOICE_NUMBER_KIND = 'INVOICE';
// Bounded skip-ahead past numbers already present (imports, or a writer from
// before the counter existed) instead of failing the create.
const MAX_ALLOCATION_ATTEMPTS = 50;

export function formatInvoiceNumber(year, sequence) {
  return `INV-${year}-${String(sequence).padStart(4, '0')}`;
}

function tenancyError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  error.expose = true;
  return error;
}

/**
 * @param {any} tx Prisma transaction client (scoped or raw)
 * @param {{ clientId: string, organizationId?: string|null, now?: Date }} options
 * @returns {Promise<{ invoiceNumber: string, organizationId: string }>}
 */
export async function allocateInvoiceNumber(tx, { clientId, organizationId = null, now = new Date() }) {
  // The owning organization is the client's; a caller-supplied organization
  // must agree with it (the scoped create would reject a foreign client too).
  const [owner] = await tx.$queryRaw`SELECT "organizationId" FROM "clients" WHERE "id" = ${clientId}`;
  if (!owner) throw tenancyError('Client not found');
  if (organizationId && owner.organizationId !== organizationId) throw tenancyError('Client not found');
  const orgId = owner.organizationId;
  const year = now.getUTCFullYear();

  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const [row] = await tx.$queryRaw`
      INSERT INTO "document_number_sequences" ("organizationId", "kind", "period", "lastValue", "updatedAt")
      VALUES (${orgId}, ${INVOICE_NUMBER_KIND}, ${year}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationId", "kind", "period")
      DO UPDATE SET "lastValue" = "document_number_sequences"."lastValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "lastValue"`;
    const invoiceNumber = formatInvoiceNumber(year, Number(row.lastValue));
    // Includes soft-deleted rows: they still hold their number.
    const taken = await tx.$queryRaw`SELECT 1 AS "exists" FROM "invoices" WHERE "organizationId" = ${orgId} AND "invoiceNumber" = ${invoiceNumber} LIMIT 1`;
    if (taken.length === 0) return { invoiceNumber, organizationId: orgId };
  }
  throw new Error('Could not allocate a free invoice number');
}

/**
 * Create an invoice with a freshly allocated number in one transaction.
 * @param {any} db Prisma client (request-scoped in routes)
 * @param {{ data: any, include?: any, organizationId?: string|null }} options
 */
export async function createNumberedInvoice(db, { data, include, organizationId = null }) {
  return db.$transaction(async (tx) => {
    const allocated = await allocateInvoiceNumber(tx, { clientId: data.clientId, organizationId });
    return tx.invoice.create({
      data: { ...data, invoiceNumber: allocated.invoiceNumber, organizationId: allocated.organizationId },
      ...(include ? { include } : {}),
    });
  });
}
