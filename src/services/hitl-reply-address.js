// Unforgeable, notification-bound reply addresses for HITL emails.
//
// A HITL email's Reply-To is reply+<notificationId>.<token>@<mailgun domain>,
// where token = base64url(HMAC-SHA256(key, "hitl-reply:" + notificationId))
// truncated to 22 characters (132 bits). The key is derived from
// HITL_REPLY_SECRET, or from JWT_SECRET when that is unset, so knowing a
// notification id is not enough to address a reply to it.

import crypto from 'node:crypto';
import env from '../config/env.js';

export const HITL_REPLY_TOKEN_LENGTH = 22;
const KEY_CONTEXT = 'ashbi-hitl-reply-address-v1';
const ADDRESS_PATTERN = /^reply\+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)@/;

function replyKey() {
  const secret = env.hitlReplySecret || env.jwtSecret;
  if (!secret) throw new Error('HITL reply addresses need HITL_REPLY_SECRET or JWT_SECRET');
  return crypto.createHmac('sha256', secret).update(KEY_CONTEXT).digest();
}

/** The reply token for one notification. */
export function hitlReplyToken(notificationId) {
  return crypto
    .createHmac('sha256', replyKey())
    .update(`hitl-reply:${notificationId}`)
    .digest('base64url')
    .slice(0, HITL_REPLY_TOKEN_LENGTH);
}

/** reply+<notificationId>.<token>@<domain> */
export function hitlReplyAddress(notificationId, domain) {
  return `reply+${notificationId}.${hitlReplyToken(notificationId)}@${domain}`;
}

/**
 * The notification id of a reply address whose token is valid, or null for a
 * missing, malformed or forged token. Compared in constant time.
 * @param {unknown} recipient
 */
export function verifyHitlReplyRecipient(recipient) {
  if (typeof recipient !== 'string') return null;
  const match = ADDRESS_PATTERN.exec(recipient.trim());
  if (!match) return null;
  const [, notificationId, token] = match;
  if (token.length !== HITL_REPLY_TOKEN_LENGTH) return null;
  const expected = Buffer.from(hitlReplyToken(notificationId));
  const provided = Buffer.from(token);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  return notificationId;
}
