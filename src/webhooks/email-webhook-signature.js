// Signed inbound email webhook (POST /api/webhooks/email).
//
// Header contract (changed by the security audit at 8687cf9, L1):
//   X-Webhook-Timestamp: <unix seconds>
//   X-Webhook-Signature: hex(HMAC-SHA256(WEBHOOK_SECRET, `${timestamp}.${rawBody}`))
// where rawBody is the exact request body bytes. A delivery is accepted only
// within EMAIL_WEBHOOK_MAX_AGE_MS of its timestamp, and each signature only
// once (email_webhook_receipts), so a captured request cannot be replayed.
// This follows the Mailgun events webhook (src/services/mailgun-delivery.service.js).

import crypto from 'node:crypto';

export const EMAIL_WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

export function signEmailWebhook(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * @returns {{ ok: true, signature: string } | { ok: false, reason: 'missing' | 'invalid' | 'stale' }}
 */
export function verifyEmailWebhook({ secret, timestamp, signature, rawBody }, { now = Date.now(), maxAgeMs = EMAIL_WEBHOOK_MAX_AGE_MS } = {}) {
  if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'missing' };
  if (typeof signature !== 'string' || !signature) return { ok: false, reason: 'missing' };
  if (typeof rawBody !== 'string') return { ok: false, reason: 'missing' };
  if (!/^[0-9a-f]{64}$/i.test(signature)) return { ok: false, reason: 'invalid' };
  const expected = Buffer.from(signEmailWebhook(secret, timestamp, rawBody), 'hex');
  const provided = Buffer.from(signature, 'hex');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'invalid' };
  }
  if (Math.abs(now - Number(timestamp) * 1000) > maxAgeMs) return { ok: false, reason: 'stale' };
  return { ok: true, signature: signature.toLowerCase() };
}

/** Record a signature; false when it was already used. Old receipts are pruned. */
export async function claimEmailWebhookSignature(prisma, signature, { now = new Date() } = {}) {
  try {
    await prisma.emailWebhookReceipt.create({ data: { signature, receivedAt: now } });
  } catch (err) {
    if (/** @type {any} */ (err)?.code === 'P2002') return false;
    throw err;
  }
  const cutoff = new Date(now.getTime() - 2 * EMAIL_WEBHOOK_MAX_AGE_MS);
  await prisma.emailWebhookReceipt.deleteMany({ where: { receivedAt: { lt: cutoff } } }).catch(() => {});
  return true;
}

export async function releaseEmailWebhookSignature(prisma, signature) {
  await prisma.emailWebhookReceipt.deleteMany({ where: { signature } }).catch(() => {});
}
