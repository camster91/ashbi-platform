// Dashboard stats — single endpoint for the command center
import prisma from '../config/db.js';

// Simple in-memory cache: key -> { data, timestamp }
// Dashboard stats change infrequently — cache for 30s to avoid 11 DB round-trips on every load
const statsCache = new Map();
const CACHE_TTL_MS = 30_000; // 30 seconds, matching frontend refetchInterval

function getCachedStats(orgId) {
  const entry = statsCache.get(orgId);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCachedStats(orgId, data) {
  statsCache.set(orgId, { data, timestamp: Date.now() });
}

export default async function dashboardRoutes(fastify) {
  // GET /api/dashboard/stats — all numbers in one call
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    // Check cache first
    const orgId = request.user?.organizationId || 'default';
    const cached = getCachedStats(orgId);
    if (cached) {
      return cached;
    }

    const now = new Date();

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
      overdueTasks
    ] = await Promise.all([
      prisma.retainerPlan.findMany({
        where: { retainerStatus: 'ACTIVE' },
        select: { monthlyAmountUsd: true }
      }),
      prisma.invoice.findMany({
        where: { status: { in: ['SENT', 'OVERDUE'] } },
        select: { total: true, status: true, dueDate: true }
      }),
      prisma.project.count({
        where: { status: { notIn: ['LAUNCHED', 'CANCELLED', 'ON_HOLD'] } }
      }),
      prisma.approval.count({
        where: { status: 'PENDING' }
      }),
      prisma.activity.findMany({
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
      prisma.notification.findMany({
        where: {
          userId: request.user.id,
          read: false
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      prisma.client.findMany({
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
      prisma.project.findMany({
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
      prisma.thread.findMany({
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
      prisma.wPSite.findMany({
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
      prisma.task.findMany({
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

    const result = {
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
      }))
    };

    // Cache the result before returning
    setCachedStats(orgId, result);

    return result;
  });
}
