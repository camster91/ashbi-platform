export class ProposalInvoiceError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'ProposalInvoiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const invoiceInclude = {
  client: { select: { id: true, name: true } },
  lineItems: { orderBy: { position: 'asc' } },
  payments: true,
};

function calculateTotals(lineItems, taxRate, discountAmount) {
  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const discounted = Math.max(0, subtotal - discountAmount);
  const tax = Number(((discounted * taxRate) / 100).toFixed(2));
  const total = Number((discounted + tax).toFixed(2));
  return { subtotal: Number(subtotal.toFixed(2)), tax, total };
}

export async function createDraftInvoiceFromProposal({
  prisma,
  proposalId,
  actorUserId,
  taxDecision,
  invoiceNumberFactory,
}) {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: { client: true, lineItems: true },
  });

  if (!proposal) {
    throw new ProposalInvoiceError('Proposal not found', 'PROPOSAL_NOT_FOUND', 404);
  }
  if (proposal.status !== 'APPROVED') {
    throw new ProposalInvoiceError('Proposal must be approved first', 'PROPOSAL_NOT_APPROVED');
  }
  if (!['CAD', 'USD'].includes(proposal.currency)) {
    throw new ProposalInvoiceError(
      'Proposal currency must be reviewed before creating an invoice',
      'PROPOSAL_CURRENCY_UNASSIGNED',
      409,
    );
  }

  const existing = await prisma.invoice.findUnique({
    where: { proposalId: proposal.id },
    include: invoiceInclude,
  });
  if (existing) return existing;

  const processedItems = proposal.lineItems.map((lineItem, position) => ({
    description: lineItem.description,
    itemType: 'LABOR',
    quantity: lineItem.quantity,
    unitPrice: lineItem.unitPrice,
    total: lineItem.total,
    position,
  }));
  const discountAmount = proposal.discount || 0;
  const { subtotal, tax, total } = calculateTotals(
    processedItems,
    taxDecision.taxRate,
    discountAmount,
  );
  const invoiceNumber = await invoiceNumberFactory();

  try {
    return await prisma.invoice.create({
      data: {
        invoiceNumber,
        title: `Invoice for: ${proposal.title}`,
        clientId: proposal.clientId,
        projectId: proposal.projectId || null,
        proposalId: proposal.id,
        currency: proposal.currency,
        subtotal,
        discountAmount,
        taxRate: taxDecision.taxRate,
        taxType: taxDecision.taxType,
        tax,
        total,
        notes: `Invoice for proposal: ${proposal.title}`,
        createdById: actorUserId,
        lineItems: { create: processedItems },
      },
      include: invoiceInclude,
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const concurrentInvoice = await prisma.invoice.findUnique({
      where: { proposalId: proposal.id },
      include: invoiceInclude,
    });
    if (concurrentInvoice) return concurrentInvoice;
    throw error;
  }
}
