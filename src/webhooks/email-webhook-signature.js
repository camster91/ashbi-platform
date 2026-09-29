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

/**
 * How long an unfinished claim blocks a retry of the same delivery. A claim is
 * finished when the email was processed; one whose processing was interrupted
 * (the process died, or releasing it failed) is taken over by a retry after
 * the lease, while the delivery's timestamp is still inside the window.
 */
export const EMAIL_WEBHOOK_CLAIM_LEASE_MS = 2 * 60 * 1000;

/**
 * Claim a signature for processing. False when the delivery was already
 * processed, or is being processed now (a claim younger than the lease).
 * Old receipts are pruned.
 */
export async function claimEmailWebhookSignature(prisma, signature, { now = new Date(), leaseMs = EMAIL_WEBHOOK_CLAIM_LEASE_MS } = {}) {
  let claimed = false;
  try {
    await prisma.emailWebhookReceipt.create({ data: { signature, receivedAt: now } });
    claimed = true;
  } catch (err) {
    if (/** @type {any} */ (err)?.code !== 'P2002') throw err;
    // Take over an interrupted claim: never finished and older than the lease.
    const takeover = await prisma.emailWebhookReceipt.updateMany({
      where: { signature, processedAt: null, receivedAt: { lt: new Date(now.getTime() - leaseMs) } },
      data: { receivedAt: now },
    });
    claimed = takeover.count === 1;
  }
  if (!claimed) return false;
  const cutoff = new Date(now.getTime() - 2 * EMAIL_WEBHOOK_MAX_AGE_MS);
  await prisma.emailWebhookReceipt.deleteMany({ where: { receivedAt: { lt: cutoff } } }).catch(() => {});
  return true;
}

/** The delivery was processed: from now on it is only ever a replay. */
export async function markEmailWebhookProcessed(prisma, signature, { now = new Date() } = {}) {
  await prisma.emailWebhookReceipt.updateMany({ where: { signature }, data: { processedAt: now } });
}

export async function releaseEmailWebhookSignature(prisma, signature) {
  await prisma.emailWebhookReceipt.deleteMany({ where: { signature } }).catch(() => {});
}
