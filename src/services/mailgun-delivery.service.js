// Mailgun delivery tracking for client-facing revenue documents.
//
// Outgoing document emails carry `v:` custom variables naming the document
// type and id. Mailgun echoes those back as `user-variables` on every
// delivery event, which the signed /api/mailgun/events webhook uses to record
// delivered / failed / bounced / complained on the document itself. Without
// this a document kept looking "sent" after the provider later bounced it.

import crypto from 'crypto';

export const DOCUMENT_TYPE_VARIABLE = 'ashbi-document-type';
export const DOCUMENT_ID_VARIABLE = 'ashbi-document-id';

// Maps the document type carried in the custom variable to its Prisma delegate.
export const TRACKED_DOCUMENT_DELEGATES = Object.freeze({
  invoice: 'invoice',
  proposal: 'proposal',
  contract: 'contract',
  estimate: 'estimate',
});

export const DELIVERY_STATUS = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  BOUNCED: 'BOUNCED',
  COMPLAINED: 'COMPLAINED',
});

const FAILED_STATUSES = new Set([DELIVERY_STATUS.FAILED, DELIVERY_STATUS.BOUNCED, DELIVERY_STATUS.COMPLAINED]);

// A later event may only move a message "forward": a stray `delivered` must
// not erase a recorded bounce or complaint for the same message.
const STATUS_RANK = {
  [DELIVERY_STATUS.ACCEPTED]: 0,
  [DELIVERY_STATUS.DELIVERED]: 1,
  [DELIVERY_STATUS.FAILED]: 2,
  [DELIVERY_STATUS.BOUNCED]: 2,
  [DELIVERY_STATUS.COMPLAINED]: 3,
};

export const MAILGUN_SIGNATURE_MAX_AGE_MS = 15 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;

/**
 * Mailgun custom variables (`v:` form fields) that correlate delivery events
 * back to a document. Returns {} for anything that is not a tracked document.
 */
export function mailgunTrackingFields({ documentType, documentId } = {}) {
  if (!TRACKED_DOCUMENT_DELEGATES[documentType] || typeof documentId !== 'string' || !documentId) return {};
  return {
    [`v:${DOCUMENT_TYPE_VARIABLE}`]: documentType,
    [`v:${DOCUMENT_ID_VARIABLE}`]: documentId,
  };
}

/** Mailgun returns `<id@domain>` on send but bare `id@domain` in events. */
export function normalizeMessageId(messageId) {
  if (typeof messageId !== 'string') return null;
  const trimmed = messageId.trim().replace(/^<|>$/g, '');
  return trimmed || null;
}

/**
 * Verify a Mailgun webhook signature block ({ timestamp, token, signature }).
 * HMAC-SHA256(timestamp + token) with the webhook signing key, compared in
 * constant time, and rejected when the timestamp is outside the freshness
 * window so captured payloads cannot be replayed later.
 */
export function verifyMailgunSignature(signatureBlock, signingKey, { now = Date.now(), maxAgeMs = MAILGUN_SIGNATURE_MAX_AGE_MS } = {}) {
  const { timestamp, token, signature } = signatureBlock || {};
  if (!signingKey) return { ok: false, reason: 'not_configured' };
  if (typeof timestamp !== 'string' && typeof timestamp !== 'number') return { ok: false, reason: 'missing' };
  if (typeof token !== 'string' || !token || typeof signature !== 'string' || !signature) return { ok: false, reason: 'missing' };
  if (!/^[0-9a-f]{64}$/i.test(signature)) return { ok: false, reason: 'invalid' };

  const expected = crypto.createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest();
  const provided = Buffer.from(signature, 'hex');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'invalid' };
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now - seconds * 1000) > maxAgeMs) {
    return { ok: false, reason: 'stale' };
  }
  return { ok: true };
}

/** Map a Mailgun event to a delivery status, or null when it is not tracked. */
export function classifyMailgunEvent(eventData) {
  const event = eventData?.event;
  if (event === 'delivered') return DELIVERY_STATUS.DELIVERED;
  if (event === 'complained') return DELIVERY_STATUS.COMPLAINED;
  if (event === 'bounced') return DELIVERY_STATUS.BOUNCED;
  if (event === 'dropped') return DELIVERY_STATUS.FAILED;
  if (event === 'failed') {
    // Temporary failures are retried by Mailgun and may still be delivered.
    if (eventData.severity && eventData.severity !== 'permanent') return null;
    return ['bounce', 'suppress-bounce'].includes(eventData.reason)
      ? DELIVERY_STATUS.BOUNCED
      : DELIVERY_STATUS.FAILED;
  }
  return null;
}

