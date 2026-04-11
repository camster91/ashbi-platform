// Time Tracking service
// Migrated from ashbi-hub to Prisma

import { prisma } from '../index.js';

/**
 * Start a new time tracking session
 */
export async function startTimer(userId, projectId, taskId = null, description = null) {
  // Stop any running timers for this user first
  await stopAllRunningTimers(userId);

  return prisma.timeSession.create({
    data: {
      userId,
      projectId,
      taskId,
      description,
      startTime: new Date(),
      isRunning: true,
      billable: true
    },
    include: {
      project: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } }
    }
  });
}

/**
 * Stop a running timer
 */
export async function stopTimer(sessionId) {
  const session = await prisma.timeSession.findUnique({ where: { id: sessionId } });

  if (!session || !session.isRunning) {
    throw new Error('No running timer found');
  }

  const endTime = new Date();
  const durationMs = endTime - session.startTime;
  const durationMinutes = Math.round(durationMs / (1000 * 60));

  return prisma.timeSession.update({
    where: { id: sessionId },
    data: {
      endTime,
      duration: durationMinutes,
      isRunning: false
    },
    include: {
      project: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } }
    }
  });
}

/**
 * Stop all running timers for a user
 */
export async function stopAllRunningTimers(userId) {
  const runningTimers = await prisma.timeSession.findMany({
    where: { userId, isRunning: true }
  });

  const endTime = new Date();

  for (const timer of runningTimers) {
    const durationMinutes = Math.round((endTime - timer.startTime) / (1000 * 60));
    await prisma.timeSession.update({
      where: { id: timer.id },
      data: { endTime, duration: durationMinutes, isRunning: false }
    });
  }

  return runningTimers.length;
}

/**
 * Create a manual time entry
 */
export async function createManualEntry(userId, projectId, data) {
  const { taskId, duration, description, billable, date } = data;

  return prisma.timeSession.create({
    data: {
      userId,
      projectId,
      taskId,
      duration,
      description,
      billable: billable ?? true,
      isRunning: false,
      startTime: date ? new Date(date) : new Date(),
      endTime: date ? new Date(new Date(date).getTime() + duration * 60000) : null
    },
    include: {
      project: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } }
    }
  });
}

/**
 * Get time summary for a user/project/date range
 */
export async function getTimeSummary(userId, filters = {}) {
  const { projectId, startDate, endDate } = filters;

  const where = { userId };
  if (projectId) where.projectId = projectId;
  if (startDate || endDate) {
    where.startTime = {};
    if (startDate) where.startTime.gte = new Date(startDate);
    if (endDate) where.startTime.lte = new Date(endDate);
  }

  const sessions = await prisma.timeSession.findMany({
    where,
    include: {
      project: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } }
    },
    orderBy: { startTime: 'desc' }
  });

  const totalMinutes = sessions.reduce((sum, s) => sum + s.duration, 0);
  const billableMinutes = sessions.filter(s => s.billable).reduce((sum, s) => sum + s.duration, 0);

  // Group by project
  const byProject = sessions.reduce((acc, s) => {
    const key = s.projectId;
    if (!acc[key]) {
      acc[key] = { project: s.project, totalMinutes: 0, billableMinutes: 0, sessions: [] };
    }
    acc[key].totalMinutes += s.duration;
    if (s.billable) acc[key].billableMinutes += s.duration;
    acc[key].sessions.push(s);
    return acc;
  }, {});

  return {
    totalMinutes,
    totalHours: Math.round(totalMinutes / 60 * 100) / 100,
    billableMinutes,
    billableHours: Math.round(billableMinutes / 60 * 100) / 100,
    nonBillableMinutes: totalMinutes - billableMinutes,
    sessions,
    byProject: Object.values(byProject)
  };
}

/**
 * Delete a time entry
 */
export async function deleteTimeEntry(sessionId, userId) {
  const session = await prisma.timeSession.findUnique({ where: { id: sessionId } });

  if (!session) throw new Error('Time entry not found');
  if (session.isRunning) throw new Error('Cannot delete a running timer — stop it first');

  return prisma.timeSession.delete({ where: { id: sessionId } });
}

/**
 * Get currently running timer for a user
 */
export async function getRunningTimer(userId) {
  return prisma.timeSession.findFirst({
    where: { userId, isRunning: true },
    include: {
      project: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } }
    }
  });
}