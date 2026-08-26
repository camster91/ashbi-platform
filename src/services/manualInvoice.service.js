export class ManualInvoiceError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'ManualInvoiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const invoiceInclude = {
  client: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  lineItems: { orderBy: { position: 'asc' } },
  payments: true,
};

function prepareLineItems(lineItems) {
  return lineItems.map((lineItem, position) => ({
    description: lineItem.description,
    itemType: lineItem.itemType || 'LABOR',
    quantity: Number(lineItem.quantity),
    unitPrice: Number(lineItem.unitPrice),
    total: Number((Number(lineItem.quantity) * Number(lineItem.unitPrice)).toFixed(2)),
    position: lineItem.position ?? position,
  }));
}

function calculateTotals(lineItems, taxRate, discountAmount) {
  const subtotal = lineItems.reduce((sum, lineItem) => sum + lineItem.total, 0);
  const discounted = Math.max(0, subtotal - discountAmount);
  const tax = Number(((discounted * taxRate) / 100).toFixed(2));
  return {
    subtotal: Number(subtotal.toFixed(2)),
    tax,
    total: Number((discounted + tax).toFixed(2)),
  };
}

export async function createManualInvoiceDraft({
  prisma,
  actorUserId,
  input,
  invoiceNumberFactory,
  now = new Date(),
}) {
  const existing = await prisma.invoice.findUnique({
    where: { creationRequestId: input.creationRequestId },
    include: invoiceInclude,
  });
  if (existing) return existing;

  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: { id: true },
  });
  if (!client) {
    throw new ManualInvoiceError('Client not found', 'INVOICE_CLIENT_NOT_FOUND', 404);
  }

  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, clientId: input.clientId },
      select: { id: true },
    });
    if (!project) {
      throw new ManualInvoiceError(
        'Project must belong to the selected client',
        'INVOICE_PROJECT_CLIENT_MISMATCH',
        409,
      );
    }
  }

  const lineItems = prepareLineItems(input.lineItems);
  const discountAmount = input.discountAmount ?? 0;
  const { subtotal, tax, total } = calculateTotals(lineItems, input.taxRate, discountAmount);
  const invoiceNumber = await invoiceNumberFactory();

  try {
    return await prisma.invoice.create({
      data: {
        creationRequestId: input.creationRequestId,
        invoiceNumber,
        title: input.title || null,
        clientId: input.clientId,
        projectId: input.projectId || null,
        currency: input.currency,
        subtotal,
        discountAmount,
        taxRate: input.taxRate,
        taxType: input.taxType,
        tax,
        total,
        notes: input.notes || null,
        internalNotes: input.internalNotes || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        issueDate: input.issueDate ? new Date(input.issueDate) : now,
        isRecurring: input.isRecurring ?? false,
        recurringInterval: input.isRecurring ? input.recurringInterval || null : null,
        createdById: actorUserId,
        lineItems: { create: lineItems },
      },
      include: invoiceInclude,
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;

    const concurrentDraft = await prisma.invoice.findUnique({
      where: { creationRequestId: input.creationRequestId },
      include: invoiceInclude,
    });
    if (concurrentDraft) return concurrentDraft;
    throw error;
  }
}
