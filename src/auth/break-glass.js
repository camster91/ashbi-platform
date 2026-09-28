// Break-glass recovery of an organization's administrator access (#416).
// Runbook: docs/privileged-actions.md#break-glass-administrator-recovery.
//
// When every administrator of an organization is locked out (lost password
// and two-factor device, deactivated, or gone), a platform operator can issue
// a single-use recovery grant for one named staff member of that
// organization. The operator never receives access to the tenant: the grant
// is a 256-bit token that the verified person redeems themselves, setting a
// new password. Redeeming turns off their two-factor authentication (they
// re-enroll after signing in), reactivates the account, signs out every other
// session, revokes their API keys, and (only when the grant says so) makes a
// non-admin staff member (TEAM or STAFF) an ADMIN.
//
// Guard rails:
//   - Off unless BREAK_GLASS_ENABLED=true, both for issuing (CLI) and redeeming
//     (POST /api/auth/break-glass/redeem answers 404 otherwise).
//   - The operator is *named*, not authenticated: the CLI takes an --operator
//     user id that must be in PLATFORM_OPERATOR_USER_IDS and still an active
//     ADMIN in the database. Whoever can run the CLI with production database
//     access can claim any listed id, so the grant and its audit event also
//     record the OS user and host the CLI ran as (see "Known limitations" in
//     docs/privileged-actions.md). Access control is the host itself.
//   - A written reason (10 to 500 characters) is stored with the grant.
//   - 30 minutes, single use (*Proposal*); the database caps it at 60.
//   - Audited in the target organization (break_glass.granted / .redeemed /
//     .revoked, plus the password, two-factor, role and reactivation events
//     the redemption causes), and every active administrator of that
//     organization is notified in-app, as is the target.

import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import defaultLogger from '../utils/logger.js';
import { recordAuditEvent } from '../services/audit-event.service.js';
import { endImpersonationSessions } from './impersonation.js';

// Proposal for owner approval (docs/privileged-actions.md).
export const BREAK_GLASS_TTL_SECONDS = 30 * 60;
export const BREAK_GLASS_REASON_MIN = 10;
export const BREAK_GLASS_REASON_MAX = 500;
const BCRYPT_ROUNDS = 12;

const PROVENANCE_MAX = 128;

/**
 * Reduce an OS user name or host name to the audit metadata alphabet
 * (`[A-Za-z0-9_.:/@+-]`, at most 128 characters) so it is never dropped.
 * @param {unknown} value
 */
export function provenanceValue(value) {
  const text = String(value ?? '').trim().replace(/[^A-Za-z0-9_.:/@+-]/g, '_').slice(0, PROVENANCE_MAX);
  return text || 'unknown';
}

export class BreakGlassError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'BreakGlassError';
    this.code = code;
    this.status = status;
  }
}

export function isBreakGlassEnabled(environment = process.env) {
  return String(environment.BREAK_GLASS_ENABLED || '').trim().toLowerCase() === 'true';
}

function operatorIds(environment = process.env) {
  return String(environment.PLATFORM_OPERATOR_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function hashBreakGlassToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function assertEnabled(environment) {
  if (!isBreakGlassEnabled(environment)) {
    throw new BreakGlassError('BREAK_GLASS_DISABLED', 'Break-glass access is disabled. Set BREAK_GLASS_ENABLED=true for the duration of the emergency.', 404);
  }
}

function normalizeReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < BREAK_GLASS_REASON_MIN || text.length > BREAK_GLASS_REASON_MAX) {
    throw new BreakGlassError('BREAK_GLASS_REASON_REQUIRED', `A reason of ${BREAK_GLASS_REASON_MIN} to ${BREAK_GLASS_REASON_MAX} characters is required.`);
  }
  return text;
}

/** The operator must be listed and still an active ADMIN in the database. */
async function assertOperator(prisma, operatorId, environment) {
  if (!operatorId || !operatorIds(environment).includes(operatorId)) {
    throw new BreakGlassError('BREAK_GLASS_NOT_OPERATOR', 'Only a platform operator (PLATFORM_OPERATOR_USER_IDS) can use break-glass access.', 403);
  }
  const operator = await prisma.user.findUnique({
    where: { id: operatorId },
    select: { id: true, role: true, isActive: true },
  });
  if (operator?.role !== 'ADMIN' || operator.isActive !== true) {
    throw new BreakGlassError('BREAK_GLASS_NOT_OPERATOR', 'The platform operator account must be an active administrator.', 403);
  }
  return operator;
}

