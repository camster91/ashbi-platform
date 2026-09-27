// Audited, read-only support impersonation ("view as") for #416.
// Policy: docs/privileged-actions.md#support-impersonation.
//
// An ADMIN who re-authenticated in the last few minutes may view the app as a
// TEAM or CLIENT member of their own organization, for a fixed window and
// with a written reason. The admin's own session cookie (`token`) is never
// replaced: a second httpOnly cookie (`imp`) names an `impersonation_sessions`
// row, and on every /api request the global hook in src/index.js swaps
// `request.user` for the subject only after checking, against the database,
// that
//
//   - the admin's session is still current (sessionVersion + session binding
//     identical to the ones recorded when the view started),
//   - the row is open, unexpired and belongs to the admin's organization,
//   - the subject is still an active TEAM/CLIENT member of that organization.
//
// While the view is active every mutating request is refused with
// 403 IMPERSONATION_READ_ONLY, and the sensitive areas in BLOCKED_PREFIXES are
// refused for every method with 403 IMPERSONATION_BLOCKED. Stopping, signing
// out and expiry end the view; the admin's own session was never touched, so
// it simply takes over again.

import crypto from 'node:crypto';
import env from '../config/env.js';
import defaultLogger from '../utils/logger.js';
import { safeEqual } from '../utils/crypto.js';
import { sessionBinding } from './reauth.js';
import { recordAuditEvent } from '../services/audit-event.service.js';

export const IMPERSONATION_COOKIE = 'imp';
// Proposal for owner approval (docs/privileged-actions.md): 30 minutes, not
// renewable. The database allows at most 60 (CHECK constraint).
export const IMPERSONATION_TTL_SECONDS = 30 * 60;
export const IMPERSONATION_REASON_MIN = 10;
export const IMPERSONATION_REASON_MAX = 500;
export const IMPERSONATABLE_ROLES = Object.freeze(['TEAM', 'CLIENT']);

export const IMPERSONATION_READ_ONLY_CODE = 'IMPERSONATION_READ_ONLY';
export const IMPERSONATION_BLOCKED_CODE = 'IMPERSONATION_BLOCKED';

export const IMPERSONATION_END_REASONS = Object.freeze([
  'stopped', 'expired', 'superseded', 'signed_out',
  'revoked_password_reset', 'revoked_role_change', 'revoked_deactivated', 'revoked_password_change',
]);

const TOKEN_TYPE = 'impersonation';

// ---------------------------------------------------------------------------
// Token (cookie value)

function impersonationKey() {
  const secret = process.env.JWT_SECRET || env.jwtSecret;
  if (!secret) throw new Error('JWT_SECRET is required for impersonation');
  return crypto.createHmac('sha256', secret).update('ashbi:impersonation:v1').digest();
}

function hmac(input) {
  return crypto.createHmac('sha256', impersonationKey()).update(input).digest('base64url');
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Sign the cookie value. It carries both identities (actor and subject), the
 * organization, and the admin's session binding, and is signed with a key
 * derived from JWT_SECRET that is used for nothing else, so it can never pass
 * as a session or re-authentication token.
 * @param {{ sessionId: string, actor: { id: string, organizationId: string, sessionVersion: number, jti?: string, iat?: number }, subjectUserId: string, expiresAt: Date }} input
 */
export function signImpersonationToken({ sessionId, actor, subjectUserId, expiresAt }, { nowMs = Date.now() } = {}) {
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    typ: TOKEN_TYPE,
    sid: sessionId,
    act: actor.id,
    sub: subjectUserId,
    org: actor.organizationId,
    asv: actor.sessionVersion,
    abind: sessionBinding(actor),
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
  });
  return `${header}.${payload}.${hmac(`${header}.${payload}`)}`;
}

/**
 * Returns the claims (with `expired: true` once past `exp`), or null when the
 * token is forged or malformed.
 */
