import crypto from 'node:crypto';

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function safeReferrer(value) {
  if (!value) return null;
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '');
}

export function normalizePublicInquiry(value) {
  const attribution = {
    landingPage: String(value.attribution.landingPage).trim(),
    referrer: safeReferrer(value.attribution.referrer),
    source: text(value.attribution.source),
    medium: text(value.attribution.medium),
    campaign: text(value.attribution.campaign),
    clickId: text(value.attribution.clickId),
  };
  const normalized = {
    idempotencyKey: String(value.idempotencyKey).trim(),
    name: String(value.name).trim(),
    email: String(value.email).trim().toLowerCase(),
    company: text(value.company),
    phone: text(value.phone),
    serviceLine: value.serviceLine,
    businessContext: String(value.businessContext).trim(),
    requestedOutcome: String(value.requestedOutcome).trim(),
    timing: value.timing ?? null,
    budgetBand: value.budgetBand ?? null,
    budgetCurrency: value.budgetCurrency ?? null,
    privacyVersion: value.privacyVersion,
    attribution,
  };
  return {
    ...normalized,
    payloadHash: crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
  };
}

export class PublicInquiryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PublicInquiryError';
    this.code = code;
  }
}

export async function createPublicInquiry({ prisma, organizationId, ownerUserId, inquiry, now = new Date() }) {
  if (!organizationId || !ownerUserId) {
    throw new PublicInquiryError('INTAKE_DISABLED', 'Public intake is not configured');
  }
  const normalized = normalizePublicInquiry(inquiry);
  const uniqueWhere = {
    organizationId_intakeIdempotencyKey: {
      organizationId,
      intakeIdempotencyKey: normalized.idempotencyKey,
    },
  };

  try {
    return await prisma.$transaction(async (transaction) => {
      const owner = await transaction.user.findFirst({
        where: { id: ownerUserId, organizationId, isActive: true },
        select: { id: true },
      });
      if (!owner) throw new PublicInquiryError('INTAKE_DISABLED', 'Public intake owner is unavailable');

      const existing = await transaction.lead.findUnique({
        where: uniqueWhere,
        select: { id: true, intakePayloadHash: true },
      });
      if (existing?.intakePayloadHash === normalized.payloadHash) {
        return { id: existing.id, idempotent: true };
      }
      if (existing) {
        throw new PublicInquiryError('IDEMPOTENCY_CONFLICT', 'Inquiry key was already used for different content');
      }
      const lead = await transaction.lead.create({
        data: {
          organizationId,
          name: normalized.name,
          email: normalized.email,
          company: normalized.company,
          phone: normalized.phone,
          serviceLine: normalized.serviceLine,
          businessContext: normalized.businessContext,
          requestedOutcome: normalized.requestedOutcome,
          timing: normalized.timing,
          budgetBand: normalized.budgetBand,
          budgetCurrency: normalized.budgetCurrency,
          status: 'NEW',
          source: normalized.attribution.source,
          medium: normalized.attribution.medium,
          campaign: normalized.attribution.campaign,
          landingPage: normalized.attribution.landingPage,
          referrer: normalized.attribution.referrer,
          clickId: normalized.attribution.clickId,
          consentVersion: normalized.privacyVersion,
          consentAt: now,
          intakeIdempotencyKey: normalized.idempotencyKey,
          intakePayloadHash: normalized.payloadHash,
          accountOwnerId: owner.id,
        },
      });
      await transaction.leadEvent.create({
        data: {
          organizationId,
          leadId: lead.id,
          eventName: 'inquiry_submitted',
          properties: {
            serviceLine: normalized.serviceLine,
            source: normalized.attribution.source,
            medium: normalized.attribution.medium,
            campaign: normalized.attribution.campaign,
          },
          occurredAt: now,
        },
      });
      await transaction.notification.create({
        data: {
          userId: owner.id,
          type: 'lead.inquiry_received',
          title: 'New website inquiry',
          message: `${normalized.name}${normalized.company ? ` from ${normalized.company}` : ''} submitted a ${normalized.serviceLine} inquiry.`,
          data: { leadId: lead.id, serviceLine: normalized.serviceLine },
        },
      });
      return { id: lead.id, idempotent: false };
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const existing = await prisma.lead.findUnique({
      where: uniqueWhere,
      select: { id: true, intakePayloadHash: true },
    });
    if (existing?.intakePayloadHash === normalized.payloadHash) {
      return { id: existing.id, idempotent: true };
    }
    throw new PublicInquiryError('IDEMPOTENCY_CONFLICT', 'Inquiry key was already used for different content');
  }
}
