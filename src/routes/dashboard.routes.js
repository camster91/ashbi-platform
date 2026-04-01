// Dashboard stats — single endpoint for the command center
import { prisma } from '../index.js';

export default async function dashboardRoutes(fastify) {
  // GET /api/dashboard/stats — all numbers in one call
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
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
      activeClients
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
      clientHealth
    };
  });
}
