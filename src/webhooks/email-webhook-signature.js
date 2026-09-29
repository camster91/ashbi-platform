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
 * Claim lease. The handler renews it every EMAIL_WEBHOOK_CLAIM_RENEW_MS while
 * it processes, so a live delivery keeps its claim however long the pipeline
 * takes; only a claim whose handler died (renewals stopped) expires and can be
 * taken over by a retry, while the delivery's timestamp is still in the window.
 */
export const EMAIL_WEBHOOK_CLAIM_LEASE_MS = 60 * 1000;
export const EMAIL_WEBHOOK_CLAIM_RENEW_MS = 20 * 1000;

/**
 * Claim a signature for processing. Returns the claim's owner token, or null
 * when the delivery was already processed or its claim is still live.
 * Renewal, completion and release are fenced by that token, so a handler
 * whose claim was taken over can never touch the new owner's receipt.
 * Old receipts are pruned.
 * @returns {Promise<string | null>}
 */
export async function claimEmailWebhookSignature(prisma, signature, { now = new Date(), leaseMs = EMAIL_WEBHOOK_CLAIM_LEASE_MS } = {}) {
  const claimToken = crypto.randomUUID();
  let claimed = false;
  try {
    await prisma.emailWebhookReceipt.create({ data: { signature, receivedAt: now, claimToken } });
    claimed = true;
  } catch (err) {
    if (/** @type {any} */ (err)?.code !== 'P2002') throw err;
    // Take over a dead claim: never finished and not renewed within the lease.
    const takeover = await prisma.emailWebhookReceipt.updateMany({
      where: { signature, processedAt: null, receivedAt: { lt: new Date(now.getTime() - leaseMs) } },
      data: { receivedAt: now, claimToken },
    });
    claimed = takeover.count === 1;
  }
  if (!claimed) return null;
  const cutoff = new Date(now.getTime() - 2 * EMAIL_WEBHOOK_MAX_AGE_MS);
  await prisma.emailWebhookReceipt.deleteMany({ where: { receivedAt: { lt: cutoff } } }).catch(() => {});
  return claimToken;
}

/** Extend a live claim; false when it is no longer this owner's. */
export async function renewEmailWebhookClaim(prisma, signature, claimToken, { now = new Date() } = {}) {
  const renewed = await prisma.emailWebhookReceipt.updateMany({
    where: { signature, claimToken, processedAt: null },
    data: { receivedAt: now },
  });
  return renewed.count === 1;
}

/** The delivery was processed: from now on it is only ever a replay. */
export async function markEmailWebhookProcessed(prisma, signature, claimToken, { now = new Date() } = {}) {
  await prisma.emailWebhookReceipt.updateMany({ where: { signature, claimToken }, data: { processedAt: now } });
}

export async function releaseEmailWebhookSignature(prisma, signature, claimToken) {
  await prisma.emailWebhookReceipt.deleteMany({ where: { signature, claimToken, processedAt: null } }).catch(() => {});
}
