import crypto from 'crypto';
import { safeEqual } from '../utils/crypto.js';

const SLACK_SIGNATURE_VERSION = 'v0';
const DEFAULT_MAX_AGE_SECONDS = 300;

/**
 * Validate Slack's signed-event protocol without parsing or reserializing the
 * payload. Slack signs the raw HTTP body, so even harmless JSON formatting
 * changes must invalidate the request.
 */
export function verifySlackEventRequest({
  rawBody,
  timestamp,
  signature,
  signingSecret,
  now = Date.now(),
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
}) {
  if (!signingSecret || typeof rawBody !== 'string' || !/^\d+$/.test(timestamp || '')) {
    return { valid: false, reason: 'invalid_signature' };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Math.floor(now / 1000) - timestampSeconds) > maxAgeSeconds) {
    return { valid: false, reason: 'stale_timestamp' };
  }

  const expected = `${SLACK_SIGNATURE_VERSION}=${crypto
    .createHmac('sha256', signingSecret)
    .update(`${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`)
    .digest('hex')}`;

  return safeEqual(expected, signature)
    ? { valid: true }
    : { valid: false, reason: 'invalid_signature' };
}
