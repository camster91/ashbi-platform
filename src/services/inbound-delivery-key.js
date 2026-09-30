// Stable keys for inbound email deliveries.
//
// Every inbound delivery carries a key that stays the same when the same
// delivery is processed again (a BullMQ retry, a deliberate replay, a
// provider's resend). The email pipeline stores it on the first record it
// creates (a thread or an unmatched email, both behind a unique index), so a
// retry resumes that record instead of creating a duplicate.

import crypto from 'node:crypto';

// Longer keys are hashed so the unique index stays compact.
export const MAX_INBOUND_DELIVERY_KEY_LENGTH = 200;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** A trimmed, non-empty key of bounded length, or null when there is none. */
export function normalizeInboundDeliveryKey(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (!key) return null;
  return key.length > MAX_INBOUND_DELIVERY_KEY_LENGTH ? `sha256:${sha256(key)}` : key;
}

// JSON with object keys sorted at every level, so the same delivery hashes
// the same however its fields were ordered by the body parser.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date)) {
    return `{${Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Mailgun inbound route delivery: the provider's Message-Id when present,
 * otherwise a hash of the whole delivery as received.
 */
export function mailgunInboundDeliveryKey(body) {
  const fields = body && typeof body === 'object' ? body : {};
  const rawMessageId = fields['Message-Id'] ?? fields['message-id'];
  const messageId = typeof rawMessageId === 'string' ? rawMessageId.trim() : '';
  if (messageId) return normalizeInboundDeliveryKey(`mailgun:${messageId}`);
  return `mailgun-sha256:${sha256(stableStringify(fields))}`;
}
