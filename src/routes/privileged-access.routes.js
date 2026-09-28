// Support impersonation ("view as") and break-glass redemption (#416).
// Policy and runbook: docs/privileged-actions.md.
//
// Registered under /api/auth, which the tenancy middleware exempts (the view
// must keep working when the viewed person is a CLIENT user, whose role the
// staff tenant guard refuses). Every query below therefore goes through a
// client scoped explicitly to the caller's organization.

import { prisma as basePrisma } from '../config/db.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import { requireRecentAuth } from '../auth/reauth.js';
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_SECONDS,
  clearImpersonationCookieOptions,
  describeImpersonation,
  endImpersonationSessions,
  findPortalContact,
  impersonationCookieOptions,
  impersonationStartProblem,
  signImpersonationToken,
} from '../auth/impersonation.js';
import { BreakGlassError, isBreakGlassEnabled, redeemBreakGlassGrant } from '../auth/break-glass.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { validateBody, impersonationStartSchema, breakGlassRedeemSchema } from '../validators/schemas.js';

const ACTOR_SELECT = {
  id: true, name: true, role: true, isActive: true, organizationId: true, sessionVersion: true,
};
const SUBJECT_SELECT = {
  id: true, email: true, name: true, role: true, clientId: true, isActive: true, organizationId: true,
};

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ prisma?: any }} [options] `prisma`: raw client override for tests.
 */
