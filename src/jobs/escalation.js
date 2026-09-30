// Thread SLA escalation checks (escalation queue).
//
// Each escalation level notifies at most once per thread per quiet period:
// the level reached is stored on the thread (`lastEscalationLevel`,
// `lastEscalatedAt`) and claimed with a conditional update, so the
// quarter-hourly sweep, the per-thread delayed check and concurrent workers
// cannot re-send the same SLA_WARNING / ESCALATION. Any thread activity after
// the last escalation (a response, a new message) starts a new cycle, the same
// clock `hoursSinceActivity` is measured on; sending a response also resets the
// level explicitly (src/routes/response.routes.js). A claim and its
// notifications commit in one transaction, so a failed fan-out never leaves a
// level claimed without its alert. The rows are emitted live (Redis emitter,
// src/realtime/emitter.js) only after that transaction commits.

import { emitNotification } from '../services/notification.service.js';
import { getRealtimeEmitter } from '../realtime/emitter.js';

export const ESCALATION_LEVELS = Object.freeze({ NONE: 0, SLA_WARNING: 1, ESCALATION: 2 });

const HOUR_MS = 60 * 60 * 1000;

/** The level already notified in the current activity cycle. */
export function currentEscalationLevel(thread) {
  const level = Number.isInteger(thread?.lastEscalationLevel) ? thread.lastEscalationLevel : 0;
  if (!level || !thread.lastEscalatedAt) return 0;
  const escalatedAt = new Date(thread.lastEscalatedAt).getTime();
  const activityAt = new Date(thread.lastActivityAt).getTime();
  return activityAt > escalatedAt ? 0 : level;
}

/**
 * Atomically record that `level` was reached. Returns false when another
 * check already claimed this (or a higher) level for the current cycle.
 */
async function claimEscalationLevel(prisma, thread, level, now) {
  const alreadyClaimed = currentEscalationLevel(thread);
  if (alreadyClaimed >= level) return false;
  // Optimistic concurrency: every claim requires the escalation marker to be
  // unchanged since this thread was read, so two checks racing on the same
  // thread (sweep vs delayed check, two workers) cannot both notify.
  const where = {
    id: thread.id,
    lastEscalatedAt: thread.lastEscalatedAt ? new Date(thread.lastEscalatedAt) : null,
  };
  if (alreadyClaimed > 0) where.lastEscalationLevel = { lt: level };
  const result = await prisma.thread.updateMany({
    where,
    data: { lastEscalationLevel: level, lastEscalatedAt: now },
  });
  return result.count === 1;
}

async function activeAdmins(prisma) {
  return prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
}

/**
 * Check one thread. `prisma` is the tenant-scoped client of the running job.
 */
