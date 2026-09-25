// Step-up re-authentication for privileged actions (#416).
//
// POST /api/auth/reauth proves the signed-in user is still at the keyboard
// (password, or a TOTP / recovery code when two-factor is on) and sets a
// short-lived `reauth` cookie. `requireRecentAuth` then gates the privileged
// routes listed in docs/privileged-actions.md.
//
// The cookie is an HS256 JWT signed with a key *derived* from JWT_SECRET
// (never the session key itself), so it can never be replayed as a session
// token and a session token can never pass as a re-authentication. It is bound
// to the user id, the account's sessionVersion and the issuing session's
// `jti` (or `iat` when the session has no jti), so it dies with the session:
// signing out, a password change, an MFA change or any other revocation makes
// it stale, and it cannot be moved to another session of the same user.

import crypto from 'node:crypto';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { recordAuditEvent } from '../services/audit-event.service.js';
import { safeEqual } from '../utils/crypto.js';

export const REAUTH_COOKIE = 'reauth';
// Proposal for owner approval (docs/privileged-actions.md): 10 minutes.
export const REAUTH_TTL_SECONDS = 10 * 60;
export const REAUTH_REQUIRED_CODE = 'REAUTH_REQUIRED';

const TOKEN_TYPE = 'reauth';

function reauthKey() {
  const secret = process.env.JWT_SECRET || env.jwtSecret;
  if (!secret) throw new Error('JWT_SECRET is required for re-authentication');
  return crypto.createHmac('sha256', secret).update('ashbi:reauth:v1').digest();
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function hmac(input) {
  return crypto.createHmac('sha256', reauthKey()).update(input).digest('base64url');
}

/** The session binding: the session token's jti, else its iat, else null. */
export function sessionBinding(sessionPayload) {
  if (typeof sessionPayload?.jti === 'string' && sessionPayload.jti) return `jti:${sessionPayload.jti}`;
  if (Number.isInteger(sessionPayload?.iat)) return `iat:${sessionPayload.iat}`;
  return null;
}

/**
 * Sign a re-authentication token for the given session.
 * @param {{ id: string, sessionVersion: number, jti?: string, iat?: number }} session
 */
export function signReauthToken(session, { nowMs = Date.now(), ttlSeconds = REAUTH_TTL_SECONDS } = {}) {
  const iat = Math.floor(nowMs / 1000);
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    typ: TOKEN_TYPE,
    sub: session.id,
    sv: session.sessionVersion,
    sid: sessionBinding(session),
    iat,
    exp: iat + ttlSeconds,
  });
  return `${header}.${payload}.${hmac(`${header}.${payload}`)}`;
}

/** Returns the payload, or null when forged, malformed, or expired. */
export function verifyReauthToken(token, { nowMs = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!safeEqual(signature, hmac(`${header}.${payload}`))) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims?.typ !== TOKEN_TYPE || typeof claims.sub !== 'string') return null;
  if (!Number.isInteger(claims.exp) || claims.exp <= Math.floor(nowMs / 1000)) return null;
  return claims;
}

export function reauthCookieOptions({ isProduction = env.isProduction } = {}) {
  return {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: REAUTH_TTL_SECONDS,
  };
}

/** Options for clearing the cookie; must match name, path, secure and sameSite. */
export function clearReauthCookieOptions({ isProduction = env.isProduction } = {}) {
  const { maxAge: _maxAge, ...options } = reauthCookieOptions({ isProduction });
  return options;
}

/**
 * Why the request has no usable re-authentication, or null when it has one.
 * `request.user` must already be the verified, current session (the route's
 * `fastify.authenticate` / `fastify.adminOnly` guard runs first).
 * @returns {null | 'missing' | 'invalid' | 'other_user' | 'stale'}
 */
export function recentAuthProblem(request, { nowMs = Date.now() } = {}) {
  const token = request.cookies?.[REAUTH_COOKIE];
  if (!token) return 'missing';
  let claims;
  try {
    claims = verifyReauthToken(token, { nowMs });
  } catch {
    claims = null; // no signing key: fail closed
  }
  if (!claims) return 'invalid';
  const session = request.user;
  if (!session?.id || claims.sub !== session.id) return 'other_user';
  if (claims.sv !== session.sessionVersion) return 'stale';
  const binding = sessionBinding(session);
  if (!binding || claims.sid !== binding) return 'stale';
  return null;
}

export function sendReauthRequired(reply) {
  return reply.status(403).send({
    error: 'Confirm your identity to continue.',
    code: REAUTH_REQUIRED_CODE,
  });
}

/**
 * preHandler: reject with 403 REAUTH_REQUIRED unless the caller
 * re-authenticated within the window, as this user, in this session.
 * Use after a session guard; it is not an authentication guard by itself.
 */
export async function requireRecentAuth(request, reply) {
  if (recentAuthProblem(request) !== null) return sendReauthRequired(reply);
  return undefined;
}

// ---------------------------------------------------------------------------
// Failed re-authentication audit throttle
//
// Like auth.login_failed: at most one auth.reauth_failed event per account per
// window, so repeated wrong passwords cannot flood audit_events. The per-IP
// route rate limit bounds attempts; this bounds rows.

export const REAUTH_FAILURE_AUDIT_WINDOW_MS = 60_000;
const REAUTH_FAILURE_MEMORY_LIMIT = 10_000;
const recentReauthFailureAudits = new Map();

/** Test hook: forget the in-process throttle state. */
export function resetReauthFailureAuditThrottle() {
  recentReauthFailureAudits.clear();
}

/**
 * Record auth.reauth_failed { reason } for a signed-in user, throttled.
 * Never throws; resolves to the written row or null.
 */
export async function auditReauthFailure(prisma, request, user, reason) {
  try {
    if (!user?.organizationId) return null;
    const now = Date.now();
    const last = recentReauthFailureAudits.get(user.id);
    if (last !== undefined && now - last < REAUTH_FAILURE_AUDIT_WINDOW_MS) return null;
    if (recentReauthFailureAudits.size >= REAUTH_FAILURE_MEMORY_LIMIT) recentReauthFailureAudits.clear();
    recentReauthFailureAudits.set(user.id, now);
    const recent = await prisma.auditEvent.findFirst({
      where: {
        organizationId: user.organizationId,
        action: 'auth.reauth_failed',
        entityType: 'user',
        entityId: user.id,
        createdAt: { gte: new Date(now - REAUTH_FAILURE_AUDIT_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (recent) return null;
    return await recordAuditEvent(prisma, {
      organizationId: user.organizationId,
      actorType: 'USER',
      actorUserId: user.id,
      action: 'auth.reauth_failed',
      entityId: user.id,
      requestId: request.id,
      ip: request.ip,
      metadata: { reason },
    });
  } catch (err) {
    logger.warn({ err: { message: err?.message } }, 'Re-authentication failure audit failed');
    return null;
  }
}
