import crypto from 'node:crypto';
import { safeEqual } from '../utils/crypto.js';

const MAX_SIGNATURE_AGE_SECONDS = 9 * 60 * 60;
const MAX_FUTURE_SKEW_SECONDS = 5 * 60;

export function verifyMailgunDeliverySignature({ signingKey, signature, now = new Date() }) {
  const timestamp = String(signature?.timestamp ?? '');
  const token = String(signature?.token ?? '');
  const supplied = String(signature?.signature ?? '');
  const timestampSeconds = Number(timestamp);
  const nowSeconds = now.getTime() / 1000;

  if (!signingKey || !timestamp || !token || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  if (!Number.isFinite(timestampSeconds)) return false;
  if (timestampSeconds < nowSeconds - MAX_SIGNATURE_AGE_SECONDS) return false;
  if (timestampSeconds > nowSeconds + MAX_FUTURE_SKEW_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', signingKey)
    .update(`${timestamp}${token}`)
    .digest('hex');
  return safeEqual(expected, supplied);
}

function normalizeMessageId(value) {
  return String(value ?? '').trim().replace(/^<|>$/g, '');
}

function nonRetryableError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.nonRetryable = true;
  return error;
}

export function normalizeMailgunDeliveryEvent(eventData) {
  const providerEventId = String(eventData?.id ?? '').trim();
  const messageId = normalizeMessageId(eventData?.message?.headers?.['message-id']);
  const recipient = String(eventData?.recipient ?? '').trim().toLowerCase();
  const timestamp = Number(eventData?.timestamp);

  const isDelivered = eventData?.event === 'delivered';
  const isTemporaryFailure = eventData?.event === 'failed' && eventData?.severity === 'temporary';
  const isPermanentFailure = eventData?.event === 'failed' && eventData?.severity === 'permanent';
  if (!isDelivered && !isTemporaryFailure && !isPermanentFailure) {
    throw nonRetryableError('MAILGUN_EVENT_UNSUPPORTED', 'Unsupported Mailgun delivery event');
  }
  if (!providerEventId || !messageId || !recipient || !Number.isFinite(timestamp)) {
    throw nonRetryableError('MAILGUN_EVENT_INCOMPLETE', 'Incomplete Mailgun delivery event');
  }

  const type = isDelivered
    ? 'RECIPIENT_SERVER_ACCEPTED'
    : isTemporaryFailure
      ? 'TEMPORARY_DELIVERY_FAILURE'
      : 'PERMANENT_DELIVERY_FAILURE';
  const providerEventKey = crypto
    .createHash('sha256')
    .update(`MAILGUN\n${providerEventId}\n${timestamp}\n${messageId}\n${type}`)
    .digest('hex');

  return {
    provider: 'MAILGUN',
    providerEventId,
    providerEventKey,
    messageId,
    recipient,
    type,
    occurredAt: new Date(timestamp * 1000),
    failureCode: isTemporaryFailure
      ? 'MAILGUN_TEMPORARY_FAILURE'
      : isPermanentFailure
        ? 'MAILGUN_PERMANENT_FAILURE'
        : null,
  };
}

function lifecycleUpdate(normalized) {
  const data = {
    status: 'PROVIDER_ACCEPTED',
    failureCode: null,
    providerLifecycleStatus: normalized.type,
    lastProviderEventAt: normalized.occurredAt,
  };
  if (normalized.type === 'RECIPIENT_SERVER_ACCEPTED') {
    data.recipientServerAcceptedAt = normalized.occurredAt;
  } else if (normalized.type === 'TEMPORARY_DELIVERY_FAILURE') {
    data.temporaryFailureAt = normalized.occurredAt;
  } else {
    data.permanentFailureAt = normalized.occurredAt;
  }
  return data;
}

export async function reconcileInvoiceDeliveryProviderEvent({ prisma, eventData }) {
  const normalized = normalizeMailgunDeliveryEvent(eventData);

  try {
    return await prisma.$transaction(async transaction => {
      const existing = await transaction.invoiceDeliveryEvent.findUnique({
        where: { providerEventKey: normalized.providerEventKey },
      });
      if (existing) {
        return {
          duplicate: true,
          attemptId: existing.attemptId,
          invoiceId: existing.invoiceId,
          type: existing.status,
          stateApplied: false,
        };
      }

      const attempt = await transaction.invoiceDeliveryAttempt.findFirst({
        where: {
          provider: 'MAILGUN',
          providerMessageId: { in: [normalized.messageId, `<${normalized.messageId}>`] },
          status: { in: ['PROVIDER_ACCEPTED', 'OUTCOME_UNKNOWN'] },
        },
      });
      if (!attempt) {
        throw nonRetryableError(
          'MAILGUN_ATTEMPT_NOT_FOUND',
          'Mailgun event did not match an invoice delivery attempt',
        );
      }
      if (normalized.recipient !== '[redacted]'
        && normalized.recipient !== String(attempt.recipient).trim().toLowerCase()) {
        throw nonRetryableError(
          'MAILGUN_RECIPIENT_MISMATCH',
          'Mailgun event recipient did not match the invoice delivery attempt',
        );
      }

      await transaction.invoiceDeliveryEvent.create({
        data: {
          attemptId: attempt.id,
          invoiceId: attempt.invoiceId,
          status: normalized.type,
          providerMessageId: normalized.messageId,
          failureCode: normalized.failureCode,
          providerEventId: normalized.providerEventId,
          providerEventKey: normalized.providerEventKey,
          providerOccurredAt: normalized.occurredAt,
        },
      });
      const updated = await transaction.invoiceDeliveryAttempt.updateMany({
        where: {
          id: attempt.id,
          OR: [
            { lastProviderEventAt: null },
            { lastProviderEventAt: { lt: normalized.occurredAt } },
          ],
        },
        data: lifecycleUpdate(normalized),
      });

      return {
        duplicate: false,
        attemptId: attempt.id,
        invoiceId: attempt.invoiceId,
        type: normalized.type,
        stateApplied: updated.count === 1,
      };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const existing = await prisma.invoiceDeliveryEvent.findUnique({
      where: { providerEventKey: normalized.providerEventKey },
    });
    if (!existing) throw error;
    return {
      duplicate: true,
      attemptId: existing.attemptId,
      invoiceId: existing.invoiceId,
      type: existing.status,
      stateApplied: false,
    };
  }
}
