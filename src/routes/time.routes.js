// Time Tracking routes

import { validateBody, timeEntryCreateNewSchema, timeEntryUpdateNewSchema, timesheetRejectSchema } from '../validators/schemas.js';
import { portfolioFilterSchema } from '../validators/schemas.js';
import { portfolioWhere } from '../shared/portfolio.js';

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

async function summaryLabels(delegate, ids, includeArchived = false) {
  const labels = new Map();
  for (let offset = 0; offset < ids.length; offset += TIMESHEET_PAGE) {
    const rows = await delegate.findMany({ where: { id: { in: ids.slice(offset, offset + TIMESHEET_PAGE) } }, select: { id: true, name: true }, take: TIMESHEET_PAGE });
    for (const row of rows) labels.set(row.id, row);
    if (includeArchived) {
      const missing = ids.slice(offset, offset + TIMESHEET_PAGE).filter(id => !labels.has(id));
      if (missing.length) {
        // Explicit archived-only criterion is the reviewed soft-delete escape
        // hatch; the same tenant-scoped delegate remains in use.
        const archived = await delegate.findMany({ where: { id: { in: missing }, deletedAt: { not: null } }, select: { id: true, name: true }, take: TIMESHEET_PAGE });
        for (const row of archived) labels.set(row.id, row);
      }
    }
  }
  return labels;
}

export default async function timeRoutes(fastify) {
  // Get time entries for a project
  fastify.get('/projects/:projectId/time-entries', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId } = request.params;
    const portfolio = portfolioFilterSchema.safeParse(request.query.portfolio);
    if (!portfolio.success) return reply.status(400).send({ error: 'Invalid portfolio filter' });
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
    if (portfolio.data) where.project = portfolioWhere(portfolio.data);

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
  }, async (request, reply) => {
    const { startDate, endDate, projectId } = request.query;
    const portfolio = portfolioFilterSchema.safeParse(request.query.portfolio);
    if (!portfolio.success) return reply.status(400).send({ error: 'Invalid portfolio filter' });

    const where = { userId: request.user.id };
    if (portfolio.data) where.project = portfolioWhere(portfolio.data);

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
  }, async (request, reply) => {
    const { startDate, endDate } = request.query;
    const portfolio = portfolioFilterSchema.safeParse(request.query.portfolio);
    if (!portfolio.success) return reply.status(400).send({ error: 'Invalid portfolio filter' });

    const where = {};
    if (portfolio.data) where.project = portfolioWhere(portfolio.data);

    // Only admin can see all, team members see their own
    if (request.user.role !== 'ADMIN') {
      where.userId = request.user.id;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    // Aggregate in the database: response memory scales with summary groups,
    // rather than loading the tenant's entire time history via OFFSET pages.
    const [projects, billable, users] = await Promise.all([
      request.prisma.timeEntry.groupBy({ by: ['projectId'], where, _sum: { duration: true }, _count: { _all: true } }),
      request.prisma.timeEntry.groupBy({ by: ['projectId'], where: { ...where, billable: true }, _sum: { duration: true } }),
      request.user.role === 'ADMIN' ? request.prisma.timeEntry.groupBy({ by: ['userId'], where, _sum: { duration: true }, _count: { _all: true } }) : Promise.resolve(null),
    ]);
    const [projectLabels, userLabels] = await Promise.all([
      summaryLabels(request.prisma.project, projects.map(row => row.projectId), true),
      summaryLabels(request.prisma.user, users?.map(row => row.userId) ?? []),
    ]);
    const billableByProject = new Map(billable.map(row => [row.projectId, row._sum.duration ?? 0]));
    return {
      byProject: projects.map(row => ({ project: projectLabels.get(row.projectId) ?? { id: row.projectId, name: 'Unavailable project' }, totalMinutes: row._sum.duration ?? 0, billableMinutes: billableByProject.get(row.projectId) ?? 0, entries: row._count._all })),
      byUser: users?.map(row => ({ user: userLabels.get(row.userId) ?? { id: row.userId, name: 'Unavailable teammate' }, totalMinutes: row._sum.duration ?? 0, entries: row._count._all })) ?? null,
      totalMinutes: projects.reduce((sum, row) => sum + (row._sum.duration ?? 0), 0),
    };
  });

  // ===== TIMESHEET ENDPOINTS =====

  // Get weekly timesheet (aggregated by user + day)
  fastify.get('/timesheets/weekly', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { weekStart } = request.query;
    const portfolio = portfolioFilterSchema.safeParse(request.query.portfolio);
    if (!portfolio.success) return reply.status(400).send({ error: 'Invalid portfolio filter' });
    const start = weekStart ? new Date(weekStart) : (() => {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay()); // Sunday
      d.setHours(0, 0, 0, 0);
      return d;
    })();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    const where = { date: { gte: start, lt: end } };
    if (portfolio.data) where.project = portfolioWhere(portfolio.data);
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
