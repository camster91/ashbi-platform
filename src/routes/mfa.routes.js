// Multi-factor authentication routes (registered under /api/auth).
//
// /api/auth is exempt from the tenancy middleware, so request.prisma is the
// raw client here; every query is keyed by the authenticated user's own id or
// by the user id bound into a signed MFA challenge.

import bcrypt from 'bcrypt';
import logger from '../utils/logger.js';
import { sessionCookieOptions, signUserSession } from '../auth/session.js';
import {
  claimTotpCode,
  generateRecoveryCodes,
  isChallengeRevokedByLockout,
  isMfaEligible,
  isMfaRequired,
  MFA_USER_SELECT,
  mfaStatus,
  startEnrollment,
  verifyMfaChallenge,
  verifySecondFactor,
} from '../auth/mfa.js';
import {
  mfaAdminResetSchema,
  mfaConfirmSchema,
  mfaDisableSchema,
  mfaEnrollSchema,
  mfaLoginSchema,
  validateBody,
} from '../validators/schemas.js';

const MFA_EVENTS = {
  enabled: {
    title: 'Two-factor authentication enabled',
    message: 'Two-factor authentication was turned on for your account. Other signed-in sessions were signed out.',
  },
  disabled: {
    title: 'Two-factor authentication disabled',
    message: 'Two-factor authentication was turned off for your account. Other signed-in sessions were signed out. If this was not you, change your password now.',
  },
  admin_reset: {
    title: 'Two-factor authentication reset by an administrator',
    message: 'An administrator reset two-factor authentication on your account and signed out your sessions. Sign in with your password and set it up again. If you did not ask for this, contact your administrator.',
  },
  recovery_code_used: {
    title: 'Recovery code used to sign in',
    message: 'A recovery code was used to sign in to your account and other sessions were signed out. If this was not you, change your password and reset two-factor authentication.',
  },
};

/** Durable, secret-free record of an MFA change: an in-app notification plus a structured log line. */
async function recordMfaEvent(prisma, request, userId, event, extra = {}) {
  logger.info({ userId, event: `mfa.${event}`, ip: request.ip, ...extra }, '[auth] MFA security event');
  const copy = MFA_EVENTS[event];
  try {
    await prisma.notification.create({
      data: { userId, type: `security.mfa_${event}`, title: copy.title, message: copy.message, data: { event, ...extra } },
    });
  } catch (err) {
    logger.error({ err, userId, event: `mfa.${event}` }, '[auth] Failed to record MFA notification');
  }
}

async function verifyPassword(password, hash) {
  if (typeof hash !== 'string' || !hash.startsWith('$2')) return false;
  return bcrypt.compare(password, hash);
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId };
}

// Signed-in callers get 400 for a wrong code: a 401 there would read as an
// expired session and sign the browser out.
function secondFactorFailure(reply, result, invalidStatus = 401) {
  if (result.reason === 'locked') {
    return reply.status(429).send({ error: 'Too many incorrect codes. Two-factor sign-in is locked for 15 minutes.' });
  }
  if (result.reason === 'replayed') {
    return reply.status(invalidStatus).send({ error: 'That code was already used. Wait for the next code and try again.' });
  }
  return reply.status(invalidStatus).send({ error: 'Invalid authentication code' });
}

