// Time Tracking routes

import { validateBody, timeEntryCreateNewSchema, timeEntryUpdateNewSchema, timesheetRejectSchema } from '../validators/schemas.js';

/**
 * H6: an APPROVED or invoiced time entry is locked against edit and delete,
 * for its owner and admins alike. An admin reopens an approved entry with
 * the explicit reject action (PATCH /api/timesheets/:id/reject, which needs
 * a reason); invoiced time stays locked because it is already billed.
 *
 * @param {{ reviewStatus?: string, invoiced?: boolean, invoiceId?: string | null }} entry
 * @returns {{ code: string, error: string } | null}
 */
export function timeEntryLock(entry) {
  if (entry.invoiced || entry.invoiceId) {
    return { code: 'TIME_ENTRY_INVOICED', error: 'This time entry has been invoiced and can no longer be changed' };
  }
  if (entry.reviewStatus === 'APPROVED') {
    return { code: 'TIME_ENTRY_APPROVED', error: 'This time entry is approved. An admin must reject it before it can be changed' };
  }
  return null;
}

/**
 * `where` for an entry that is still editable. Edits and deletes are
 * conditional on it, so an approval or invoice that commits after the lock
 * check still wins (the write matches nothing and the caller gets 409).
 * @param {string} id
 */
export function unlockedTimeEntryWhere(id) {
  return { id, deletedAt: null, invoiced: false, invoiceId: null, reviewStatus: { not: 'APPROVED' } };
}

/** Answer a conditional write that matched nothing: 409 with the lock, or 404. */
async function lockedWriteReply(request, reply, id) {
  const current = await request.prisma.timeEntry.findUnique({ where: { id } });
  if (!current) return reply.status(404).send({ error: 'Time entry not found' });
  return reply.status(409).send(timeEntryLock(current) ?? { code: 'TIME_ENTRY_CHANGED', error: 'This time entry changed. Reload and try again' });
}

// Rows read per query when building a weekly timesheet (soft-deletable
// reads are capped at 100 rows each).
const TIMESHEET_PAGE = 100;

