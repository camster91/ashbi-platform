// Dashboard stats — single endpoint for the command center

export default async function dashboardRoutes(fastify) {
  // GET /api/dashboard/stats — all numbers in one call
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      // MRR — sum of monthlyAmountUsd for active retainers
      activeRetainers,
      // Outstanding invoices
      outstandingInvoices,
      // Active projects
      activeProjectCount,
      // Pending approvals
      pendingApprovalCount,
      // Recent activity (last 10)
      recentActivity,
      // Unread notifications for current user
      unreadNotifications,
      // Client health grid
      activeClients,
      // Blocked / at-risk projects (with tasks or project-level issues)
      atRiskProjects,
      // Untriaged inbox threads
      untriagedThreads,
      // Overdue tasks (not on blocked projects, standalone)
      overdueTasks,
      // ── NEW ──
      // Time tracking: today + this week
      timeToday,
      timeThisWeek,
      userCapacity,
      // Calendar events (upcoming 7 days)
      upcomingEvents,
      // Revenue history (last 6 months)
      revenueHistory
    ] = await Promise.all([
      request.prisma.retainerPlan.findMany({
        where: { retainerStatus: 'ACTIVE' },
        select: { monthlyAmountUsd: true }
      }),
      request.prisma.invoice.findMany({
        where: { status: { in: ['SENT', 'OVERDUE'] } },
        select: { total: true, status: true, dueDate: true }
      }),
      request.prisma.project.count({
        where: { status: { notIn: ['LAUNCHED', 'CANCELLED', 'ON_HOLD'] } }
      }),
      request.prisma.approval.count({
        where: { status: 'PENDING' }
      }),
      request.prisma.activity.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          user: { select: { id: true, name: true } },
          project: {
            select: {
              id: true, name: true,
              client: { select: { id: true, name: true } }
            }
          }
        }
      }),
      request.prisma.notification.findMany({
        where: {
          userId: request.user.id,
          read: false
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      request.prisma.client.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { retainerPlan: { retainerStatus: 'ACTIVE' } },
            { projects: { some: { status: { notIn: ['LAUNCHED', 'CANCELLED', 'ON_HOLD'] } } } }
          ]
        },
        select: {
          id: true,
          name: true,
          status: true,
          retainerPlan: {
            select: {
              retainerStatus: true,
              monthlyAmountUsd: true,
              tier: true
            }
          },
          projects: {
            where: { status: { notIn: ['LAUNCHED', 'CANCELLED'] } },
            select: {
              id: true,
              name: true,
              health: true,
              healthScore: true,
              status: true,
              updatedAt: true
            },
            orderBy: { updatedAt: 'desc' },
            take: 5
          }
        }
      }),
      // Projects with AT_RISK or NEEDS_ATTENTION health, or ON_HOLD status
      request.prisma.project.findMany({
        where: {
          OR: [
            { health: { in: ['AT_RISK', 'NEEDS_ATTENTION'] } },
            { status: 'ON_HOLD' },
            { tasks: { some: { status: 'BLOCKED' } } }
          ]
        },
        select: {
          id: true,
          name: true,
          status: true,
          health: true,
          healthScore: true,
          endDate: true,
          client: { select: { id: true, name: true } },
          tasks: {
            where: { status: 'BLOCKED' },
            select: { id: true, title: true, dueDate: true, blockedBy: true },
            take: 3
          },
          _count: { select: { tasks: true } }
        },
        take: 10
      }),
      // Untriaged inbox threads (needsTriage or OPEN without resolved status)
      request.prisma.thread.findMany({
        where: {
          OR: [
            { needsTriage: true },
            { status: 'OPEN' }
          ],
          status: { not: 'RESOLVED' }
        },
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          lastActivityAt: true,
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } }
        },
        orderBy: { lastActivityAt: 'desc' },
        take: 5
      }),
      // Overdue tasks (due date passed, not completed)
      request.prisma.task.findMany({
        where: {
          status: { notIn: ['COMPLETED'] },
          dueDate: { lt: now }
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          status: true,
          priority: true,
          project: {
            select: {
              id: true,
              name: true,
              client: { select: { id: true, name: true } }
            }
          },
          assignee: { select: { id: true, name: true } }
        },
        orderBy: { dueDate: 'asc' },
        take: 10
      }),
      // ── NEW QUERIES ──
      // Time tracking: today's entries for current user.
      // PERFORMANCE (audit 2026-07-09, swarm finding): previously loaded
      // every row just to sum duration in JS — at hundreds of entries
      // per day the JS-reduce becomes the bottleneck. Aggregate in SQL
      // with two groupBy predicates: all entries + billable entries.
      // Promise.all runs both at once.
      Promise.all([
        request.prisma.timeEntry.aggregate({
          where: { userId: request.user.id, date: { gte: startOfDay } },
          _sum: { duration: true }
        }),
        request.prisma.timeEntry.aggregate({
          where: { userId: request.user.id, date: { gte: startOfDay }, billable: true },
          _sum: { duration: true }
        })
      ]).then(([all, billable]) => ({
        duration: all._sum.duration ?? 0,
        billableTotal: billable._sum.duration ?? 0
      })),
      // Time tracking: this week's entries for current user.
      Promise.all([
        request.prisma.timeEntry.aggregate({
          where: { userId: request.user.id, date: { gte: startOfWeek } },
          _sum: { duration: true }
        }),
        request.prisma.timeEntry.aggregate({
          where: { userId: request.user.id, date: { gte: startOfWeek }, billable: true },
          _sum: { duration: true }
        })
      ]).then(([all, billable]) => ({
        duration: all._sum.duration ?? 0,
        billableTotal: billable._sum.duration ?? 0
      })),
      // Current user capacity (used for "available bandwidth" calc)
      request.prisma.user.findUnique({
        where: { id: request.user.id },
        select: { capacity: true, name: true }
      }),
      // Upcoming calendar events (next 7 days)
      request.prisma.calendarEvent.findMany({
        where: {
          startTime: { gte: now, lt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) }
        },
        select: {
          id: true, title: true, startTime: true, endTime: true,
          type: true, color: true, location: true, isAllDay: true,
          project: { select: { id: true, name: true } }
        },
        orderBy: { startTime: 'asc' },
        take: 10
      }),
      // Revenue history: last 6 months of paid invoices
      // PERFORMANCE (audit 2026-07-09, swarm finding): previous version
      // loaded EVERY paid invoice for the last 6 months then reduced in
      // JS. At 50k PAID invoices per org that's 50k rows on every
      // dashboard load. Aggregate by month in SQL — 6 rows back, regardless
      // of org size.
      request.prisma.$queryRaw`
        SELECT
          date_trunc('month', "paidAt") AS month,
          SUM(total)::float AS revenue,
          COUNT(*)::int AS invoice_count
        FROM "Invoice"
        WHERE status = 'PAID' AND "paidAt" >= ${sixMonthsAgo}::timestamptz
        GROUP BY month
        ORDER BY month ASC
      `
    ]);

    // Calculate MRR
    const mrr = activeRetainers.reduce((sum, r) => sum + (r.monthlyAmountUsd || 0), 0);

    // Outstanding totals
    const totalOutstanding = outstandingInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const overdueInvoices = outstandingInvoices.filter(inv => inv.status === 'OVERDUE' || (inv.dueDate && new Date(inv.dueDate) < now));
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

    // Build client health grid with computed fields
    const clientHealth = activeClients.map(client => {
      const lastActivity = client.projects.length > 0
        ? client.projects[0].updatedAt
        : null;

      // Compute health score: average of project health scores, or 100 if no projects
      const projectScores = client.projects.map(p => p.healthScore || 100);
      const avgHealth = projectScores.length > 0
        ? Math.round(projectScores.reduce((a, b) => a + b, 0) / projectScores.length)
        : 100;

      // Determine worst health status
      const healthStatuses = client.projects.map(p => p.health);
      let worstHealth = 'ON_TRACK';
      if (healthStatuses.includes('AT_RISK')) worstHealth = 'AT_RISK';
      else if (healthStatuses.includes('NEEDS_ATTENTION')) worstHealth = 'NEEDS_ATTENTION';

      return {
        id: client.id,
        name: client.name,
        healthScore: avgHealth,
        healthStatus: worstHealth,
        retainerStatus: client.retainerPlan?.retainerStatus || null,
        retainerTier: client.retainerPlan?.tier || null,
        monthlyAmount: client.retainerPlan?.monthlyAmountUsd || 0,
        activeProjects: client.projects.length,
        lastActivity
      };
    });

    return {
      mrr,
      totalOutstanding,
      overdueAmount,
      overdueCount: overdueInvoices.length,
      activeProjects: activeProjectCount,
      pendingApprovals: pendingApprovalCount,
      recentActivity,
      unreadNotifications,
      clientHealth,
      // New: Pilot's cockpit widgets
      atRiskProjects: atRiskProjects.map(p => ({
        id: p.id,
        name: p.name,
        status: p.status,
        health: p.health,
        healthScore: p.healthScore,
        endDate: p.endDate,
        client: p.client,
        blockedTasks: p.tasks.map(t => ({
          id: t.id,
          title: t.title,
          dueDate: t.dueDate,
          blockedBy: t.blockedBy
        })),
        totalTasks: p._count.tasks
      })),
      inboxTriage: {
        untriagedCount: untriagedThreads.length,
        latest: untriagedThreads.map(t => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          lastActivityAt: t.lastActivityAt,
          client: t.client?.name || null,
          project: t.project?.name || null
        }))
      },
      // wpSiteAlerts + wpSites kept as empty arrays for backward compat with the
      // dashboard frontend widgets that may still reference these keys. Pre-strip-down
      // had WordPress / Outreach funnel widgets populated from these — with the
      // Batches 1-6 cuts they no longer fetch from the dropped models. Frontend
      // widgets no-op on empty arrays (OutreachFunnelWidget and WPSiteHealthWidget
      // both return null when their data is empty).
      wpSiteAlerts: [],
      wpSites: [],
      overdueTasks: overdueTasks.map(t => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        status: t.status,
        priority: t.priority,
        project: t.project?.name || null,
        client: t.project?.client?.name || null,
        assignee: t.assignee?.name || null
      })),
      // ── NEW WIDGET DATA ──
      // Time tracking for current user.
      // PERFORMANCE (audit 2026-07-09, swarm finding): now fed by SQL
      // aggregates (`timeToday.duration` / `timeWeek.duration`) instead of
      // loading every row and reducing in JS. billable breakdown is
      // computed via a second cheap aggregate on the same predicate set.
      timeTracking: (() => {
        const todayBillable = timeToday.billableTotal ?? 0;
        const weekBillable  = timeThisWeek.billableTotal ?? 0;
        return {
          today: timeToday.duration ?? 0,
          todayBillable,
          week: timeThisWeek.duration ?? 0,
          weekBillable,
          capacity: userCapacity?.capacity ?? 100,
          userName: userCapacity?.name ?? null,
          weekGoalHours: 40
        };
      })(),
      // Upcoming calendar events
      upcomingEvents: upcomingEvents.map(e => ({
        id: e.id,
        title: e.title,
        startTime: e.startTime,
        endTime: e.endTime,
        type: e.type,
        color: e.color,
        location: e.location,
        isAllDay: e.isAllDay,
        project: e.project?.name || null
      })),
      // Outreach / Cold Email / LinkedIn stats kept as empty objects for backward
      // compat with OutreachFunnelWidget (returns null when all three are empty).
      outreach: {},
      coldEmail: {},
      linkedIn: {},
      // Revenue sparkline data: grouped by month.
      // PERFORMANCE (audit 2026-07-09): revenueHistory is now the
      // 6-row aggregate from `date_trunc('month', ...)` above (one row
      // per month). Loop fills any missing months with zero so the chart
      // has a stable 6-element shape.
      revenueHistory: (() => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const grouped = {};
        (revenueHistory || []).forEach(row => {
          const d = new Date(row.month);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          grouped[key] = (grouped[key] || 0) + (Number(row.revenue) || 0);
        });
        return Object.entries(grouped).map(([key, total]) => ({
          month: months[parseInt(key.split('-')[1]) - 1],
          year: key.split('-')[0],
          total: Math.round(total * 100) / 100
        }));
      })()
    };
  });
}
