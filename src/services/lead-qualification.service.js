export class LeadQualificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LeadQualificationError';
    this.code = code;
  }
}

export async function updateLeadQualification({
  prisma,
  leadId,
  status,
  qualificationNotes,
  qualificationReasonCode,
  nextAction,
  nextActionDueAt,
  actorUserId,
  now = new Date(),
}) {
  return prisma.$transaction(async (transaction) => {
    const lead = await transaction.lead.findFirst({
      where: { id: leadId },
      select: { id: true, status: true, convertedClientId: true },
    });
    if (!lead) throw new LeadQualificationError('LEAD_NOT_FOUND', 'Lead not found');
    if (lead.convertedClientId || lead.status === 'CONVERTED') {
      throw new LeadQualificationError('LEAD_ALREADY_CONVERTED', 'Converted leads cannot be reopened');
    }
    if (lead.status === 'CONVERTING') {
      throw new LeadQualificationError('LEAD_CONVERSION_IN_PROGRESS', 'Lead conversion is already in progress');
    }

    const updated = await transaction.lead.update({
      where: { id: lead.id },
      data: {
        status,
        qualificationNotes: qualificationNotes?.trim() || null,
        qualificationReasonCode: status === 'DISQUALIFIED' ? qualificationReasonCode : null,
        nextAction: ['REVIEWING', 'QUALIFIED', 'NURTURE'].includes(status) ? nextAction?.trim() || null : null,
        nextActionDueAt: ['REVIEWING', 'QUALIFIED', 'NURTURE'].includes(status) && nextActionDueAt
          ? new Date(nextActionDueAt)
          : null,
        ...(status === 'QUALIFIED' ? { qualifiedAt: now } : {}),
      },
    });
    await transaction.leadEvent.create({
      data: {
        leadId: lead.id,
        eventName: 'qualification_updated',
        properties: {
          fromStatus: lead.status,
          toStatus: status,
          actorUserId,
          qualificationReasonCode: status === 'DISQUALIFIED' ? qualificationReasonCode : null,
          nextActionDueAt: ['REVIEWING', 'QUALIFIED', 'NURTURE'].includes(status) ? nextActionDueAt : null,
        },
        occurredAt: now,
      },
    });
    return updated;
  });
}

function idempotentConversion(leadId, clientId) {
  return { leadId, clientId, idempotent: true, reusedClient: true };
}

function idempotentPromotion(lead) {
  return {
    leadId: lead.id,
    clientId: lead.convertedClientId,
    dealId: lead.convertedDealId,
    idempotent: true,
  };
}

async function createOrReuseClient(transaction, lead) {
  const existingContact = await transaction.contact.findFirst({
    where: { email: { equals: lead.email, mode: 'insensitive' } },
    select: { id: true, clientId: true },
  });
  if (existingContact?.clientId) {
    return { clientId: existingContact.clientId, reusedClient: true };
  }

  const client = await transaction.client.create({
    data: {
      name: lead.company || lead.name,
      email: lead.email,
      status: 'ACTIVE',
      contactPerson: lead.name,
      phone: lead.phone,
      serviceType: lead.serviceLine,
      relationshipStatus: 'ACTIVE',
    },
    select: { id: true },
  });
  await transaction.contact.create({
    data: {
      email: lead.email,
      name: lead.name,
      isPrimary: true,
      clientId: client.id,
    },
  });
  return { clientId: client.id, reusedClient: false };
}

export async function convertQualifiedLead({ prisma, leadId, actorUserId, now = new Date() }) {
  return prisma.$transaction(async (transaction) => {
    const lead = await transaction.lead.findFirst({
      where: { id: leadId },
      select: {
        id: true,
        status: true,
        convertedClientId: true,
        name: true,
        email: true,
        company: true,
        phone: true,
        serviceLine: true,
      },
    });
    if (!lead) throw new LeadQualificationError('LEAD_NOT_FOUND', 'Lead not found');
    if (lead.convertedClientId || lead.status === 'CONVERTED') {
      if (!lead.convertedClientId) {
        throw new LeadQualificationError('LEAD_CONVERSION_INCOMPLETE', 'Converted lead has no linked client');
      }
      return idempotentConversion(lead.id, lead.convertedClientId);
    }
    if (lead.status !== 'QUALIFIED') {
      throw new LeadQualificationError('LEAD_NOT_QUALIFIED', 'Lead must be qualified before conversion');
    }

    const claim = await transaction.lead.updateMany({
      where: { id: lead.id, status: 'QUALIFIED', convertedClientId: null },
      data: { status: 'CONVERTING' },
    });
    if (claim.count !== 1) {
      const reconciled = await transaction.lead.findFirst({
        where: { id: lead.id },
        select: { id: true, status: true, convertedClientId: true },
      });
      if (reconciled?.convertedClientId && reconciled.status === 'CONVERTED') {
        return idempotentConversion(reconciled.id, reconciled.convertedClientId);
      }
      throw new LeadQualificationError('LEAD_CONVERSION_IN_PROGRESS', 'Lead conversion is already in progress');
    }

    const { clientId, reusedClient } = await createOrReuseClient(transaction, lead);

    await transaction.lead.update({
      where: { id: lead.id },
      data: {
        status: 'CONVERTED',
        convertedClientId: clientId,
        convertedAt: now,
        nextAction: null,
        nextActionDueAt: null,
      },
    });
    await transaction.leadEvent.create({
      data: {
        leadId: lead.id,
        eventName: 'lead_converted',
        properties: { actorUserId, clientId, reusedClient },
        occurredAt: now,
      },
    });
    return { leadId: lead.id, clientId, idempotent: false, reusedClient };
  });
}

