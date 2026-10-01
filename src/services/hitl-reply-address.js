// Unforgeable, notification-bound reply addresses for HITL emails.
//
// A HITL email's Reply-To is reply+<notificationId>.<token>@<mailgun domain>,
// where token = lowercase hex of HMAC-SHA256(key, "hitl-reply:" + id),
// truncated to 32 characters (128 bits). The key is derived from
// HITL_REPLY_SECRET, or from JWT_SECRET when that is unset, so knowing a
// notification id is not enough to address a reply to it.
//
// The whole address is case-insensitive: notification ids are cuids
// (lowercase alphanumeric) and the token is lowercase hex, so an MTA,
// forwarder or client that folds the local part's case does not break it.

import crypto from 'node:crypto';
import env from '../config/env.js';

export const HITL_REPLY_TOKEN_LENGTH = 32;
export const HITL_REPLY_SECRET_MIN_BYTES = 32;
const KEY_CONTEXT = 'ashbi-hitl-reply-address-v1';
const ADDRESS_PATTERN = /^reply\+([a-z0-9_-]+)\.([0-9a-f]+)@/i;

let warnedShortSecret = false;

function replySecret() {
  const dedicated = env.hitlReplySecret;
  if (dedicated && Buffer.byteLength(dedicated) >= HITL_REPLY_SECRET_MIN_BYTES) return dedicated;
  if (dedicated && !warnedShortSecret) {
    // Deployed environments refuse to start with this (src/config/env.js).
    warnedShortSecret = true;
    console.warn(`[hitl-reply] HITL_REPLY_SECRET is shorter than ${HITL_REPLY_SECRET_MIN_BYTES} bytes; using the key derived from JWT_SECRET`);
  }
  return env.jwtSecret;
}

function replyKey() {
  const secret = replySecret();
  if (!secret) throw new Error('HITL reply addresses need HITL_REPLY_SECRET or JWT_SECRET');
  return crypto.createHmac('sha256', secret).update(KEY_CONTEXT).digest();
}

/** The reply token for one notification (lowercase hex). */
export function hitlReplyToken(notificationId) {
  return crypto
    .createHmac('sha256', replyKey())
    .update(`hitl-reply:${String(notificationId).toLowerCase()}`)
    .digest('hex')
    .slice(0, HITL_REPLY_TOKEN_LENGTH);
}

/** reply+<notificationId>.<token>@<domain> */
export function hitlReplyAddress(notificationId, domain) {
  return `reply+${notificationId}.${hitlReplyToken(notificationId)}@${domain}`;
}

/**
 * The (lower-cased) notification id of a reply address whose token is valid,
 * or null for a missing, malformed or forged token. Case-insensitive;
 * compared in constant time.
 * @param {unknown} recipient
 */
export function verifyHitlReplyRecipient(recipient) {
  if (typeof recipient !== 'string') return null;
  const match = ADDRESS_PATTERN.exec(recipient.trim());
  if (!match) return null;
  const notificationId = match[1].toLowerCase();
  const token = match[2].toLowerCase();
  if (token.length !== HITL_REPLY_TOKEN_LENGTH) return null;
  const expected = Buffer.from(hitlReplyToken(notificationId));
  const provided = Buffer.from(token);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  return notificationId;
}