export function verifyImpersonationToken(token, { nowMs = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  let expected;
  try {
    expected = hmac(`${header}.${payload}`);
  } catch {
    return null; // no signing key: fail closed
  }
  if (!safeEqual(signature, expected)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims?.typ !== TOKEN_TYPE) return null;
  for (const field of ['sid', 'act', 'sub', 'org']) {
    if (typeof claims[field] !== 'string' || !claims[field]) return null;
  }
  if (!Number.isInteger(claims.exp) || !Number.isInteger(claims.asv)) return null;
  return { ...claims, expired: claims.exp <= Math.floor(nowMs / 1000) };
}

export function impersonationCookieOptions({ isProduction = env.isProduction, maxAgeSeconds = IMPERSONATION_TTL_SECONDS } = {}) {
  return {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}

/** Options for clearing the cookie; must match name, path, secure and sameSite. */
export function clearImpersonationCookieOptions({ isProduction = env.isProduction } = {}) {
  const { maxAge: _maxAge, ...options } = impersonationCookieOptions({ isProduction });
  return options;
}

// ---------------------------------------------------------------------------
// Request policy while impersonating

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The only writes an impersonated request may make: ending the view.
const ALLOWED_MUTATIONS = new Set([
  'POST /api/auth/impersonation/stop',
  'POST /api/auth/logout',
]);

// Refused for every method (reads included) while impersonating. Proposal for
// owner approval (docs/privileged-actions.md). Everything behind
// requireRecentAuth is refused as well, by requireRecentAuth itself.
export const IMPERSONATION_BLOCKED_PREFIXES = Object.freeze([
  '/api/auth/mfa', // two-factor status, enrollment, disable, admin reset
  '/api/auth/reauth', // step-up
  '/api/auth/change-password',
  '/api/auth/register',
  '/api/auth/break-glass',
  '/api/api-keys', // API key management
  '/api/credentials', // credential vault
  '/api/ai-connections', // AI provider keys (BYOK)
  '/api/ai-tools/approvals', // AI tool approvals
  '/api/settings/ai-provider',
  '/api/settings/ai-kill-switch',
  '/api/audit-events', // an admin reads the log as themselves
  '/api/push', // device (push subscription) management
]);

function pathOf(url) {
  const raw = String(url || '');
  const query = raw.indexOf('?');
  return query === -1 ? raw : raw.slice(0, query);
}

function matchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Why an impersonated request must be refused, or null when it may proceed.
 * @param {string} method
 * @param {string} url
 * @returns {null | { status: 403, code: string, error: string }}
 */
export function impersonationDenial(method, url) {
  const verb = String(method || 'GET').toUpperCase();
  const path = pathOf(url);
  if (verb === 'POST' && path === '/api/auth/impersonation') {
    return { status: 403, code: IMPERSONATION_BLOCKED_CODE, error: 'Stop viewing as this person before starting another view.' };
  }
  if (IMPERSONATION_BLOCKED_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) {
    return { status: 403, code: IMPERSONATION_BLOCKED_CODE, error: 'This area is not available while viewing as another person.' };
  }
  if (SAFE_METHODS.has(verb) || ALLOWED_MUTATIONS.has(`${verb} ${path}`)) return null;
  return { status: 403, code: IMPERSONATION_READ_ONLY_CODE, error: 'Read only: changes are not allowed while viewing as another person.' };
}

// ---------------------------------------------------------------------------
// Validation

/**
 * Why `actor` may not start viewing as `subject`, or null when allowed.
 * Both are database rows (not token claims).
 * @returns {null | { status: number, code: string, error: string }}
 */
export function impersonationStartProblem(actor, subject) {
  if (!actor || actor.role !== 'ADMIN' || actor.isActive !== true) {
    return { status: 403, code: 'IMPERSONATION_NOT_ALLOWED', error: 'Admin access required' };
  }
  if (!subject || subject.organizationId !== actor.organizationId) {
    // Same answer as a missing user: never confirm another tenant's ids.
    return { status: 404, code: 'IMPERSONATION_TARGET_NOT_FOUND', error: 'Team member not found' };
  }
  if (subject.id === actor.id) {
    return { status: 400, code: 'IMPERSONATION_SELF', error: 'You cannot view as yourself.' };
  }
  if (!IMPERSONATABLE_ROLES.includes(subject.role)) {
    return { status: 403, code: 'IMPERSONATION_TARGET_FORBIDDEN', error: 'Only team members and client users can be viewed as; never another administrator.' };
  }
  if (env.platformOperatorUserIds.includes(subject.id)) {
    return { status: 403, code: 'IMPERSONATION_TARGET_FORBIDDEN', error: 'Platform operators cannot be viewed as.' };
  }
  if (subject.isActive !== true) {
    return { status: 409, code: 'IMPERSONATION_TARGET_INACTIVE', error: 'This account is deactivated.' };
  }
  return null;
}

const SUBJECT_SELECT = {
  id: true, email: true, name: true, role: true, clientId: true,
  organizationId: true, isActive: true, sessionVersion: true,
};

/** The portal contact a CLIENT user signs in as, or null. */
export async function findPortalContact(prisma, subject) {
  if (subject?.role !== 'CLIENT' || !subject.clientId) return null;
  return prisma.contact.findFirst({
    where: { clientId: subject.clientId, email: { equals: subject.email, mode: 'insensitive' } },
    select: { id: true },
  });
}

function subjectClaims(subject, row, contactId) {
  return {
    id: subject.id,
    email: subject.email,
    name: subject.name,
    role: subject.role,
    clientId: subject.clientId ?? null,
    organizationId: subject.organizationId,
    sessionVersion: subject.sessionVersion,
    ...(contactId ? { contactId } : {}),
    impersonation: {
      sessionId: row.id,
      actorUserId: row.actorUserId,
      expiresAt: row.expiresAt,
      readOnly: true,
    },
  };
}

/**
 * Resolve the impersonation cookie for a request whose `request.user` is the
 * verified, current admin session.
 *
 * @returns {Promise<
 *   | { status: 'none' }
 *   | { status: 'invalid' }
 *   | { status: 'expired', sessionId: string }
 *   | { status: 'active', context: ImpersonationContext }
 * >}
 *
 * @typedef {{ sessionId: string, organizationId: string, actorUserId: string,
 *   actorName: string, subjectUserId: string, subjectName: string, subjectRole: string,
 *   startedAt: Date, expiresAt: Date, reason: string, readOnly: true, user: Record<string, any> }} ImpersonationContext
 */
export async function resolveImpersonation(prisma, request, { nowMs = Date.now() } = {}) {
  const token = request.cookies?.[IMPERSONATION_COOKIE];
  if (!token) return { status: 'none' };
  const claims = verifyImpersonationToken(token, { nowMs });
  if (!claims) return { status: 'invalid' };

  const admin = request.user;
  if (!admin?.id || admin.id !== claims.act || admin.organizationId !== claims.org || admin.role !== 'ADMIN') {
    return { status: 'invalid' };
  }
  if (admin.sessionVersion !== claims.asv || sessionBinding(admin) !== claims.abind) return { status: 'invalid' };

  const row = await prisma.impersonationSession.findFirst({
    where: { id: claims.sid, organizationId: claims.org, actorUserId: claims.act, subjectUserId: claims.sub },
  });
  if (!row || row.endedAt) return { status: 'invalid' };
  if (claims.expired || row.expiresAt.getTime() <= nowMs) return { status: 'expired', sessionId: row.id };

  const [subject, actor] = await Promise.all([
    prisma.user.findFirst({ where: { id: row.subjectUserId, organizationId: row.organizationId }, select: SUBJECT_SELECT }),
    prisma.user.findFirst({ where: { id: row.actorUserId, organizationId: row.organizationId }, select: { id: true, name: true, role: true, isActive: true } }),
  ]);
  if (!actor || actor.role !== 'ADMIN' || !actor.isActive) return { status: 'invalid' };
  if (!subject || !subject.isActive || subject.role !== row.subjectRole || !IMPERSONATABLE_ROLES.includes(subject.role)) {
    return { status: 'invalid' };
  }
  let contactId = null;
  if (subject.role === 'CLIENT') {
    const contact = await findPortalContact(prisma, subject);
    contactId = contact?.id ?? null;
  }

  return {
    status: 'active',
    context: {
      sessionId: row.id,
      organizationId: row.organizationId,
      actorUserId: row.actorUserId,
      actorName: actor.name,
      subjectUserId: subject.id,
      subjectName: subject.name,
      subjectRole: subject.role,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      reason: row.reason,
      readOnly: true,
      user: subjectClaims(subject, row, contactId),
    },
  };
}

/** The public view of an active context (for /api/auth/me and the banner). */
export function describeImpersonation(context) {
  if (!context) return null;
  return {
    sessionId: context.sessionId,
    actor: { id: context.actorUserId, name: context.actorName },
    subject: { id: context.subjectUserId, name: context.subjectName, role: context.subjectRole },
    startedAt: context.startedAt,
    expiresAt: context.expiresAt,
    readOnly: true,
  };
}

// ---------------------------------------------------------------------------
// Ending and revocation

/**
 * End open impersonation sessions matching `where` inside one organization
 * and write one `impersonation.ended` audit event per session actually
 * ended. Never throws; resolves to the number ended.
 *
 * @param {any} prisma Raw or scoped client.
 * @param {{ organizationId: string, where: Record<string, unknown>, reason: string,
 *   endedById?: string | null, requestId?: string | null, ip?: string | null,
 *   actorUserId?: string | null, actorType?: string, nowMs?: number }} options
 */
export async function endImpersonationSessions(prisma, {
  organizationId, where, reason, endedById = null, requestId = null, ip = null,
  actorUserId = null, actorType = 'USER', nowMs = Date.now(),
}, { logger = defaultLogger } = {}) {
  if (!organizationId || !IMPERSONATION_END_REASONS.includes(reason)) return 0;
  try {
    const open = await prisma.impersonationSession.findMany({
      where: { ...where, organizationId, endedAt: null },
      select: { id: true, actorUserId: true, subjectUserId: true, startedAt: true, expiresAt: true },
    });
    let ended = 0;
    for (const row of open) {
      // An expired row ends at its expiry, whatever ends it later.
      const endedAt = new Date(Math.min(nowMs, row.expiresAt.getTime()));
      const effectiveReason = reason === 'expired' || row.expiresAt.getTime() <= nowMs ? 'expired' : reason;
      const result = await prisma.impersonationSession.updateMany({
        where: { id: row.id, organizationId, endedAt: null },
        data: { endedAt, endReason: effectiveReason, endedById: effectiveReason === 'expired' ? null : endedById },
      });
      if (result.count !== 1) continue; // someone else ended it first
      ended += 1;
      await recordAuditEvent(prisma, {
        organizationId,
        actorType: effectiveReason === 'expired' ? 'SYSTEM' : actorType,
        actorUserId: effectiveReason === 'expired' ? row.actorUserId : (actorUserId ?? endedById ?? row.actorUserId),
        action: 'impersonation.ended',
        entityId: row.id,
        requestId,
        ip,
        metadata: {
          reason: effectiveReason,
          subjectUserId: row.subjectUserId,
          impersonatedUserId: row.subjectUserId,
          impersonationSessionId: row.id,
          durationSeconds: Math.max(0, Math.round((endedAt.getTime() - row.startedAt.getTime()) / 1000)),
        },
      }, { logger });
    }
    return ended;
  } catch (err) {
    logger.error({ err: { message: err?.message, code: err?.code } }, 'Ending impersonation sessions failed');
    return 0;
  }
}

/**
 * Revoke every open view by or of `userId` (password reset or change, role
 * change, deactivation). Request-bound convenience for route handlers.
 */
export function revokeImpersonationsForUser(prisma, request, userId, reason) {
  const organizationId = request?.user?.organizationId;
  return endImpersonationSessions(prisma, {
    organizationId,
    where: { OR: [{ actorUserId: userId }, { subjectUserId: userId }] },
    reason,
    endedById: request?.impersonation?.actorUserId ?? request?.user?.id ?? null,
    requestId: request?.id ?? null,
    ip: request?.ip ?? null,
  });
}

// ---------------------------------------------------------------------------
// Global request hook (registered in src/index.js)

/**
 * Build the onRequest hook that applies an impersonation cookie. It runs for
 * every /api request that carries the cookie (including the /api/auth routes
 * the JWT hook skips), verifies the admin's own session first, and then
 * either swaps in the subject, refuses the request, or clears a dead cookie.
 *
 * @param {{ prisma: any, isCurrentUserSession: (prisma: any, payload: any) => Promise<boolean>, logger?: any }} deps
 */
export function createImpersonationHook({ prisma, isCurrentUserSession, logger = defaultLogger }) {
  return async function impersonationHook(request, reply) {
    if (!request.url.startsWith('/api/')) return undefined;
    if (!request.cookies?.[IMPERSONATION_COOKIE]) return undefined;

    let adminOk = false;
    try {
      await request.jwtVerify();
      adminOk = await isCurrentUserSession(prisma, request.user);
    } catch {
      adminOk = false;
    }
    if (!adminOk) {
      reply.clearCookie(IMPERSONATION_COOKIE, clearImpersonationCookieOptions());
      return undefined; // the route's own guard answers 401
    }

    let result;
    try {
      result = await resolveImpersonation(prisma, request);
    } catch (err) {
      logger.error({ err: { message: err?.message } }, 'Impersonation lookup failed');
      return reply.status(503).send({ error: 'Unable to verify the support view. Try again.' });
    }

    if (result.status === 'expired') {
      await endImpersonationSessions(prisma, {
        organizationId: request.user.organizationId,
        where: { id: result.sessionId },
        reason: 'expired',
        requestId: request.id,
        ip: request.ip,
      }, { logger });
    }
    if (result.status !== 'active') {
      reply.clearCookie(IMPERSONATION_COOKIE, clearImpersonationCookieOptions());
      request.impersonationEnded = result.status === 'expired' ? 'expired' : 'invalid';
      return undefined; // continue as the admin
    }

    const { context } = result;
    request.impersonation = context;
    request.user = context.user;
    const logFields = {
      actorUserId: context.actorUserId,
      impersonatedUserId: context.subjectUserId,
      impersonationSessionId: context.sessionId,
    };
    try {
      request.log = request.log.child(logFields);
    } catch {
      // request.log is read-only in some Fastify versions; the line below still records both.
    }
    request.log.info({ ...logFields, method: request.method, url: pathOf(request.url) }, 'impersonated request');

    const denial = impersonationDenial(request.method, request.url);
    if (denial) {
      return reply.status(denial.status).send({ error: denial.error, code: denial.code });
    }
    return undefined;
  };
}

/**
 * After a route guard re-verified the session cookie (which resets
 * `request.user` to the admin), put the impersonated subject back.
 */
export function applyImpersonation(request) {
  if (request.impersonation) request.user = request.impersonation.user;
}