function describeFailure(eventData) {
  const status = eventData?.['delivery-status'] || {};
  const parts = [eventData?.reason, status.code, status.description || status.message]
    .filter(value => value !== undefined && value !== null && value !== '')
    .map(String);
  const text = parts.join(' — ') || String(eventData?.event || 'failed');
  return text.slice(0, MAX_ERROR_LENGTH);
}

export function isDeliveryFailed(status) {
  return FAILED_STATUSES.has(status);
}

/** Adds the derived `deliveryFailed` flag used by API consumers and the UI. */
export function withDeliveryState(document) {
  if (!document) return document;
  return { ...document, deliveryFailed: isDeliveryFailed(document.deliveryStatus) };
}

/**
 * Document fields to persist right after a send attempt. A provider rejection
 * is recorded as FAILED instead of leaving the document looking delivered.
 */
export function deliveryFieldsFromSend(result, now = new Date()) {
  if (result?.ok) {
    return {
      deliveryMessageId: normalizeMessageId(result.id),
      deliveryStatus: DELIVERY_STATUS.ACCEPTED,
      deliveryStatusAt: now,
      deliveryError: null,
    };
  }
  return {
    deliveryMessageId: null,
    deliveryStatus: DELIVERY_STATUS.FAILED,
    deliveryStatusAt: now,
    deliveryError: String(result?.error || 'Email delivery failed').slice(0, MAX_ERROR_LENGTH),
  };
}

/**
 * Apply one verified Mailgun event to the document it names. Events for an
 * older message (the document was re-sent since) and events that would move
 * the status backwards are ignored.
 */
export async function recordDeliveryEvent(prisma, eventData) {
  const status = classifyMailgunEvent(eventData);
  if (!status) return { recorded: false, reason: 'ignored_event' };

  const variables = eventData?.['user-variables'] || {};
  const delegateName = TRACKED_DOCUMENT_DELEGATES[variables[DOCUMENT_TYPE_VARIABLE]];
  const documentId = variables[DOCUMENT_ID_VARIABLE];
  if (!delegateName || typeof documentId !== 'string' || !documentId) return { recorded: false, reason: 'uncorrelated' };

  const delegate = prisma[delegateName];
  const document = await delegate.findUnique({
    where: { id: documentId },
    select: { id: true, deliveryMessageId: true, deliveryStatus: true },
  });
  if (!document) return { recorded: false, reason: 'not_found' };

  const eventMessageId = normalizeMessageId(eventData?.message?.headers?.['message-id']);
  const storedMessageId = normalizeMessageId(document.deliveryMessageId);
  // Both ids must be present and equal. Skipping the check when either is
  // missing would let a captured signed payload without message headers set
  // any status on any document id, and let a late event for an older message
  // overwrite the outcome of a newer (failed, id-less) re-send.
  if (!eventMessageId || !storedMessageId) return { recorded: false, reason: 'uncorrelated_message' };
  if (storedMessageId !== eventMessageId) return { recorded: false, reason: 'stale_message' };
  if (document.deliveryStatus && (STATUS_RANK[status] ?? 0) < (STATUS_RANK[document.deliveryStatus] ?? 0)) {
    return { recorded: false, reason: 'superseded' };
  }

  const occurredAt = Number.isFinite(Number(eventData?.timestamp)) ? new Date(Number(eventData.timestamp) * 1000) : new Date();
  // Conditional on the message id so a concurrent re-send is never overwritten.
  const updated = await delegate.updateMany({
    where: { id: document.id, deliveryMessageId: document.deliveryMessageId },
    data: {
      deliveryStatus: status,
      deliveryStatusAt: occurredAt,
      deliveryError: status === DELIVERY_STATUS.DELIVERED ? null : describeFailure(eventData),
    },
  });
  if (updated.count === 0) return { recorded: false, reason: 'stale_message' };
  return { recorded: true, status, documentType: delegateName, documentId: document.id };
}

/**
 * Claim a webhook token so the same signed payload cannot be applied twice.
 * Returns false when the token was already used. Old tokens (beyond twice the
 * freshness window, after which the signature check rejects them anyway) are
 * pruned opportunistically.
 */
export async function claimWebhookToken(prisma, token, { now = new Date() } = {}) {
  try {
    await prisma.mailgunWebhookReceipt.create({ data: { token, receivedAt: now } });
  } catch (err) {
    if (err?.code === 'P2002') return false;
    throw err;
  }
  const cutoff = new Date(now.getTime() - 2 * MAILGUN_SIGNATURE_MAX_AGE_MS);
  await prisma.mailgunWebhookReceipt.deleteMany({ where: { receivedAt: { lt: cutoff } } }).catch(() => {});
  return true;
}

export async function releaseWebhookToken(prisma, token) {
  await prisma.mailgunWebhookReceipt.deleteMany({ where: { token } }).catch(() => {});
}