async function activeAdminIds(prisma, organizationId) {
  const admins = await prisma.user.findMany({
    where: { organizationId, role: 'ADMIN', isActive: true },
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}

async function notifyUsers(prisma, userIds, { type, title, message, data }, logger) {
  for (const userId of [...new Set(userIds)]) {
    try {
      await prisma.notification.create({ data: { userId, type, title, message, data } });
    } catch (err) {
      logger.warn({ err: { message: err?.message } }, 'Break-glass notification failed');
    }
  }
}

/**
 * Issue a single-use recovery grant. Returns the raw token exactly once.
 *
 * @param {any} prisma Raw Prisma client (operator CLI; there is no tenant session).
 * @param {{ organizationId: string, targetEmail?: string, targetUserId?: string,
 *   operatorId: string, reason: string, promoteToAdmin?: boolean,
 *   osUser?: string, host?: string }} input `osUser` / `host`: where the CLI ran.
 */
export async function issueBreakGlassGrant(prisma, input, {
  environment = process.env, nowMs = Date.now(), logger = defaultLogger,
} = {}) {
  assertEnabled(environment);
  const reason = normalizeReason(input.reason);
  const operator = await assertOperator(prisma, input.operatorId, environment);

  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true },
  });
  if (!organization) throw new BreakGlassError('BREAK_GLASS_ORG_NOT_FOUND', 'Organization not found.', 404);

  const where = input.targetUserId
    ? { id: input.targetUserId, organizationId: organization.id }
    : { email: { equals: String(input.targetEmail || '').trim(), mode: 'insensitive' }, organizationId: organization.id };
  const targets = await prisma.user.findMany({
    where,
    select: { id: true, email: true, name: true, role: true, isActive: true },
    take: 2,
  });
  if (targets.length !== 1) {
    throw new BreakGlassError('BREAK_GLASS_TARGET_NOT_FOUND', 'No single staff account with that id or email in this organization.', 404);
  }
  const [target] = targets;
  const promoteToAdmin = input.promoteToAdmin === true;
  if (target.role === 'CLIENT' || target.role === 'BOT') {
    throw new BreakGlassError('BREAK_GLASS_TARGET_FORBIDDEN', 'Break-glass access restores staff administrators only.', 403);
  }
  if (target.role !== 'ADMIN' && !promoteToAdmin) {
    throw new BreakGlassError('BREAK_GLASS_TARGET_NOT_ADMIN', 'The target is not an administrator. Pass --promote (for a TEAM or STAFF member) only when the organization has no administrator left.', 409);
  }
  if (target.role !== 'ADMIN' && promoteToAdmin && (await activeAdminIds(prisma, organization.id)).length > 0) {
    throw new BreakGlassError('BREAK_GLASS_ADMIN_EXISTS', 'The organization still has an active administrator; restore that account instead of promoting another.', 409);
  }

  const now = new Date(nowMs);
  const expiresAt = new Date(nowMs + BREAK_GLASS_TTL_SECONDS * 1000);
  const token = crypto.randomBytes(32).toString('base64url');
  const provenance = { osUser: provenanceValue(input.osUser), host: provenanceValue(input.host) };

  // One outstanding grant per target: a new one replaces the old. The
  // per-target lock serializes concurrent issues, so each one revokes the
  // previous grant instead of both staying redeemable.
  const grant = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`break-glass-target:${target.id}`}, 0))`;
    const superseded = await tx.breakGlassGrant.findMany({
      where: { organizationId: organization.id, targetUserId: target.id, redeemedAt: null, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    for (const old of superseded) {
      await revokeGrantRow(tx, old.id, organization.id, operator.id, target.id, now, logger, provenance);
    }

    const created = await tx.breakGlassGrant.create({
      data: {
        organizationId: organization.id,
        targetUserId: target.id,
        operatorId: operator.id,
        reason,
        promoteToAdmin,
        tokenHash: hashBreakGlassToken(token),
        issuedByOsUser: provenance.osUser,
        issuedFromHost: provenance.host,
        createdAt: now,
        expiresAt,
      },
    });

    await recordAuditEvent(tx, {
      organizationId: organization.id,
      actorType: 'USER',
      actorUserId: operator.id,
      action: 'break_glass.granted',
      entityId: created.id,
      metadata: { targetUserId: target.id, operatorId: operator.id, expiresAt, promoteToAdmin, ...provenance },
    }, { logger });
    return created;
  });

  const admins = await activeAdminIds(prisma, organization.id);
  await notifyUsers(prisma, [...admins, target.id], {
    type: 'security.break_glass_granted',
    title: 'Emergency administrator access was issued',
    message: `A platform operator issued a single-use emergency sign-in for ${target.name} (${target.email}). It expires at ${expiresAt.toISOString()}. Reason: ${reason}`,
    data: { breakGlassGrantId: grant.id, targetUserId: target.id, expiresAt: expiresAt.toISOString() },
  }, logger);

  return { grant, token, target, organization };
}

async function revokeGrantRow(prisma, grantId, organizationId, operatorId, targetUserId, now, logger, provenance = {}) {
  const result = await prisma.breakGlassGrant.updateMany({
    where: { id: grantId, organizationId, redeemedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  if (result.count !== 1) return false;
  await recordAuditEvent(prisma, {
    organizationId,
    actorType: 'USER',
    actorUserId: operatorId,
    action: 'break_glass.revoked',
    entityId: grantId,
    metadata: { targetUserId, operatorId, ...provenance },
  }, { logger });
  return true;
}

/** Revoke an outstanding grant (operator CLI). */
export async function revokeBreakGlassGrant(prisma, { grantId, operatorId, osUser, host }, {
  environment = process.env, nowMs = Date.now(), logger = defaultLogger,
} = {}) {
  // Revoking only removes access, so it works even with the flag off.
  const operator = await assertOperator(prisma, operatorId, environment);
  const grant = await prisma.breakGlassGrant.findUnique({ where: { id: grantId } });
  if (!grant) throw new BreakGlassError('BREAK_GLASS_GRANT_NOT_FOUND', 'Grant not found.', 404);
  const provenance = { osUser: provenanceValue(osUser), host: provenanceValue(host) };
  const revoked = await revokeGrantRow(prisma, grant.id, grant.organizationId, operator.id, grant.targetUserId, new Date(nowMs), logger, provenance);
  if (!revoked) throw new BreakGlassError('BREAK_GLASS_GRANT_CLOSED', 'The grant was already redeemed or revoked.', 409);
  return { revoked: true, grantId: grant.id };
}

/**
 * Redeem a grant: the verified person sets a new password and regains their
 * administrator access. Answers only a generic error for any bad token.
 *
 * @param {any} prisma Raw Prisma client.
 * @param {{ token: string, newPassword: string, requestId?: string | null, ip?: string | null }} input
 */
export async function redeemBreakGlassGrant(prisma, { token, newPassword, requestId = null, ip = null }, {
  environment = process.env, nowMs = Date.now(), logger = defaultLogger,
} = {}) {
  assertEnabled(environment);
  const invalid = new BreakGlassError('BREAK_GLASS_INVALID', 'This emergency access link is invalid, used or expired.', 400);
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw invalid;
  const now = new Date(nowMs);
  const grant = await prisma.breakGlassGrant.findUnique({ where: { tokenHash: hashBreakGlassToken(token) } });
  if (!grant || grant.redeemedAt || grant.revokedAt || grant.expiresAt.getTime() <= nowMs) throw invalid;

  const target = await prisma.user.findFirst({
    where: { id: grant.targetUserId, organizationId: grant.organizationId },
    select: { id: true, role: true, isActive: true, mfaEnabled: true },
  });
  if (!target || target.role === 'CLIENT' || target.role === 'BOT') throw invalid;
  if (target.role !== 'ADMIN' && !grant.promoteToAdmin) throw invalid;
  // A promotion is only for an organization with no administrator left; one
  // may have been restored since the grant was issued.
  if (target.role !== 'ADMIN' && (await activeAdminIds(prisma, grant.organizationId)).length > 0) throw invalid;

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const promoted = target.role !== 'ADMIN' && grant.promoteToAdmin;
  const reactivated = target.isActive !== true;

  const outcome = await prisma.$transaction(async (tx) => {
    if (promoted) {
      // Serialize promotions per organization and re-check under the lock:
      // two grants redeemed at once must not both find no administrator.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`break-glass-promote:${grant.organizationId}`}, 0))`;
      if ((await activeAdminIds(tx, grant.organizationId)).length > 0) return null;
    }
    const claimed = await tx.breakGlassGrant.updateMany({
      where: { id: grant.id, redeemedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { redeemedAt: now },
    });
    if (claimed.count !== 1) return null; // redeemed concurrently
    await tx.user.update({
      where: { id: target.id },
      data: {
        password: passwordHash,
        isActive: true,
        ...(promoted ? { role: 'ADMIN' } : {}),
        mfaEnabled: false,
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaLastUsedStep: null,
        mfaRecoveryCodes: [],
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        resetToken: null,
        resetTokenExpiresAt: null,
        sessionVersion: { increment: 1 },
      },
    });
    const keys = await tx.apiKey.updateMany({
      where: { userId: target.id, isActive: true },
      data: { isActive: false, revokedAt: now },
    });
    return { apiKeysRevoked: keys.count };
  });
  if (!outcome) throw invalid;

  await endImpersonationSessions(prisma, {
    organizationId: grant.organizationId,
    where: { OR: [{ actorUserId: target.id }, { subjectUserId: target.id }] },
    reason: 'revoked_password_reset',
    actorType: 'SYSTEM',
    requestId,
    ip,
    nowMs,
  }, { logger });

  const base = { organizationId: grant.organizationId, actorType: 'USER', actorUserId: target.id, requestId, ip };
  await recordAuditEvent(prisma, {
    ...base,
    action: 'break_glass.redeemed',
    entityId: grant.id,
    metadata: {
      targetUserId: target.id, operatorId: grant.operatorId, promoted, reactivated,
      mfaReset: target.mfaEnabled === true, apiKeysRevoked: outcome.apiKeysRevoked,
    },
  }, { logger });
  await recordAuditEvent(prisma, {
    ...base, action: 'auth.password_changed', entityId: target.id,
    metadata: { method: 'break_glass', sessionsRevoked: true, apiKeysRevoked: outcome.apiKeysRevoked },
  }, { logger });
  if (target.mfaEnabled) {
    await recordAuditEvent(prisma, { ...base, action: 'auth.mfa_reset', entityId: target.id, metadata: { wasEnabled: true } }, { logger });
  }
  if (promoted) {
    await recordAuditEvent(prisma, { ...base, action: 'user.role_changed', entityId: target.id, metadata: { fromRole: target.role, toRole: 'ADMIN' } }, { logger });
  }
  if (reactivated) {
    await recordAuditEvent(prisma, { ...base, action: 'user.reactivated', entityId: target.id, metadata: { fromActive: false, toActive: true } }, { logger });
  }

  const admins = await activeAdminIds(prisma, grant.organizationId);
  await notifyUsers(prisma, admins, {
    type: 'security.break_glass_redeemed',
    title: 'Emergency administrator access was used',
    message: 'An emergency sign-in issued by a platform operator was used to restore administrator access. Review the Activity Log and confirm this was expected.',
    data: { breakGlassGrantId: grant.id, targetUserId: target.id },
  }, logger);

  return { redeemed: true, promoted, reactivated, mfaReset: target.mfaEnabled === true };
}

/**
 * Recent grants of an organization for the operator CLI (never tokens or
 * hashes). Same operator check as issuing.
 */
export async function listBreakGlassGrants(prisma, { organizationId, operatorId }, { environment = process.env } = {}) {
  await assertOperator(prisma, operatorId, environment);
  return prisma.breakGlassGrant.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, targetUserId: true, operatorId: true, reason: true, promoteToAdmin: true,
      issuedByOsUser: true, issuedFromHost: true,
      createdAt: true, expiresAt: true, redeemedAt: true, revokedAt: true,
    },
  });
}
