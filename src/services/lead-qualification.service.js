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

    const existingContact = await transaction.contact.findFirst({
      where: { email: { equals: lead.email, mode: 'insensitive' } },
      select: { id: true, clientId: true },
    });
    let clientId = existingContact?.clientId;
    const reusedClient = Boolean(clientId);
    if (!clientId) {
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
      clientId = client.id;
      await transaction.contact.create({
        data: {
          email: lead.email,
          name: lead.name,
          isPrimary: true,
          clientId,
        },
      });
    }

    await transaction.lead.update({
      where: { id: lead.id },
      data: {
        status: 'CONVERTED',
        convertedClientId: clientId,
        convertedAt: now,
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
