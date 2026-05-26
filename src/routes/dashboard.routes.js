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
      // WordPress sites with errors
      wpSitesWithErrors,
      // Overdue tasks (not on blocked projects, standalone)
      overdueTasks,
      // ── NEW ──
      // Time tracking: today + this week
      timeToday,
      timeThisWeek,
      userCapacity,
      // Calendar events (upcoming 7 days)
      upcomingEvents,
      // Outreach funnel stats
      outreachStats,
      // Cold email stats
      coldEmailStats,
      // LinkedIn stats
      linkedInStats,
      // Revenue history (last 6 months)
      revenueHistory,
      // All WP sites (for health heatmap)
      allWpSites
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
      // WordPress sites with errors or low health
      request.prisma.wPSite.findMany({
        where: {
          OR: [
            { status: 'ERROR' },
            { healthScore: { lt: 60 } },
            { status: 'MAINTENANCE' }
          ]
        },
        select: {
          id: true,
          name: true,
          url: true,
          status: true,
          healthScore: true,
          lastCheckedAt: true,
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } }
        },
        orderBy: { healthScore: 'asc' },
        take: 10
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
      // Time tracking: today's entries for current user
      request.prisma.timeEntry.findMany({
        where: {
          userId: request.user.id,
          date: { gte: startOfDay }
        },
        select: { duration: true, billable: true }
      }),
      // Time tracking: this week's entries for current user
      request.prisma.timeEntry.findMany({
        where: {
          userId: request.user.id,
          date: { gte: startOfWeek }
        },
        select: { duration: true, billable: true }
      }),
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
      // Outreach pipeline: funnel counts
      request.prisma.outreachLead.groupBy({
        by: ['status'],
        _count: { id: true }
      }),
      // Cold email stats: aggregate from prospect statuses
      request.prisma.coldEmailProspect.groupBy({
        by: ['status'],
        _count: { id: true }
      }),
      // LinkedIn stats: aggregate from sequence statuses
      request.prisma.linkedInSequence.groupBy({
        by: ['status'],
        _count: { id: true }
      }),
      // Revenue history: last 6 months of paid invoices
      request.prisma.invoice.findMany({
        where: {
          status: 'PAID',
          paidAt: { gte: sixMonthsAgo }
        },
        select: { total: true, paidAt: true },
        orderBy: { paidAt: 'asc' }
      }),
      // All WP sites for health heatmap (not just errors)
      request.prisma.wPSite.findMany({
        select: {
          id: true, name: true, url: true, status: true,
          healthScore: true, lastCheckedAt: true,
          client: { select: { name: true } },
          project: { select: { name: true } }
        },
        orderBy: { healthScore: 'asc' }
      })
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
      wpSiteAlerts: wpSitesWithErrors.map(s => ({
        id: s.id,
        name: s.name,
        url: s.url,
        status: s.status,
        healthScore: s.healthScore,
        lastCheckedAt: s.lastCheckedAt,
        client: s.client?.name || null,
        project: s.project?.name || null
      })),
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
      // Time tracking for current user
      timeTracking: {
        today: timeToday.reduce((sum, e) => sum + (e.duration || 0), 0),
        todayBillable: timeToday.filter(e => e.billable).reduce((sum, e) => sum + (e.duration || 0), 0),
        week: timeThisWeek.reduce((sum, e) => sum + (e.duration || 0), 0),
        weekBillable: timeThisWeek.filter(e => e.billable).reduce((sum, e) => sum + (e.duration || 0), 0),
        capacity: userCapacity?.capacity ?? 100,
        userName: userCapacity?.name ?? null,
        weekGoalHours: 40
      },
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
      // Outreach pipeline funnel
      outreach: outreachStats.reduce((acc, row) => {
        acc[row.status.toLowerCase()] = row._count.id;
        return acc;
      }, {}),
      // Cold email stats
      coldEmail: coldEmailStats.reduce((acc, row) => {
        acc[row.status.toLowerCase()] = row._count.id;
        return acc;
      }, {}),
      // LinkedIn outreach stats
      linkedIn: linkedInStats.reduce((acc, row) => {
        acc[row.status.toLowerCase()] = row._count.id;
        return acc;
      }, {}),
      // Revenue sparkline data: grouped by month
      revenueHistory: (() => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const grouped = {};
        revenueHistory.forEach(inv => {
          const d = new Date(inv.paidAt);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          grouped[key] = (grouped[key] || 0) + (inv.total || 0);
        });
        return Object.entries(grouped).map(([key, total]) => ({
          month: months[parseInt(key.split('-')[1]) - 1],
          year: key.split('-')[0],
          total: Math.round(total * 100) / 100
        }));
      })(),
      // All WP sites for heatmap
      wpSites: allWpSites.map(s => ({
        id: s.id,
        name: s.name,
        url: s.url,
        status: s.status,
        healthScore: s.healthScore,
        lastCheckedAt: s.lastCheckedAt,
        client: s.client?.name || null,
        project: s.project?.name || null
      }))
    };
  });
}