export async function checkThreadEscalation(threadId, {
  prisma,
  slaDefaults,
  existingThread = null,
  now = new Date(),
  emitter = getRealtimeEmitter(),
}) {
  const thread = existingThread || await prisma.thread.findUnique({ where: { id: threadId } });

  if (!thread || thread.status === 'RESOLVED') {
    return { skipped: true, reason: 'Thread not found or resolved' };
  }

  const hoursSinceActivity = (now - new Date(thread.lastActivityAt)) / HOUR_MS;
  const slaHours = slaDefaults[thread.priority] || 24;
  const wantsWarning = hoursSinceActivity >= 4 && hoursSinceActivity < 8 && Boolean(thread.assignedToId)
    && currentEscalationLevel(thread) < ESCALATION_LEVELS.SLA_WARNING;
  const wantsEscalation = hoursSinceActivity >= 8
    && currentEscalationLevel(thread) < ESCALATION_LEVELS.ESCALATION;
  const wantsBreach = hoursSinceActivity >= slaHours && !thread.slaBreached;
  if (!wantsWarning && !wantsEscalation && !wantsBreach) {
    return { escalated: false, notifications: 0, hoursSinceActivity: Math.round(hoursSinceActivity) };
  }
  // Read outside the transaction; only the claims and the fan-out must be atomic.
  const admins = wantsEscalation || wantsBreach ? await activeAdmins(prisma) : [];
  // With no one to tell (no active admin right now), leave the admin levels
  // unclaimed so a later sweep alerts the first admin who becomes active.
  const canNotifyAdmins = admins.length > 0;

  // Claims and notifications commit together: if the fan-out fails (or the
  // worker dies) the claims roll back, so the next attempt sends the alert
  // instead of finding the level already claimed.
  const notifications = await prisma.$transaction(async (tx) => {
    const pending = [];
    if (wantsWarning && await claimEscalationLevel(tx, thread, ESCALATION_LEVELS.SLA_WARNING, now)) {
      pending.push({
        userId: thread.assignedToId,
        type: 'SLA_WARNING',
        title: 'Response needed soon',
        message: `Thread "${thread.subject}" needs attention (${Math.round(hoursSinceActivity)}h without response)`,
        data: { threadId: thread.id },
      });
    }

    if (wantsEscalation && canNotifyAdmins && await claimEscalationLevel(tx, thread, ESCALATION_LEVELS.ESCALATION, now)) {
      for (const admin of admins) {
        pending.push({
          userId: admin.id,
          type: 'ESCALATION',
          title: 'Thread escalation',
          message: `Thread "${thread.subject}" has had no response for ${Math.round(hoursSinceActivity)} hours`,
          data: { threadId: thread.id, assigneeId: thread.assignedToId },
        });
      }
    }

    if (wantsBreach && canNotifyAdmins) {
      // slaBreached is the once-only marker for the breach notification.
      const claimed = await tx.thread.updateMany({
        where: { id: thread.id, slaBreached: false },
        data: { slaBreached: true },
      });
      if (claimed.count === 1) {
        for (const admin of admins) {
          pending.push({
            userId: admin.id,
            type: 'SLA_BREACH',
            title: 'SLA BREACH',
            message: `Thread "${thread.subject}" has breached SLA (${Math.round(hoursSinceActivity)}h without response)`,
            data: { threadId: thread.id, priority: thread.priority },
          });
        }
      }
    }

    // One round-trip for the whole fan-out; the returned rows carry the ids
    // and timestamps the realtime payload needs.
    if (pending.length === 0) return [];
    return tx.notification.createManyAndReturn({ data: pending });
  });

  // Committed: deliver each row live. Never inside the transaction, so a
  // rolled-back claim is never announced.
  for (const notification of notifications) {
    emitNotification(emitter, notification.userId, notification);
  }

  return {
    escalated: notifications.length > 0,
    notifications: notifications.length,
    hoursSinceActivity: Math.round(hoursSinceActivity),
  };
}

/** Sweep one tenant's overdue threads; a failing thread does not stop the sweep. */
export async function checkAllEscalations({ prisma, slaDefaults, now = new Date(), logger, emitter = undefined }) {
  const threads = await prisma.thread.findMany({
    where: { status: 'AWAITING_RESPONSE', slaBreached: false },
  });

  let escalated = 0;
  let failed = 0;
  for (const thread of threads) {
    try {
      const result = await checkThreadEscalation(thread.id, { prisma, slaDefaults, existingThread: thread, now, emitter });
      if (result.escalated) escalated++;
    } catch (error) {
      failed++;
      logger?.error({ err: error, threadId: thread.id }, 'Escalation check failed for thread');
    }
  }
  return { checked: threads.length, escalated, failed };
}

/**
 * Run `checkOrganization` for every organization in isolation: one tenant's
 * failure is logged and reported, the others still run, and the job fails at
 * the end (so BullMQ retries and alerts) only after every tenant was tried.
 * Retries are safe because each level is claimed once per thread.
 */
export async function runForEachOrganization(organizationIds, checkOrganization, { logger, onError } = {}) {
  const organizations = [];
  const failures = [];
  for (const organizationId of organizationIds) {
    try {
      organizations.push({ organizationId, ...(await checkOrganization(organizationId)) });
    } catch (error) {
      failures.push({ organizationId, error });
      logger?.error({ err: error, organizationId }, 'Escalation sweep failed for organization');
      onError?.(error, organizationId);
    }
  }
  if (failures.length > 0) {
    const error = new AggregateError(
      failures.map(({ error: cause }) => cause),
      `Escalation sweep failed for ${failures.length} of ${organizationIds.length} organizations`,
    );
    error.organizations = organizations;
    error.failedOrganizationIds = failures.map(({ organizationId }) => organizationId);
    throw error;
  }
  return { organizations };
}