export async function promoteQualifiedLeadToDeal({ prisma, leadId, actorUserId, deal, now = new Date() }) {
  return prisma.$transaction(async (transaction) => {
    const lead = await transaction.lead.findFirst({
      where: { id: leadId },
      select: {
        id: true,
        status: true,
        convertedClientId: true,
        convertedDealId: true,
        convertedAt: true,
        name: true,
        email: true,
        company: true,
        phone: true,
        serviceLine: true,
      },
    });
    if (!lead) throw new LeadQualificationError('LEAD_NOT_FOUND', 'Lead not found');
    if (lead.convertedDealId) {
      if (!lead.convertedClientId) {
        throw new LeadQualificationError('LEAD_CONVERSION_INCOMPLETE', 'Promoted lead has no linked client');
      }
      return idempotentPromotion(lead);
    }
    if (!['QUALIFIED', 'CONVERTED'].includes(lead.status)) {
      throw new LeadQualificationError('LEAD_NOT_QUALIFIED', 'Lead must be qualified before pipeline promotion');
    }
    if (lead.status === 'CONVERTED' && !lead.convertedClientId) {
      throw new LeadQualificationError('LEAD_CONVERSION_INCOMPLETE', 'Converted lead has no linked client');
    }

    const stage = await transaction.pipelineStage.findFirst({
      where: { id: deal.stageId },
      select: { id: true },
    });
    if (!stage) {
      throw new LeadQualificationError('PIPELINE_STAGE_NOT_FOUND', 'Pipeline stage not found');
    }

    const claim = await transaction.lead.updateMany({
      where: { id: lead.id, status: lead.status, convertedDealId: null },
      data: { status: 'CONVERTING' },
    });
    if (claim.count !== 1) {
      const reconciled = await transaction.lead.findFirst({
        where: { id: lead.id },
        select: { id: true, convertedClientId: true, convertedDealId: true },
      });
      if (reconciled?.convertedClientId && reconciled.convertedDealId) {
        return idempotentPromotion(reconciled);
      }
      throw new LeadQualificationError('LEAD_CONVERSION_IN_PROGRESS', 'Lead conversion is already in progress');
    }

    let clientId = lead.convertedClientId;
    let reusedClient = Boolean(clientId);
    if (!clientId) {
      ({ clientId, reusedClient } = await createOrReuseClient(transaction, lead));
    }

    const pipelineDeal = await transaction.pipelineDeal.create({
      data: {
        title: deal.name.trim(),
        clientId,
        stageId: stage.id,
        value: deal.value ?? 0,
        currency: deal.currency,
        source: 'WEBSITE',
        contactPerson: lead.name,
      },
      select: { id: true },
    });
    await transaction.lead.update({
      where: { id: lead.id },
      data: {
        status: 'CONVERTED',
        convertedClientId: clientId,
        convertedDealId: pipelineDeal.id,
        convertedAt: lead.convertedAt || now,
        nextAction: null,
        nextActionDueAt: null,
      },
    });
    await transaction.leadEvent.create({
      data: {
        leadId: lead.id,
        eventName: 'lead_promoted_to_pipeline',
        properties: {
          actorUserId,
          clientId,
          dealId: pipelineDeal.id,
          stageId: stage.id,
          reusedClient,
          currency: deal.currency,
        },
        occurredAt: now,
      },
    });
    return { leadId: lead.id, clientId, dealId: pipelineDeal.id, idempotent: false };
  });
}