export default async function privilegedAccessRoutes(fastify, options = {}) {
  const rawPrisma = options.prisma ?? basePrisma;
  const scoped = (organizationId) => createScopedPrisma(rawPrisma, organizationId);

  // Current view, for the banner. Any signed-in session may ask.
  fastify.get('/impersonation', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const session = describeImpersonation(request.impersonation);
    return { active: Boolean(session), session, ...(request.impersonationEnded ? { ended: request.impersonationEnded } : {}) };
  });

  // Start viewing as a non-admin staff or CLIENT member of the admin's own organization.
  fastify.post('/impersonation', {
    onRequest: [fastify.adminOnly],
    preHandler: [requireRecentAuth, validateBody(impersonationStartSchema)],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const organizationId = request.user.organizationId;
    const db = scoped(organizationId);
    const { userId, reason } = request.body;

    const [actor, subject] = await Promise.all([
      db.user.findFirst({ where: { id: request.user.id }, select: ACTOR_SELECT }),
      db.user.findFirst({ where: { id: userId }, select: SUBJECT_SELECT }),
    ]);
    const problem = impersonationStartProblem(actor, subject);
    if (problem) return reply.status(problem.status).send({ error: problem.error, code: problem.code });
    if (subject.role === 'CLIENT' && !(await findPortalContact(db, subject))) {
      return reply.status(409).send({ error: 'This client user has no portal contact to view as.', code: 'IMPERSONATION_TARGET_NO_PORTAL' });
    }

    const nowMs = Date.now();
    const startedAt = new Date(nowMs);
    const expiresAt = new Date(nowMs + IMPERSONATION_TTL_SECONDS * 1000);
    // One view at a time per admin; a new one ends the previous one. The
    // per-admin lock serializes concurrent starts (two tabs or devices), so
    // the second always supersedes the first instead of both staying open.
    const row = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`impersonation-start:${actor.id}`}, 0))`;
      await endImpersonationSessions(tx, {
        organizationId,
        where: { actorUserId: actor.id },
        reason: 'superseded',
        endedById: actor.id,
        requestId: request.id,
        ip: request.ip,
        nowMs,
      });
      const created = await tx.impersonationSession.create({
        data: {
          actorUserId: actor.id,
          subjectUserId: subject.id,
          subjectRole: subject.role,
          reason,
          readOnly: true,
          startedAt,
          expiresAt,
        },
      });

      await recordRequestAuditEvent(tx, request, {
        action: 'impersonation.started',
        entityId: created.id,
        metadata: {
          subjectUserId: subject.id,
          subjectRole: subject.role,
          expiresAt,
          ttlSeconds: IMPERSONATION_TTL_SECONDS,
          readOnly: true,
          impersonatedUserId: subject.id,
          impersonationSessionId: created.id,
        },
      });
      return created;
    });

    // Sockets the admin already has (other tabs share the view cookie) were
    // authenticated as the admin and sit in the admin's rooms, or wait in the
    // pending room while their connection is re-checked. Drop them; the view
    // row is committed, so the handshake refuses the admin's reconnects until
    // the view ends, whether or not the cookie has arrived yet.
    fastify.io?.in([`user:${actor.id}`, `pending-user:${actor.id}`]).disconnectSockets(true);

    // The viewed person is told, in-app, who is looking and why.
    const notification = {
      userId: subject.id,
      type: 'security.impersonation_started',
      title: 'An administrator is viewing your account',
      message: `${actor.name} started a read-only support view of your account for up to ${Math.round(IMPERSONATION_TTL_SECONDS / 60)} minutes. Reason: ${reason}`,
      data: { impersonationSessionId: row.id, actorUserId: actor.id, expiresAt: expiresAt.toISOString() },
    };
    try {
      const created = await db.notification.create({ data: notification });
      fastify.io?.to(`user:${subject.id}`).emit('notification:new', {
        id: created.id, type: notification.type, title: notification.title,
        message: notification.message, data: notification.data, createdAt: created.createdAt,
      });
    } catch (err) {
      request.log.warn({ err: { message: err?.message } }, 'Impersonation notification failed');
    }

    const token = signImpersonationToken({
      sessionId: row.id,
      actor: { ...request.user, sessionVersion: actor.sessionVersion },
      subjectUserId: subject.id,
      expiresAt,
    }, { nowMs });
    reply.setCookie(IMPERSONATION_COOKIE, token, impersonationCookieOptions());
    return reply.status(201).send({
      active: true,
      session: {
        sessionId: row.id,
        actor: { id: actor.id, name: actor.name },
        subject: { id: subject.id, name: subject.name, role: subject.role },
        startedAt,
        expiresAt,
        readOnly: true,
      },
    });
  });

  // End the view (or any open view the admin has). Allowed while viewing.
  fastify.post('/impersonation/stop', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = request.impersonation;
    let stopped = 0;
    if (context) {
      stopped = await endImpersonationSessions(scoped(context.organizationId), {
        organizationId: context.organizationId,
        where: { id: context.sessionId },
        reason: 'stopped',
        endedById: context.actorUserId,
        requestId: request.id,
        ip: request.ip,
      });
    } else if (request.user?.role === 'ADMIN' && request.user.organizationId) {
      stopped = await endImpersonationSessions(scoped(request.user.organizationId), {
        organizationId: request.user.organizationId,
        where: { actorUserId: request.user.id },
        reason: 'stopped',
        endedById: request.user.id,
        requestId: request.id,
        ip: request.ip,
      });
    }
    reply.clearCookie(IMPERSONATION_COOKIE, clearImpersonationCookieOptions());
    return { active: false, stopped };
  });

  // Recent views in the organization, with reasons (admin only; never while viewing).
  fastify.get('/impersonation/sessions', {
    onRequest: [fastify.adminOnly],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const db = scoped(request.user.organizationId);
    const rows = await db.impersonationSession.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    const ids = [...new Set(rows.flatMap((row) => [row.actorUserId, row.subjectUserId]))];
    const users = ids.length
      ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const names = new Map(users.map((user) => [user.id, user.name]));
    const nowMs = Date.now();
    return {
      sessions: rows.map((row) => ({
        id: row.id,
        actor: { id: row.actorUserId, name: names.get(row.actorUserId) ?? null },
        subject: { id: row.subjectUserId, name: names.get(row.subjectUserId) ?? null, role: row.subjectRole },
        reason: row.reason,
        startedAt: row.startedAt,
        expiresAt: row.expiresAt,
        endedAt: row.endedAt,
        endReason: row.endReason ?? (row.expiresAt.getTime() <= nowMs ? 'expired' : null),
        active: !row.endedAt && row.expiresAt.getTime() > nowMs,
      })),
    };
  });

  // Break-glass redemption: the single-use token issued by
  // scripts/break-glass.mjs. 404 unless BREAK_GLASS_ENABLED=true.
  fastify.post('/break-glass/redeem', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes', keyGenerator: (req) => req.ip } },
    // Disabled: 404 whatever the body, before validation can reveal the route.
    onRequest: [async (_request, reply) => {
      if (!isBreakGlassEnabled()) return reply.status(404).send({ error: 'Not found' });
      return undefined;
    }],
    preHandler: [validateBody(breakGlassRedeemSchema)],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const result = await redeemBreakGlassGrant(rawPrisma, {
        token: request.body.token,
        newPassword: request.body.newPassword,
        requestId: request.id,
        ip: request.ip,
      });
      return { success: true, mfaReset: result.mfaReset };
    } catch (err) {
      if (err instanceof BreakGlassError) {
        if (err.code === 'BREAK_GLASS_DISABLED') return reply.status(404).send({ error: 'Not found' });
        return reply.status(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });
}
