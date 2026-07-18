// tests/e2e/helpers/hmac.mjs
//
// Wire-format helpers for the magic-login E2E test.
//
// Two HMAC flavours are in play, both verified against live source:
//
//   PLUGIN-SIDE — `hash_hmac('sha256', body, secret)` (lowercase hex)
//                 Sent as `X-ASHBI-SIGNATURE: <hex>` (raw hex, NO prefix)
//                 Source: includes/class-ashbi-auth.php:verify_signature
//                 Usage: hub → plugin POST /wp-json/ashbi/v1/{health,
//                        magic-login, magic-login/revoke}
//
//   HUB-SIDE    — `HMAC_SHA256(_timestamp + body, WP_BRIDGE_SECRET)`
//                 Sent as `X-Ashbi-Signature: sha256=<hex>` (sha256= prefix)
//                 Source: src/routes/wp-bridge.routes.js:verifyPluginHmac
//                 Usage: plugin → hub POST/PUT /api/wp-bridge
//
// Token-level hashing for magic-login (PR #37 + PR-F):
//   - hash_token(token) = sha256(token) lowercase hex (64 chars)
//     Source: includes/class-ashbi-magic-login.php:hash_token
//   - revoke_by_hash validates `^[0-9a-f]{64}$` STRICT (rejects uppercase).
//     Source: includes/class-ashbi-magic-login.php:looks_like_hash_strict

import { createHash, createHmac } from 'node:crypto';

const REPLAY_WINDOW_SECONDS = 300;

export function nowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Sign a request body the way the HUB expects from the PLUGIN.
 * Use this when calling POST/PUT /api/wp-bridge from the test (acting as
 * the plugin). Hub verifies sha256(_timestamp + body) with WP_BRIDGE_SECRET.
 */
export function signHubRequest({ body, secret }) {
  const ts = nowTimestamp();
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = createHmac('sha256', secret)
    .update(String(ts) + rawBody)
    .digest('hex');
  return {
    'X-Ashbi-Signature': `sha256=${sig}`,
    'X-Ashbi-Timestamp': String(ts),
    'Content-Type': 'application/json'
  };
}

/**
 * Sign a request body the way the PLUGIN expects from the HUB.
 * Use this when calling POST /wp-json/ashbi/v1/{health,magic-login,...}
 * from the test (acting as the hub). Plugin verifies sha256(body) with
 * ashbi_secret_key.
 *
 * Body must include `_timestamp` (or `timestamp`) for replay protection.
 * The plugin reads `_timestamp` first, falling back to `timestamp`.
 *   Source: includes/class-ashbi-auth.php:verify_signature (replay block).
 */
export function signPluginRequest({ body, secret, timestamp }) {
  const ts = timestamp ?? nowTimestamp();
  // Merge _timestamp + timestamp into the body so the plugin's replay
  // window check passes.
  const payload = typeof body === 'string'
    ? body
    : JSON.stringify({ _timestamp: ts, timestamp: ts, ...body });
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return {
    'X-ASHBI-SIGNATURE': sig,
    'Content-Type': 'application/json'
  };
}

/**
 * sha256 hex of a string. Used to compute the tokenHash that the hub
 * persists in wp_magic_login_log + the plugin stores in its ring-buffered
 * wp_options audit log (under OPTION_AUDIT_LOG = 'ashbi_magic_login_log',
 * field name `magic_token_hash`).
 */
export function sha256Hex(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

export const REPLAY_WINDOW = REPLAY_WINDOW_SECONDS;
export function freshTimestamp() { return nowTimestamp(); }