export default async function timeRoutes(fastify) {
  // Get time entries for a project
  fastify.get('/projects/:projectId/time-entries', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { projectId } = request.params;
    const {
      userId,
      taskId,
      startDate,
      endDate,
      billable,
      page: pageParam = '1',
      limit: limitParam = '50'
    } = request.query;

    const page = parseInt(pageParam);
    const limit = parseInt(limitParam);

    const where = { projectId };

    if (userId) where.userId = userId;
    if (taskId) where.taskId = taskId;
    if (billable !== undefined) where.billable = billable === 'true';

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [entries, total] = await Promise.all([
      request.prisma.timeEntry.findMany({
        where,
        include: {
          user: { select: { id: true, name: true } },
          task: { select: { id: true, title: true } }
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      request.prisma.timeEntry.count({ where })
    ]);

    // Calculate totals
    const aggregates = await request.prisma.timeEntry.aggregate({
      where,
      _sum: { duration: true }
    });

    const billableAggregates = await request.prisma.timeEntry.aggregate({
      where: { ...where, billable: true },
      _sum: { duration: true }
    });

    return {
      entries,
      totals: {
        totalMinutes: aggregates._sum.duration || 0,
        totalHours: Math.round((aggregates._sum.duration || 0) / 60 * 100) / 100,
        billableMinutes: billableAggregates._sum.duration || 0,
        billableHours: Math.round((billableAggregates._sum.duration || 0) / 60 * 100) / 100
      },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    };
  });

  // Get my time entries
  fastify.get('/time-entries/my', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate, projectId } = request.query;

    const where = { userId: request.user.id };

    if (projectId) where.projectId = projectId;

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const entries = await request.prisma.timeEntry.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } }
      },
      orderBy: { date: 'desc' },
      take: 100
    });

    // Group by date
    const grouped = entries.reduce((acc, entry) => {
      const dateKey = entry.date.toISOString().split('T')[0];
      if (!acc[dateKey]) {
        acc[dateKey] = { entries: [], totalMinutes: 0 };
      }
      acc[dateKey].entries.push(entry);
      acc[dateKey].totalMinutes += entry.duration;
      return acc;
    }, {});

    // Calculate weekly total
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const weeklyTotal = entries
      .filter(e => new Date(e.date) >= weekAgo)
      .reduce((sum, e) => sum + e.duration, 0);

    return {
      grouped,
      weeklyTotalMinutes: weeklyTotal,
      weeklyTotalHours: Math.round(weeklyTotal / 60 * 100) / 100
    };
  });

  // Create time entry
  fastify.post('/time-entries', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(timeEntryCreateNewSchema),
  }, async (request, reply) => {
    const { projectId, taskId, duration, description, date, billable = true } = request.body;

    if (!projectId) {
      return reply.status(400).send({ error: 'Project is required' });
    }

    if (!duration || duration <= 0) {
      return reply.status(400).send({ error: 'Duration must be a positive number' });
    }

    const entry = await request.prisma.timeEntry.create({
      data: {
        description,
        duration: Math.round(duration),
        date: date ? new Date(date) : new Date(),
        billable,
        taskId,
        projectId,
        userId: request.user.id
      },
      include: {
        user: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } }
      }
    });

    // Log activity
    await request.prisma.activity.create({
      data: {
        type: 'TIME_LOGGED',
        action: 'created',
        entityType: 'TIME_ENTRY',
        entityId: entry.id,
        entityName: `${duration} minutes`,
        metadata: JSON.stringify({ duration, taskId }),
        projectId,
        userId: request.user.id
      }
    });

    return reply.status(201).send(entry);
  });

  // Update time entry
  fastify.put('/time-entries/:id', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(timeEntryUpdateNewSchema),
  }, async (request, reply) => {
    const { id } = request.params;
    const { duration, description, date, billable, taskId } = request.body;

    const existing = await request.prisma.timeEntry.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Time entry not found' });
    }

    // Only owner or admin can update
    if (existing.userId !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot edit this time entry' });
    }

    const editLock = timeEntryLock(existing);
    if (editLock) return reply.status(409).send(editLock);

    const data = {};
    if (duration !== undefined) data.duration = Math.round(duration);
    if (description !== undefined) data.description = description;
    if (date !== undefined) data.date = new Date(date);
    if (billable !== undefined) data.billable = billable;
    if (taskId !== undefined) data.taskId = taskId;

    const { count } = await request.prisma.timeEntry.updateMany({ where: unlockedTimeEntryWhere(id), data });
    if (count === 0) return lockedWriteReply(request, reply, id);

    return request.prisma.timeEntry.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } }
      }
    });
  });

  // Delete time entry
  fastify.delete('/time-entries/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await request.prisma.timeEntry.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Time entry not found' });
    }

    // Only owner or admin can delete
    if (existing.userId !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot delete this time entry' });
    }

    const deleteLock = timeEntryLock(existing);
    if (deleteLock) return reply.status(409).send(deleteLock);

    const { count } = await request.prisma.timeEntry.deleteMany({ where: unlockedTimeEntryWhere(id) });
    if (count === 0) return lockedWriteReply(request, reply, id);

    return { success: true };
  });

  // Get time summary by project
  fastify.get('/time-entries/summary', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate } = request.query;

    const where = {};

    // Only admin can see all, team members see their own
    if (request.user.role !== 'ADMIN') {
      where.userId = request.user.id;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const entries = await request.prisma.timeEntry.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } }
      }
    });

    // Group by project
    const byProject = entries.reduce((acc, entry) => {
      const key = entry.projectId;
      if (!acc[key]) {
        acc[key] = {
          project: entry.project,
          totalMinutes: 0,
          billableMinutes: 0,
          entries: 0
        };
      }
      acc[key].totalMinutes += entry.duration;
      if (entry.billable) acc[key].billableMinutes += entry.duration;
      acc[key].entries++;
      return acc;
    }, {});

    // Group by user (admin only)
    let byUser = null;
    if (request.user.role === 'ADMIN') {
      byUser = entries.reduce((acc, entry) => {
        const key = entry.userId;
        if (!acc[key]) {
          acc[key] = {
            user: entry.user,
            totalMinutes: 0,
            entries: 0
          };
        }
        acc[key].totalMinutes += entry.duration;
        acc[key].entries++;
        return acc;
      }, {});
    }

    return {
      byProject: Object.values(byProject),
      byUser: byUser ? Object.values(byUser) : null,
      totalMinutes: entries.reduce((sum, e) => sum + e.duration, 0)
    };
  });

  // ===== TIMESHEET ENDPOINTS =====

  // Get weekly timesheet (aggregated by user + day)
  fastify.get('/timesheets/weekly', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { weekStart } = request.query;
    const start = weekStart ? new Date(weekStart) : (() => {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay()); // Sunday
      d.setHours(0, 0, 0, 0);
      return d;
    })();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    const where = { date: { gte: start, lt: end } };
    if (request.user.role !== 'ADMIN') where.userId = request.user.id;

    // Read the whole week in pages: a single read stops at 100 rows, which
    // would understate the totals.
    const entries = [];
    for (;;) {
      const page = await request.prisma.timeEntry.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, hourlyRate: true } },
          project: { select: { id: true, name: true } },
          task: { select: { id: true, title: true } }
        },
        orderBy: [{ userId: 'asc' }, { date: 'asc' }, { id: 'asc' }],
        skip: entries.length,
        take: TIMESHEET_PAGE,
      });
      entries.push(...page);
      if (page.length < TIMESHEET_PAGE) break;
    }

    // Group by user, then by day
    const byUser = {};
    for (const entry of entries) {
      if (!byUser[entry.userId]) {
        byUser[entry.userId] = { user: entry.user, days: {}, totalMinutes: 0, billableMinutes: 0 };
      }
      const dayKey = entry.date.toISOString().split('T')[0];
      if (!byUser[entry.userId].days[dayKey]) {
        byUser[entry.userId].days[dayKey] = { entries: [], totalMinutes: 0 };
      }
      byUser[entry.userId].days[dayKey].entries.push(entry);
      byUser[entry.userId].days[dayKey].totalMinutes += entry.duration;
      byUser[entry.userId].totalMinutes += entry.duration;
      if (entry.billable) byUser[entry.userId].billableMinutes += entry.duration;
    }

    return {
      weekStart: start.toISOString(),
      weekEnd: end.toISOString(),
      timesheets: Object.values(byUser)
    };
  });

  // Approve a timesheet entry
  fastify.patch('/timesheets/:id/approve', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin only' });
    }

    const { id } = request.params;
    const existing = await request.prisma.timeEntry.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Time entry not found' });

    const entry = await request.prisma.timeEntry.update({
      where: { id },
      data: {
        reviewStatus: 'APPROVED',
        reviewedAt: new Date(),
        reviewedById: request.user.id,
        rejectionReason: null
      }
    });

    return entry;
  });

  // Reject a timesheet entry
  fastify.patch('/timesheets/:id/reject', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(timesheetRejectSchema)
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin only' });
    }

    const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
    if (!reason) return reply.status(400).send({ error: 'Rejection reason is required' });

    const { id } = request.params;
    const existing = await request.prisma.timeEntry.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Time entry not found' });
    if (existing.invoiced || existing.invoiceId) {
      return reply.status(409).send({ code: 'TIME_ENTRY_INVOICED', error: 'This time entry has been invoiced and can no longer be changed' });
    }

    return request.prisma.timeEntry.update({
      where: { id },
      data: {
        reviewStatus: 'REJECTED',
        reviewedAt: new Date(),
        reviewedById: request.user.id,
        rejectionReason: reason
      }
    });
  });
}
