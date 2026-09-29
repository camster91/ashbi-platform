// OAuth `state` for the Google Calendar and Slack installs.
//
// The state round-trips through the provider's authorize URL, so it lands in
// browser history and provider logs. It is an HS256 token signed with a key
// *derived* from JWT_SECRET per purpose (the same construction as
// src/auth/reauth.js), never with the session key: a state token can never be
// replayed as a bearer session, and a session can never pass as a state. It is
// verified only by its own OAuth callback.

import crypto from 'node:crypto';
import env from '../config/env.js';
import { safeEqual } from '../utils/crypto.js';

export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
export const OAUTH_STATE_PURPOSES = Object.freeze(['google_calendar_oauth', 'slack_oauth']);

function stateKey(purpose) {
  const secret = process.env.JWT_SECRET || env.jwtSecret;
  if (!secret) throw new Error('JWT_SECRET is required for OAuth state');
  return crypto.createHmac('sha256', secret).update(`ashbi:oauth-state:v1:${purpose}`).digest();
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function hmac(purpose, input) {
  return crypto.createHmac('sha256', stateKey(purpose)).update(input).digest('base64url');
}

function assertPurpose(purpose) {
  if (!OAUTH_STATE_PURPOSES.includes(purpose)) throw new Error(`Unknown OAuth state purpose: ${purpose}`);
}

/**
 * @param {string} purpose one of OAUTH_STATE_PURPOSES
 * @param {{ organizationId: string, userId: string }} claims
 */
export function signOAuthState(purpose, { organizationId, userId }, { nowMs = Date.now(), ttlSeconds = OAUTH_STATE_TTL_SECONDS } = {}) {
  assertPurpose(purpose);
  const iat = Math.floor(nowMs / 1000);
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    typ: purpose,
    type: purpose,
    organizationId,
    userId,
    nonce: crypto.randomBytes(16).toString('base64url'),
    iat,
    exp: iat + ttlSeconds,
  });
  return `${header}.${payload}.${hmac(purpose, `${header}.${payload}`)}`;
}

/** Returns the claims, or null when forged, for another purpose, malformed or expired. */
export function verifyOAuthState(purpose, token, { nowMs = Date.now() } = {}) {
  assertPurpose(purpose);
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!safeEqual(signature, hmac(purpose, `${header}.${payload}`))) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims?.typ !== purpose || typeof claims.organizationId !== 'string' || typeof claims.userId !== 'string') return null;
  if (!Number.isInteger(claims.exp) || claims.exp <= Math.floor(nowMs / 1000)) return null;
  return claims;
}

// Browser binding. /oauth/start also sets an httpOnly cookie holding the
// state's nonce, and the callback accepts the state only together with that
// cookie, then clears it. A state captured from a URL or log is useless
// without the initiating browser's cookie, and a completed flow cannot be
// replayed from that browser either. (A thief holding both the URL and the
// browser's cookie within the 10-minute window is not stopped; the provider's
// one-time authorization code bounds that case.)
export function oauthStateCookieName(purpose) {
  assertPurpose(purpose);
  return `oauth_state_${purpose}`;
}

function oauthStateCookieOptions({ isDeployed = env.isDeployed } = {}) {
  // lax: the provider's redirect back is a top-level cross-site GET navigation.
  return { path: '/api', httpOnly: true, secure: isDeployed, sameSite: 'lax' };
}

/** Sign a state and bind it to this browser. Returns the state to put in the authorize URL. */
export function issueOAuthState(reply, purpose, claims) {
  const state = signOAuthState(purpose, claims);
  const { nonce } = JSON.parse(Buffer.from(state.split('.')[1], 'base64url').toString('utf8'));
  reply.setCookie(oauthStateCookieName(purpose), nonce, { ...oauthStateCookieOptions(), maxAge: OAUTH_STATE_TTL_SECONDS });
  return state;
}

/**
 * Verify a callback's state against its signature, purpose, expiry and the
 * browser's binding cookie; the cookie is cleared either way. Returns the
 * claims or null.
 */
export function consumeOAuthState(request, reply, purpose, state) {
  const cookieName = oauthStateCookieName(purpose);
  const bound = request.cookies?.[cookieName];
  reply.clearCookie(cookieName, oauthStateCookieOptions());
  const claims = verifyOAuthState(purpose, state);
  if (!claims || typeof bound !== 'string' || !safeEqual(bound, claims.nonce)) return null;
  return claims;
}
