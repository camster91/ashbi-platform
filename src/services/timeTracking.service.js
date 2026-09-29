// Time Tracking service (timers = TimeSession, billable records = TimeEntry)
//
// Behaviour (docs/product-status.md, "Time tracking"):
// - A user has at most one running timer. The database enforces it with a
//   partial unique index on time_sessions("userId") WHERE "isRunning"; start
//   stops the previous timer and creates the new one in one transaction, and
//   a concurrent start that loses the race answers 409 TIMER_ALREADY_RUNNING.
// - Stopping a timer creates the TimeEntry (source TIMER, linked through
//   timeSessionId) in the same transaction, so timed work reaches reports,
//   timesheets and budgets. A timer stopped under one minute records no entry;
//   a timer left running longer than a day records a 24h (1440-minute) entry,
//   the same cap manual entries have, while the session keeps its real span.
// - Only the timer's owner can stop, update or delete it; any other id is
//   404 (never 500, and never a hint that the timer exists).

import prisma from '../config/db.js';
import { MAX_TIME_ENTRY_MINUTES } from '../validators/schemas.js';

export class TimerError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code
   * @param {string} message
   */
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'TimerError';
    this.statusCode = statusCode;
    this.code = code;
    this.expose = true;
  }
}

const SESSION_INCLUDE = {
  project: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
};

function isUniqueViolation(err) {
  return err?.code === 'P2002' || /Unique constraint failed/i.test(String(err?.message));
}

/**
 * Reply helper for routes: TimerError → its status and code, others rethrow.
 * @param {any} reply
 * @param {unknown} err
 */
export function sendTimerError(reply, err) {
  if (err instanceof TimerError) {
    return reply.status(err.statusCode).send({ error: err.message, code: err.code });
  }
  throw err;
}

/**
 * Close one running session inside `tx` and record its TimeEntry.
 * Returns null when the session was no longer running (someone else stopped
 * it first).
 */
async function closeSession(tx, session, endTime = new Date()) {
  const elapsedMs = endTime.getTime() - new Date(session.startTime).getTime();
  const duration = Math.max(0, Math.round(elapsedMs / 60000));
  const claimed = await tx.timeSession.updateMany({
    where: { id: session.id, userId: session.userId, isRunning: true },
    data: { endTime, duration, isRunning: false },
  });
  if (claimed.count !== 1) return null;
  // Under a full minute records nothing (the rounded duration would be 1).
  const timeEntry = elapsedMs >= 60000
    ? await tx.timeEntry.create({
      data: {
        userId: session.userId,
        projectId: session.projectId,
        taskId: session.taskId ?? null,
        description: session.description ?? null,
        duration: Math.min(duration, MAX_TIME_ENTRY_MINUTES),
        date: session.startTime,
        billable: session.billable ?? true,
        source: 'TIMER',
        timeSessionId: session.id,
      },
    })
    : null;
  return { duration, timeEntry };
}

/**
 * Start a new timer, stopping (and recording) any running one first.
 */
export async function startTimer(userId, projectId, taskId = null, description = null) {
  try {
    return await prisma.$transaction(async (tx) => {
      const running = await tx.timeSession.findMany({ where: { userId, isRunning: true } });
      const endTime = new Date();
      for (const session of running) await closeSession(tx, session, endTime);
      return tx.timeSession.create({
        data: {
          userId,
          projectId,
          taskId,
          description,
          startTime: new Date(),
          isRunning: true,
          billable: true,
        },
        include: SESSION_INCLUDE,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new TimerError(409, 'TIMER_ALREADY_RUNNING', 'Another timer was started at the same moment. Refresh to see the running timer.');
    }
    throw err;
  }
}

/**
 * Stop the caller's running timer and create its TimeEntry atomically.
 */
export async function stopTimer(sessionId, userId) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.timeSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new TimerError(404, 'TIMER_NOT_FOUND', 'Timer not found');
    if (!session.isRunning) throw new TimerError(409, 'TIMER_NOT_RUNNING', 'This timer is already stopped');
    const closed = await closeSession(tx, session);
    if (!closed) throw new TimerError(409, 'TIMER_NOT_RUNNING', 'This timer is already stopped');
    const stopped = await tx.timeSession.findFirst({ where: { id: sessionId, userId }, include: SESSION_INCLUDE });
    return { ...stopped, timeEntry: closed.timeEntry };
  });
}

/**
 * Stop all running timers for a user, recording a TimeEntry for each.
 */
export async function stopAllRunningTimers(userId) {
  return prisma.$transaction(async (tx) => {
    const running = await tx.timeSession.findMany({ where: { userId, isRunning: true } });
    const endTime = new Date();
    let stopped = 0;
    for (const session of running) {
      if (await closeSession(tx, session, endTime)) stopped += 1;
    }
    return stopped;
  });
}

/**
 * Record manually logged time as a TimeEntry (source MANUAL), the record that
 * reports, timesheets and budgets read. (It used to create a finished
 * TimeSession that nothing billed.) Duration is in minutes, max 1440.
 */
export async function createManualEntry(userId, projectId, data) {
  const { taskId, duration, description, billable, date } = data;

  return prisma.timeEntry.create({
    data: {
      userId,
      projectId,
      taskId: taskId ?? null,
      duration: Math.round(duration),
      description: description ?? null,
      billable: billable ?? true,
      date: date ? new Date(date) : new Date(),
      source: 'MANUAL',
    },
    include: SESSION_INCLUDE,
  });
}

