// Analytics routes

import { prisma } from '../index.js';

export default async function analyticsRoutes(fastify) {
  fastify.get('/overview', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { days = 30 } = request.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const [
      totalThreads,
      openThreads,
      resolvedThreads,
      totalClients,
      activeProjects,
      pendingResponses,
      threadsThisPeriod,
      resolvedThisPeriod
    ] = await Promise.all([
      prisma.thread.count(),
      prisma.thread.count({ where: { status: { not: 'RESOLVED' } } }),
      prisma.thread.count({ where: { status: 'RESOLVED' } }),
      prisma.client.count({ where: { status: 'ACTIVE' } }),
      prisma.project.count({ where: { status: 'ACTIVE' } }),
      prisma.response.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.thread.count({ where: { createdAt: { gte: startDate } } }),
      prisma.thread.count({
        where: {
          status: 'RESOLVED',
          updatedAt: { gte: startDate }
        }
      })
    ]);

    // Project health breakdown
    const projectHealth = await prisma.project.groupBy({
      by: ['health'],
      where: { status: 'ACTIVE' },
      _count: true
    });

    // Priority breakdown
    const priorityBreakdown = await prisma.thread.groupBy({
      by: ['priority'],
      where: { status: { not: 'RESOLVED' } },
      _count: true
    });

    return {
      summary: {
        totalThreads,
        openThreads,
        resolvedThreads,
        resolutionRate: totalThreads > 0 ? Math.round((resolvedThreads / totalThreads) * 100) : 0,
        totalClients,
        activeProjects,
        pendingResponses
      },
      period: {
        days: parseInt(days),
        newThreads: threadsThisPeriod,
        resolvedThreads: resolvedThisPeriod
      },
      projectHealth: projectHealth.reduce((acc, item) => {
        acc[item.health] = item._count;
        return acc;
      }, {}),
      priorityBreakdown: priorityBreakdown.reduce((acc, item) => {
        acc[item.priority] = item._count;
        return acc;
      }, {})
    };
  });

  // Response time analytics
  fastify.get('/response-times', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { days = 30, groupBy = 'day' } = request.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get responses with timing data
    const responses = await prisma.response.findMany({
      where: {
        status: 'SENT',
        sentAt: { gte: startDate }
      },
      include: {
        thread: {
          select: {
            priority: true,
            createdAt: true,
            messages: {
              orderBy: { receivedAt: 'asc' },
              take: 1,
              select: { receivedAt: true }
            }
          }
        }
      }
    });

    // Calculate response times
    const responseTimes = responses.map(r => {
      const threadStart = r.thread.messages[0]?.receivedAt || r.thread.createdAt;
      const responseTime = (r.sentAt.getTime() - threadStart.getTime()) / (1000 * 60 * 60); // Hours
      return {
        priority: r.thread.priority,
        responseTimeHours: responseTime,
        date: r.sentAt
      };
    });

    // Calculate averages by priority
    const byPriority = {};
    responseTimes.forEach(rt => {
      if (!byPriority[rt.priority]) {
        byPriority[rt.priority] = [];
      }
      byPriority[rt.priority].push(rt.responseTimeHours);
    });

    const averageByPriority = {};
    Object.entries(byPriority).forEach(([priority, times]) => {
      averageByPriority[priority] = Math.round(
        (times.reduce((a, b) => a + b, 0) / times.length) * 10
      ) / 10;
    });

    return {
      period: { days: parseInt(days) },
      totalResponses: responses.length,
      averageByPriority,
      overallAverage: responseTimes.length > 0
        ? Math.round((responseTimes.reduce((a, b) => a + b.responseTimeHours, 0) / responseTimes.length) * 10) / 10
        : 0
    };
  });

  // Team performance
  fastify.get('/team', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { days = 30 } = request.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const team = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        role: true,
        _count: {
          select: {
            assignedThreads: true,
            draftedResponses: {
              where: { createdAt: { gte: startDate } }
            },
            approvedResponses: {
              where: { approvedAt: { gte: startDate } }
            }
          }
        }
      }
    });

    // Get resolved threads per user
    const resolvedByUser = await prisma.thread.groupBy({
      by: ['assignedToId'],
      where: {
        status: 'RESOLVED',
        updatedAt: { gte: startDate },
        assignedToId: { not: null }
      },
      _count: true
    });

    const resolvedMap = resolvedByUser.reduce((acc, item) => {
      acc[item.assignedToId] = item._count;
      return acc;
    }, {});

    return team.map(member => ({
      id: member.id,
      name: member.name,
      role: member.role,
      activeThreads: member._count.assignedThreads,
      responsesCreated: member._count.draftedResponses,
      responsesApproved: member._count.approvedResponses,
      threadsResolved: resolvedMap[member.id] || 0
    }));
  });

  // Client insights
  fastify.get('/clients', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const clients = await prisma.client.findMany({
      where: { status: 'ACTIVE' },
      include: {
        _count: {
          select: {
            threads: true,
            projects: true
          }
        },
        threads: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { sentiment: true, priority: true }
        }
      }
    });

    return clients.map(client => {
      // Calculate sentiment distribution
      const sentiments = client.threads.reduce((acc, t) => {
        if (t.sentiment) {
          acc[t.sentiment] = (acc[t.sentiment] || 0) + 1;
        }
        return acc;
      }, {});

      // Calculate priority distribution
      const priorities = client.threads.reduce((acc, t) => {
        acc[t.priority] = (acc[t.priority] || 0) + 1;
        return acc;
      }, {});

      return {
        id: client.id,
        name: client.name,
        totalThreads: client._count.threads,
        totalProjects: client._count.projects,
        sentimentBreakdown: sentiments,
        priorityBreakdown: priorities
      };
    });
  });

  // Dashboard stats (aggregated view for main dashboard)
  fastify.get('/dashboard', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
    endOfWeek.setHours(23, 59, 59, 999);

    const [
      activeProjects,
      outstandingInvoices,
      tasksDueThisWeek,
      recentActivity,
      projectsByStatus
    ] = await Promise.all([
      // Active projects (not LAUNCHED, CANCELLED)
      prisma.project.count({
        where: { status: { notIn: ['LAUNCHED', 'CANCELLED'] } }
      }),
      // Outstanding invoices (SENT + OVERDUE)
      prisma.invoice.findMany({
        where: { status: { in: ['SENT'] } },
        select: { total: true, dueDate: true }
      }),
      // Tasks due this week
      prisma.task.count({
        where: {
          status: { not: 'COMPLETED' },
          dueDate: { lte: endOfWeek, gte: now }
        }
      }),
      // Recent activity
      prisma.activity.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          user: { select: { id: true, name: true } },
          project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } }
        }
      }),
      // Projects by status
      prisma.project.groupBy({
        by: ['status'],
        _count: true
      })
    ]);

    // Calculate outstanding + overdue
    const totalOutstanding = outstandingInvoices.reduce((sum, inv) => sum + inv.total, 0);
    const overdueInvoices = outstandingInvoices.filter(inv => inv.dueDate && new Date(inv.dueDate) < now);
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + inv.total, 0);

    return {
      activeProjects,
      totalOutstanding,
      overdueAmount,
      overdueCount: overdueInvoices.length,
      tasksDueThisWeek,
      recentActivity,
      projectsByStatus: projectsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {})
    };
  });

  // AI accuracy metrics
  fastify.get('/ai-accuracy', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { days = 30 } = request.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Count threads with high confidence matches
    const [
      totalMatched,
      highConfidenceMatches,
      needsTriageCount,
      aiGeneratedResponses,
      approvedAiResponses
    ] = await Promise.all([
      prisma.thread.count({
        where: {
          createdAt: { gte: startDate },
          matchConfidence: { gt: 0 }
        }
      }),
      prisma.thread.count({
        where: {
          createdAt: { gte: startDate },
          matchConfidence: { gte: 0.85 }
        }
      }),
      prisma.thread.count({
        where: {
          createdAt: { gte: startDate },
          needsTriage: true
        }
      }),
      prisma.response.count({
        where: {
          createdAt: { gte: startDate },
          aiGenerated: true
        }
      }),
      prisma.response.count({
        where: {
          createdAt: { gte: startDate },
          aiGenerated: true,
          status: { in: ['APPROVED', 'SENT'] }
        }
      })
    ]);

    return {
      period: { days: parseInt(days) },
      matching: {
        totalMatched,
        highConfidenceMatches,
        autoMatchRate: totalMatched > 0
          ? Math.round((highConfidenceMatches / totalMatched) * 100)
          : 0,
        needsTriage: needsTriageCount
      },
      responses: {
        aiGenerated: aiGeneratedResponses,
        approved: approvedAiResponses,
        approvalRate: aiGeneratedResponses > 0
          ? Math.round((approvedAiResponses / aiGeneratedResponses) * 100)
          : 0
      }
    };
  });
}
