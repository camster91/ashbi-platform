// HMAC client for signing outgoing hub→plugin requests.
//
// Wire format (PR #17 contract; matches the /api/wp-bridge/backup verifier
// in src/routes/wp-bridge.routes.js, `verifyBackupHmac`):
//
//   X-Ashbi-Timestamp: <unix seconds, integer>
//   X-Ashbi-Signature: sha256=<hex(hmac_sha256(secret, timestamp + raw_body))>
//
// The signature is computed over the byte-for-byte raw request body — NOT a
// re-serialized JSON. To stay wire-compatible with the plugin-side verifier,
// callers must:
//   1. Serialize their body once (JSON.stringify)
//   2. Pass that exact string to `signRequest` as `body`
//   3. Send the same string as the fetch `body` field
// Re-serializing at fetch-time would break verification.
//
// The `method` and `path` parameters are part of the API surface for future
// extensions (e.g. signing over `method + path + timestamp + body` like
// AWS SigV4) — current contract signs only `timestamp + raw_body`.

import crypto from 'node:crypto';

/**
 * Sign a hub→plugin request body with the shared secret.
 *
 * @param {object}   params
 * @param {string}   params.method    - HTTP method (currently informational, NOT in canonical string)
 * @param {string}   params.path      - request path (currently informational, NOT in canonical string)
 * @param {string}   params.body      - EXACT raw body bytes (already serialized)
 * @param {string}   params.secret    - shared HMAC secret (must match plugin's WP_BRIDGE_SECRET)
 * @param {number}   params.timestamp - unix seconds, integer (defaults to now)
 *
 * @returns {{ 'X-Ashbi-Signature': string, 'X-Ashbi-Timestamp': string }}
 *   - 'X-Ashbi-Signature' is in the form 'sha256=<64-hex-chars>'
 *   - 'X-Ashbi-Timestamp' is the integer unix-seconds string used in the canonical string
 *
 * @throws {TypeError} if `secret` is missing/empty (cannot sign with empty key)
 * @throws {TypeError} if `body` is not a string (callers MUST pass the exact bytes)
 */
export function signRequest({ method, path, body, secret, timestamp } = {}) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new TypeError('signRequest: `secret` must be a non-empty string');
  }
  if (typeof body !== 'string') {
    // String is enforced so callers cannot accidentally pass an object that
    // would get re-serialized differently at fetch-time, breaking verification.
    throw new TypeError('signRequest: `body` must be the exact raw string (already JSON.stringify\'d)');
  }
  // method/path are accepted for API symmetry with future versions; not used
  // in the canonical string for now. Reference them so the linter doesn't
  // flag them as unused and so callers see the contract in the signature.
  void method;
  void path;

  const ts = Number.isFinite(timestamp) ? Math.floor(timestamp) : Math.floor(Date.now() / 1000);
  const canonical = String(ts) + body;
  const hex = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  return {
    'X-Ashbi-Signature': `sha256=${hex}`,
    'X-Ashbi-Timestamp': String(ts)
  };
}

/**
 * Verify a signature against the same canonical string. Used by tests and
 * by the plugin-side verifier mirror. Returns true on match.
 *
 * Timing-safe: uses crypto.timingSafeEqual on equal-length buffers. Returns
 * false (never throws) on length mismatch or malformed input.
 *
 * @param {object} params
 * @param {string} params.signatureHeader - value of X-Ashbi-Signature header ('sha256=<hex>')
 * @param {string|number} params.timestamp - unix seconds (matches what was signed)
 * @param {string} params.body - exact raw body
 * @param {string} params.secret - shared HMAC secret
 * @returns {boolean}
 */
export function verifyRequest({ signatureHeader, timestamp, body, secret } = {}) {
  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) return false;
  if (typeof secret !== 'string' || secret.length === 0) return false;
  if (typeof body !== 'string') return false;

  const providedHex = signatureHeader.slice('sha256='.length);
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(String(timestamp) + body)
    .digest('hex');

  let providedBuf;
  let expectedBuf;
  try {
    providedBuf = Buffer.from(providedHex, 'hex');
    expectedBuf = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}