/**
 * Get time summary for a user/project/date range
 */
// The summary lists at most this many recent entries; totals cover all of them.
const SUMMARY_ENTRY_LIMIT = 100;

export async function getTimeSummary(userId, filters = {}) {
  const { projectId, startDate, endDate } = filters;
  const range = (startDate || endDate)
    ? { ...(startDate ? { gte: new Date(startDate) } : {}), ...(endDate ? { lte: new Date(endDate) } : {}) }
    : undefined;

  // TimeEntry is the canonical record: stopped timers (source TIMER) and
  // manual entries both live there. Timer sessions stopped before timers
  // recorded entries (no linked TimeEntry) are counted too, once each.
  // Totals come from groupBy aggregates, so they cover every record; only the
  // listed entries are limited (reads of soft-deletable models cap at 100).
  const entryWhere = { userId, ...(projectId ? { projectId } : {}), ...(range ? { date: range } : {}) };
  const sessionWhere = {
    userId, isRunning: false, timeEntry: null,
    ...(projectId ? { projectId } : {}), ...(range ? { startTime: range } : {}),
  };
  const [entryGroups, sessionGroups, entryCount, sessionCount, recentEntries, recentSessions] = await Promise.all([
    prisma.timeEntry.groupBy({ by: ['projectId', 'billable'], where: entryWhere, _sum: { duration: true } }),
    prisma.timeSession.groupBy({ by: ['projectId', 'billable'], where: sessionWhere, _sum: { duration: true } }),
    prisma.timeEntry.count({ where: entryWhere }),
    prisma.timeSession.count({ where: sessionWhere }),
    prisma.timeEntry.findMany({ where: entryWhere, include: SESSION_INCLUDE, orderBy: { date: 'desc' }, take: SUMMARY_ENTRY_LIMIT }),
    prisma.timeSession.findMany({ where: sessionWhere, include: SESSION_INCLUDE, orderBy: { startTime: 'desc' }, take: SUMMARY_ENTRY_LIMIT }),
  ]);

  const projectTotals = new Map();
  let totalMinutes = 0;
  let billableMinutes = 0;
  for (const group of [...entryGroups, ...sessionGroups]) {
    const minutes = group._sum?.duration ?? 0;
    const totals = projectTotals.get(group.projectId) ?? { totalMinutes: 0, billableMinutes: 0 };
    totals.totalMinutes += minutes;
    totalMinutes += minutes;
    if (group.billable) {
      totals.billableMinutes += minutes;
      billableMinutes += minutes;
    }
    projectTotals.set(group.projectId, totals);
  }

  const entries = [
    ...recentEntries.map((entry) => ({
      id: entry.id, kind: 'entry', source: entry.source ?? 'MANUAL', date: entry.date,
      duration: entry.duration, billable: entry.billable, description: entry.description ?? null,
      projectId: entry.projectId, project: entry.project, taskId: entry.taskId ?? null, task: entry.task ?? null,
    })),
    ...recentSessions.map((session) => ({
      id: session.id, kind: 'session', source: 'TIMER', date: session.startTime,
      duration: session.duration, billable: session.billable, description: session.description ?? null,
      projectId: session.projectId, project: session.project, taskId: session.taskId ?? null, task: session.task ?? null,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, SUMMARY_ENTRY_LIMIT);

  // Project names for every project with time (read in pages of 100).
  const projectIds = [...projectTotals.keys()];
  const projects = new Map();
  for (let i = 0; i < projectIds.length; i += 100) {
    const page = await prisma.project.findMany({ where: { id: { in: projectIds.slice(i, i + 100) } }, select: { id: true, name: true } });
    for (const project of page) projects.set(project.id, project);
  }
  const byProject = projectIds.map((id) => ({
    project: projects.get(id) ?? { id, name: null },
    ...projectTotals.get(id),
    entries: entries.filter((entry) => entry.projectId === id),
  }));

  return {
    totalMinutes,
    totalHours: Math.round(totalMinutes / 60 * 100) / 100,
    billableMinutes,
    billableHours: Math.round(billableMinutes / 60 * 100) / 100,
    nonBillableMinutes: totalMinutes - billableMinutes,
    entryCount: entryCount + sessionCount,
    entries,
    entriesTruncated: entryCount + sessionCount > entries.length,
    byProject,
  };
}

/**
 * Delete one of the caller's (stopped) timer sessions. The TimeEntry it
 * produced is kept; its timeSessionId link is cleared by the foreign key.
 */
export async function deleteTimeEntry(sessionId, userId) {
  const session = await prisma.timeSession.findFirst({ where: { id: sessionId, userId } });

  if (!session) throw new TimerError(404, 'TIMER_NOT_FOUND', 'Timer not found');
  if (session.isRunning) throw new TimerError(409, 'TIMER_RUNNING', 'Cannot delete a running timer — stop it first');

  const deleted = await prisma.timeSession.deleteMany({ where: { id: sessionId, userId, isRunning: false } });
  if (deleted.count !== 1) throw new TimerError(404, 'TIMER_NOT_FOUND', 'Timer not found');
  return { success: true };
}

/**
 * Get currently running timer for a user
 */
export async function getRunningTimer(userId) {
  return prisma.timeSession.findFirst({
    where: { userId, isRunning: true },
    include: SESSION_INCLUDE,
  });
}