export default async function mfaRoutes(fastify) {
  const enrollmentRateLimit = {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes', keyGenerator: (req) => req.ip } },
  };
  const challengeRateLimit = {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes', keyGenerator: (req) => req.ip } },
  };

  async function loadStaffUser(request, reply) {
    const user = await request.prisma.user.findUnique({ where: { id: request.user.id }, select: MFA_USER_SELECT });
    if (!user || !user.isActive) {
      reply.status(401).send({ error: 'Unauthorized' });
      return null;
    }
    if (!isMfaEligible(user)) {
      reply.status(403).send({ error: 'Two-factor authentication is available to staff accounts only' });
      return null;
    }
    return user;
  }

  function reissueSession(reply, user, sessionVersion) {
    reply.setCookie('token', signUserSession(fastify.jwt, { ...user, sessionVersion }), sessionCookieOptions({ includeMaxAge: true }));
  }

  // Current MFA status for the signed-in staff user.
  fastify.get('/mfa', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = await loadStaffUser(request, reply);
    if (!user) return reply;
    return mfaStatus(user);
  });

  // Start (or restart) enrollment: a new secret replaces any unconfirmed one.
  fastify.post('/mfa/enroll', {
    ...enrollmentRateLimit,
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(mfaEnrollSchema)],
  }, async (request, reply) => {
    const user = await loadStaffUser(request, reply);
    if (!user) return reply;
    if (user.mfaEnabled) {
      return reply.status(409).send({ error: 'Two-factor authentication is already enabled. Disable it before enrolling a new authenticator.' });
    }
    // Re-authenticate so a stolen session cannot bind an attacker's
    // authenticator and lock the real owner out.
    if (!(await verifyPassword(request.body.password, user.password))) {
      return reply.status(400).send({ error: 'Current password is incorrect' });
    }
    const enrollment = startEnrollment(user);
    await request.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: enrollment.encryptedSecret, mfaLastUsedStep: null, mfaRecoveryCodes: [] },
    });
    reply.header('Cache-Control', 'no-store');
    return { secret: enrollment.secret, otpauthUri: enrollment.otpauthUri };
  });

  // Confirm enrollment with a current code; returns the recovery codes once.
  fastify.post('/mfa/confirm', {
    ...enrollmentRateLimit,
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(mfaConfirmSchema)],
  }, async (request, reply) => {
    const user = await loadStaffUser(request, reply);
    if (!user) return reply;
    if (user.mfaEnabled) return reply.status(409).send({ error: 'Two-factor authentication is already enabled' });
    if (!user.mfaSecret) return reply.status(400).send({ error: 'Start enrollment before confirming a code' });

    const claim = await claimTotpCode(request.prisma, user, request.body.code);
    if (claim !== 'ok') {
      return reply.status(400).send({ error: 'That code did not match. Check the time on your device and try the current code.' });
    }

    const { codes, hashes } = generateRecoveryCodes();
    const updated = await request.prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        mfaEnabledAt: new Date(),
        mfaRecoveryCodes: hashes,
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        sessionVersion: { increment: 1 },
      },
      select: { sessionVersion: true },
    });
    reissueSession(reply, user, updated.sessionVersion);
    await recordMfaEvent(request.prisma, request, user.id, 'enabled');
    reply.header('Cache-Control', 'no-store');
    return { enabled: true, recoveryCodes: codes };
  });

  // Disable: requires the current password and a valid TOTP or recovery code.
  fastify.post('/mfa/disable', {
    ...enrollmentRateLimit,
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(mfaDisableSchema)],
  }, async (request, reply) => {
    const user = await loadStaffUser(request, reply);
    if (!user) return reply;
    if (!user.mfaEnabled) return reply.status(400).send({ error: 'Two-factor authentication is not enabled' });

    const { password, code, recoveryCode } = request.body;
    if (!(await verifyPassword(password, user.password))) {
      return reply.status(400).send({ error: 'Current password is incorrect' });
    }
    const factor = await verifySecondFactor(request.prisma, user, { code, recoveryCode });
    if (!factor.ok) return secondFactorFailure(reply, factor, 400);

    const updated = await request.prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaLastUsedStep: null,
        mfaRecoveryCodes: [],
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        sessionVersion: { increment: 1 },
      },
      select: { sessionVersion: true },
    });
    reissueSession(reply, user, updated.sessionVersion);
    await recordMfaEvent(request.prisma, request, user.id, 'disabled', { method: factor.method });
    return { enabled: false };
  });

  // Second login step: exchange a valid challenge + code for a session cookie.
  fastify.post('/login/mfa', {
    ...challengeRateLimit,
    preHandler: [validateBody(mfaLoginSchema)],
  }, async (request, reply) => {
    const { challengeToken, code, recoveryCode } = request.body;
    const challenge = verifyMfaChallenge(challengeToken);
    const expired = { error: 'Your sign-in attempt expired. Enter your email and password again.', code: 'MFA_CHALLENGE_EXPIRED' };
    if (!challenge) return reply.status(401).send(expired);

    const user = await request.prisma.user.findUnique({ where: { id: challenge.uid }, select: MFA_USER_SELECT });
    // A challenge is bound to the session version it was issued for, so a
    // password change or MFA reset in the meantime invalidates it.
    if (!user || !user.isActive || user.sessionVersion !== challenge.sv || !isMfaRequired(user)
      || isChallengeRevokedByLockout(user, challenge)) {
      return reply.status(401).send(expired);
    }

    const factor = await verifySecondFactor(request.prisma, user, { code, recoveryCode });
    if (!factor.ok) return secondFactorFailure(reply, factor);

    reissueSession(reply, user, factor.sessionVersion);
    if (factor.method === 'recovery_code') {
      await recordMfaEvent(request.prisma, request, user.id, 'recovery_code_used', { remaining: factor.recoveryCodesRemaining });
    }
    return {
      user: publicUser(user),
      method: factor.method,
      recoveryCodesRemaining: factor.recoveryCodesRemaining,
    };
  });

  // Admin recovery: reset (and unlock) another member's two-factor
  // authentication in the admin's own organization. Requires the admin's
  // password, revokes every session of the target user, and notifies them.
  fastify.post('/mfa/admin/users/:userId/reset', {
    ...enrollmentRateLimit,
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(mfaAdminResetSchema)],
  }, async (request, reply) => {
    const admin = await request.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { id: true, role: true, isActive: true, organizationId: true, password: true },
    });
    if (!admin || !admin.isActive) return reply.status(401).send({ error: 'Unauthorized' });
    if (admin.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });

    const { userId } = request.params;
    if (userId === admin.id) {
      return reply.status(400).send({ error: 'Use Settings → Security to change your own two-factor authentication' });
    }
    if (!(await verifyPassword(request.body.password, admin.password))) {
      return reply.status(400).send({ error: 'Current password is incorrect' });
    }
    // /api/auth bypasses tenancy scoping, so the organization check is explicit.
    // Another organization's user is indistinguishable from a missing one.
    const target = await request.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, organizationId: true, mfaEnabled: true, mfaSecret: true, mfaLockedUntil: true },
    });
    if (!target || !admin.organizationId || target.organizationId !== admin.organizationId) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const wasEnabled = Boolean(target.mfaEnabled);
    await request.prisma.user.update({
      where: { id: target.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaLastUsedStep: null,
        mfaRecoveryCodes: [],
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        sessionVersion: { increment: 1 },
      },
    });
    await recordMfaEvent(request.prisma, request, target.id, 'admin_reset', { actorUserId: admin.id, wasEnabled });
    return { reset: true, userId: target.id };
  });
}
