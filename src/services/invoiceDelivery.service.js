import { sendInvoiceDeliveryEmail } from './email.service.js';

const FINAL_STATUSES = new Set(['PROVIDER_ACCEPTED', 'FAILED', 'OUTCOME_UNKNOWN', 'CANCELED']);

function publicAttempt(attempt, duplicate = false) {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    kind: attempt.kind,
    recipient: attempt.recipient,
    status: attempt.status,
    provider: attempt.provider,
    providerMessageId: attempt.providerMessageId || null,
    failureCode: attempt.failureCode || null,
    retryable: attempt.status === 'FAILED',
    reconciliationRequired: attempt.status === 'OUTCOME_UNKNOWN',
    duplicate,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}

async function createPreparedAttempt({ prisma, invoiceId, requestId, kind, recipient, actorUserId }) {
  const existing = await prisma.invoiceDeliveryAttempt.findUnique({ where: { requestId } });
  if (existing) return { attempt: existing, duplicate: true };

  return prisma.$transaction(async transaction => {
    const claimed = await transaction.invoice.update({
      where: { id: invoiceId },
      data: { emailDeliveryAttempt: { increment: 1 } },
      select: { emailDeliveryAttempt: true },
    });
    const attempt = await transaction.invoiceDeliveryAttempt.create({
      data: {
        invoiceId,
        requestId,
        attemptNumber: claimed.emailDeliveryAttempt,
        kind,
        recipient,
        status: 'PREPARED',
        provider: 'MAILGUN',
        requestedById: actorUserId,
      },
    });
    await transaction.invoiceDeliveryEvent.create({
      data: { attemptId: attempt.id, invoiceId, status: 'PREPARED' },
    });
    return { attempt, duplicate: false };
  }, { isolationLevel: 'Serializable' });
}

export async function deliverInvoiceWithEvidence({
  prisma,
  invoiceId,
  requestId,
  kind,
  recipient,
  actorUserId,
  email,
  sender = sendInvoiceDeliveryEmail,
}) {
  if (!requestId) throw new Error('Invoice delivery request id is required');
  const prepared = await createPreparedAttempt({ prisma, invoiceId, requestId, kind, recipient, actorUserId });
  if (prepared.duplicate) return publicAttempt(prepared.attempt, true);

  let result;
  try {
    result = await sender({ ...email, to: recipient });
  } catch {
    result = { ok: false, outcome: 'OUTCOME_UNKNOWN', failureCode: 'TRANSPORT_UNKNOWN' };
  }

  const status = FINAL_STATUSES.has(result?.outcome)
    ? result.outcome
    : (result?.ok ? 'PROVIDER_ACCEPTED' : 'OUTCOME_UNKNOWN');
  const failureCode = status === 'PROVIDER_ACCEPTED'
    ? null
    : (result?.failureCode || (status === 'FAILED' ? 'PROVIDER_REJECTED' : 'TRANSPORT_UNKNOWN'));
  const now = new Date();
  const timestamp = status === 'PROVIDER_ACCEPTED'
    ? { acceptedAt: now }
    : status === 'FAILED'
      ? { failedAt: now }
      : status === 'OUTCOME_UNKNOWN'
        ? { outcomeUnknownAt: now }
        : { canceledAt: now };

  const attempt = await prisma.$transaction(async transaction => {
    const updated = await transaction.invoiceDeliveryAttempt.update({
      where: { id: prepared.attempt.id },
      data: {
        status,
        providerMessageId: result?.id || null,
        failureCode,
        ...timestamp,
      },
    });
    await transaction.invoiceDeliveryEvent.create({
      data: {
        attemptId: updated.id,
        invoiceId,
        status,
        providerMessageId: result?.id || null,
        failureCode,
      },
    });
    return updated;
  });

  return publicAttempt(attempt);
}
