const CURRENCIES = new Set(['CAD', 'USD']);

function text(value) {
  return String(value ?? '').trim();
}

function timestamp(value, label) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp`);
  return parsed;
}

function exactMinor(value, label) {
  const amount = Number(value);
  const minor = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - minor) > 1e-7) {
    throw new Error(`${label} must have an exact positive minor-unit amount`);
  }
  return minor;
}

function revision(value, label) {
  const normalized = text(value).toLowerCase();
  if (!/^[a-f0-9]{7,40}$/.test(normalized)) throw new Error(`${label} must be an exact Git revision`);
  return normalized;
}

function requireRecord(record, label) {
  if (!record?.id) throw new Error(`${label} evidence is missing`);
  return record;
}

function validateCounts(counts) {
  const entries = Object.entries(counts ?? {});
  if (entries.length !== 7 || entries.some(([, count]) => count !== 1)) {
    throw new Error('The controlled journey has missing or duplicate source writes');
  }
}

export function buildControlledJourneyEvidence({
  organizationId,
  publicSiteRevision,
  hubRevision,
  snapshot,
  sandboxReadiness,
  attestation,
  generatedAt = new Date(),
} = {}) {
  const organization = text(organizationId);
  if (!organization) throw new Error('Organization is required');
  const generated = timestamp(generatedAt, 'Evidence generation time');
  const lead = requireRecord(snapshot?.lead, 'Lead');
  const client = requireRecord(snapshot?.client, 'Client');
  const deal = requireRecord(snapshot?.deal, 'Opportunity');
  const proposal = requireRecord(snapshot?.proposal, 'Proposal');
  const contract = requireRecord(snapshot?.contract, 'Contract');
  const project = requireRecord(snapshot?.project, 'Project');
  const invoice = requireRecord(snapshot?.invoice, 'Invoice');
  const payment = requireRecord(snapshot?.payment, 'Payment');
  validateCounts(snapshot?.sourceCounts);

  if (sandboxReadiness?.ready !== true
    || !Array.isArray(sandboxReadiness?.checks)
    || sandboxReadiness.checks.length === 0
    || sandboxReadiness.checks.some(item => item?.ok !== true)) {
    throw new Error('The named environment does not pass the sandbox readiness gate');
  }
  if (attestation?.noManualDatabaseCorrections !== true
    || text(attestation?.attestedBy).length < 2
    || text(attestation?.reference).length < 8) {
    throw new Error('A bounded no-manual-database-corrections attestation is required');
  }

  if (lead.organizationId !== organization || client.organizationId !== organization
    || deal.organizationId !== organization || project.organizationId !== organization) {
    throw new Error('Journey records do not belong to one organization');
  }
  if (lead.status !== 'CONVERTED' || lead.convertedClientId !== client.id || lead.convertedDealId !== deal.id) {
    throw new Error('Lead conversion evidence is incomplete');
  }
  if (deal.clientId !== client.id || proposal.dealId !== deal.id || proposal.clientId !== client.id
    || proposal.status !== 'APPROVED') {
    throw new Error('Opportunity-to-proposal evidence is incomplete');
  }
  if (!CURRENCIES.has(deal.currency) || proposal.currency !== deal.currency) {
    throw new Error('Opportunity and proposal currency evidence does not reconcile');
  }
  if (contract.proposalId !== proposal.id || contract.clientId !== client.id || contract.status !== 'SIGNED') {
    throw new Error('Signed contract evidence is incomplete');
  }
  if (project.sourceContractId !== contract.id || project.clientId !== client.id
    || proposal.projectId !== project.id) {
    throw new Error('Signed-contract project evidence is incomplete');
  }
  if (invoice.proposalId !== proposal.id || invoice.clientId !== client.id || invoice.projectId !== project.id
    || invoice.status !== 'PAID' || invoice.currency !== deal.currency) {
    throw new Error('Project invoice evidence is incomplete or currency-inconsistent');
  }
  if (invoice.stripeCheckoutReconciliationRequiredAt || invoice.stripeCheckoutReconciliationReason) {
    throw new Error('Invoice checkout reconciliation remains unresolved');
  }
  const invoiceMinor = exactMinor(invoice.total, 'Invoice total');
  if (payment.invoiceId !== invoice.id || payment.method !== 'STRIPE' || payment.stripeLivemode !== false
    || payment.transactionId !== invoice.stripePaymentIntentId || payment.amountMinor !== invoiceMinor
    || payment.currency !== invoice.currency || payment.settlementEvidenceStatus !== 'VERIFIED') {
    throw new Error('Verified Stripe test payment evidence is incomplete');
  }
  if (![payment.settlementGrossMinor, payment.providerFeeMinor, payment.settlementNetMinor].every(Number.isInteger)
    || payment.settlementGrossMinor - payment.providerFeeMinor !== payment.settlementNetMinor
    || !/^[A-Z]{3}$/.test(payment.settlementCurrency ?? '')) {
    throw new Error('Stripe settlement evidence does not reconcile');
  }
  const acceptedDeliveries = (Array.isArray(invoice.deliveryAttempts) ? invoice.deliveryAttempts : []).filter(attempt => (
    attempt.provider === 'MAILGUN'
    && attempt.providerLifecycleStatus === 'RECIPIENT_SERVER_ACCEPTED'
    && attempt.recipientServerAcceptedAt
  ));
  if (acceptedDeliveries.length !== 1) throw new Error('Sandbox email acceptance evidence is missing or duplicated');
  const [delivery] = acceptedDeliveries;

  const completedAt = Math.max(
    timestamp(contract.signedAt, 'Contract signature time'),
    timestamp(project.createdAt, 'Project creation time'),
    timestamp(invoice.paidAt, 'Invoice payment time'),
    timestamp(payment.settlementReconciledAt, 'Settlement reconciliation time'),
    timestamp(delivery.recipientServerAcceptedAt, 'Email acceptance time'),
  );
  if (completedAt > generated) throw new Error('Journey completion cannot be in the future');

  return {
    format: 'ashbi-controlled-journey-evidence',
    version: 1,
    complete: true,
    organizationId: organization,
    environmentKind: 'sandbox',
    publicSiteRevision: revision(publicSiteRevision, 'Public site revision'),
    hubRevision: revision(hubRevision, 'Hub revision'),
    currency: invoice.currency,
    stripeMode: 'test',
    emailMode: 'sandbox',
    reconciliationPassed: true,
    duplicateWrites: 0,
    manualDatabaseCorrections: 0,
    recordIds: {
      lead: lead.id,
      client: client.id,
      opportunity: deal.id,
      proposal: proposal.id,
      contract: contract.id,
      project: project.id,
      invoice: invoice.id,
      payment: payment.id,
    },
    providerEvidence: {
      stripeLivemode: false,
      paymentSettlementStatus: payment.settlementEvidenceStatus,
      emailProvider: delivery.provider,
      emailLifecycleStatus: delivery.providerLifecycleStatus,
      acceptedEmailDeliveries: 1,
    },
    sandboxReadinessChecks: sandboxReadiness.checks.map(item => ({ id: item.id, ok: true })),
    attestations: {
      noManualDatabaseCorrections: true,
      attestedBy: text(attestation.attestedBy),
      reference: text(attestation.reference),
    },
    completedAt: new Date(completedAt).toISOString(),
    generatedAt: new Date(generated).toISOString(),
  };
}

export async function readControlledJourneySnapshot({ prisma, organizationId, leadId }) {
  const organization = text(organizationId);
  const leadIdentity = text(leadId);
  if (!organization || !leadIdentity) throw new Error('Organization and lead are required');
  const lead = await prisma.lead.findFirst({
    where: { id: leadIdentity, organizationId: organization },
    select: {
      id: true, organizationId: true, status: true, convertedClientId: true,
      convertedDealId: true, intakeIdempotencyKey: true,
    },
  });
  requireRecord(lead, 'Lead');
  const client = await prisma.client.findFirst({
    where: { id: lead.convertedClientId, organizationId: organization, deletedAt: null },
    select: { id: true, organizationId: true },
  });
  requireRecord(client, 'Client');
  const deal = await prisma.pipelineDeal.findFirst({
    where: { id: lead.convertedDealId, clientId: lead.convertedClientId, stage: { organizationId: organization } },
    select: { id: true, clientId: true, currency: true, stage: { select: { organizationId: true } } },
  });
  requireRecord(deal, 'Opportunity');
  deal.organizationId = deal.stage.organizationId;
  const proposal = await prisma.proposal.findFirst({
    where: { dealId: deal?.id, clientId: client?.id, deletedAt: null },
    select: { id: true, dealId: true, clientId: true, projectId: true, status: true, currency: true },
  });
  requireRecord(proposal, 'Proposal');
  const contract = await prisma.contract.findFirst({
    where: { proposalId: proposal?.id, clientId: client?.id, deletedAt: null },
    select: { id: true, proposalId: true, clientId: true, status: true, signedAt: true },
  });
  requireRecord(contract, 'Contract');
  const project = await prisma.project.findFirst({
    where: {
      sourceContractId: contract?.id, clientId: client?.id,
      organizationId: organization, deletedAt: null,
    },
    select: { id: true, clientId: true, organizationId: true, sourceContractId: true, createdAt: true },
  });
  requireRecord(project, 'Project');
  const invoice = await prisma.invoice.findFirst({
    where: {
      proposalId: proposal?.id, clientId: client?.id, projectId: project?.id, deletedAt: null,
    },
    select: {
      id: true, proposalId: true, clientId: true, projectId: true, status: true,
      currency: true, total: true, paidAt: true, stripePaymentIntentId: true,
      stripeCheckoutReconciliationRequiredAt: true, stripeCheckoutReconciliationReason: true,
      deliveryAttempts: {
        select: {
          provider: true, providerLifecycleStatus: true, recipientServerAcceptedAt: true,
        },
      },
    },
  });
  requireRecord(invoice, 'Invoice');
  const payments = await prisma.invoicePayment.findMany({
    where: { invoiceId: invoice.id, method: 'STRIPE' },
    select: {
      id: true, invoiceId: true, method: true, stripeLivemode: true, transactionId: true,
      amountMinor: true, currency: true, settlementEvidenceStatus: true,
      settlementGrossMinor: true, providerFeeMinor: true, settlementNetMinor: true,
      settlementCurrency: true, settlementReconciledAt: true,
    },
  });
  const [inquiryEvents, proposalCount, contractCount, projectCount, invoiceCount] = await Promise.all([
    prisma.leadEvent.count({ where: { leadId: lead.id, organizationId: organization, eventName: 'inquiry_submitted' } }),
    prisma.proposal.count({ where: { dealId: deal?.id, deletedAt: null } }),
    prisma.contract.count({ where: { proposalId: proposal?.id, deletedAt: null } }),
    prisma.project.count({ where: { sourceContractId: contract?.id, deletedAt: null } }),
    prisma.invoice.count({ where: { proposalId: proposal?.id, deletedAt: null } }),
  ]);
  return {
    lead,
    client,
    deal,
    proposal,
    contract,
    project,
    invoice,
    payment: payments[0] ?? null,
    sourceCounts: {
      inquiryEvents,
      lead: 1,
      proposal: proposalCount,
      contract: contractCount,
      project: projectCount,
      invoice: invoiceCount,
      payment: payments.length,
    },
  };
}
