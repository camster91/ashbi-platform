// Bot API routes - external bot integration with ultra-fast caching

import { onboardClient } from '../services/onboarding.service.js';
import { generateWeeklyReport } from '../services/weeklyReport.service.js';
import { weeklyDigestQueue } from '../jobs/queue.js';
import { sendWebhookNotification } from '../utils/webhook.js';

// Ultra-fast in-memory cache for AI requests
const aiCache = {
  store: new Map(),
  ttl: 60 * 1000, // 60 seconds
  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.store.delete(key);
      return null;
    }
    return item.data;
  },
  set(key, data) {
    this.store.set(key, { data, expiry: Date.now() + this.ttl });
  },
  invalidate(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
};

export default async function botRoutes(fastify) {
  const BOT_SECRET = process.env.BOT_SECRET;

  // Middleware to validate bot bearer token
  function requireBotAuth(request, reply, done) {
    const auth = request.headers.authorization;
    if (!auth || auth !== `Bearer ${BOT_SECRET}`) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }
    done();
  }

  // POST /auth — validate bot secret, return JWT
  fastify.post('/auth', async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth || auth !== `Bearer ${BOT_SECRET}`) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const token = fastify.jwt.sign(
      { id: 'bot', role: 'BOT', email: 'bot@system' },
      { expiresIn: '30d' }
    );

    return { token };
  });

  // GET /sync — ULTRA-DENSE snapshot for AI context windows
  fastify.get('/sync', { preHandler: requireBotAuth }, async (request) => {
    const cacheKey = 'sync_dense';
    const cached = aiCache.get(cacheKey);
    if (cached) return cached;

    const [projects, tasks, clients] = await Promise.all([
      fastify.prisma.project.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, health: true, hourlyBudget: true, client: { select: { name: true } } }
      }),
      fastify.prisma.task.findMany({
        where: { status: { not: 'COMPLETED' } },
        select: { id: true, title: true, priority: true, status: true, project: { select: { name: true } } }
      }),
      fastify.prisma.client.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, tier: true }
      })
    ]);

    const result = {
      timestamp: new Date().toISOString(),
      activeProjects: projects.map(p => ({ id: p.id, name: p.name, client: p.client?.name, health: p.health, budget: p.hourlyBudget })),
      pendingTasks: tasks.map(t => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, project: t.project?.name })),
      activeClients: clients.map(c => ({ id: c.id, name: c.name, tier: c.tier }))
    };

    aiCache.set(cacheKey, result);
    return result;
  });

  // GET /dashboard — overview stats
  fastify.get('/dashboard', { preHandler: requireBotAuth }, async (request) => {
    const cacheKey = 'dashboard';
    const cached = aiCache.get(cacheKey);
    if (cached) return cached;

    const { prisma } = fastify;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [openThreads, tasksDueToday, atRiskProjects, recentActivities] = await Promise.all([
      prisma.thread.count({ where: { status: 'OPEN' } }),
      prisma.task.count({
        where: {
          status: { not: 'COMPLETED' },
          dueDate: { gte: today, lt: tomorrow }
        }
      }),
      prisma.project.count({ where: { health: 'AT_RISK' } }),
      prisma.activity.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { user: { select: { name: true } } }
      })
    ]);

    const result = { openThreads, tasksDueToday, atRiskProjects, recentActivities };
    aiCache.set(cacheKey, result);
    return result;
  });

  // GET /projects — all projects with client info
  fastify.get('/projects', { preHandler: requireBotAuth }, async (request) => {
    const cacheKey = 'projects_list';
    const cached = aiCache.get(cacheKey);
    if (cached) return cached;

    const projects = await fastify.prisma.project.findMany({
      include: {
        client: { select: { name: true } },
        _count: { select: { tasks: true } }
      }
    });

    const result = projects.map(p => ({
      id: p.id,
      name: p.name,
      clientName: p.client?.name || 'Unknown',
      status: p.status,
      health: p.health,
      taskCount: p._count.tasks
    }));

    aiCache.set(cacheKey, result);
    return result;
  });

  // GET /project/:id — full project detail
  fastify.get('/project/:id', { preHandler: requireBotAuth }, async (request, reply) => {
    const cacheKey = `project_${request.params.id}`;
    const cached = aiCache.get(cacheKey);
    if (cached) return cached;

    const project = await fastify.prisma.project.findUnique({
      where: { id: request.params.id },
      include: {
        client: true,
        tasks: true,
        threads: { take: 10, orderBy: { lastActivityAt: 'desc' } }
      }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });
    aiCache.set(cacheKey, project);
    return project;
  });

  // PATCH /project/:id — update project fields (e.g. hourlyBudget)
  fastify.patch('/project/:id', { preHandler: requireBotAuth }, async (request, reply) => {
    const { hourlyBudget, name, description, status, clientId } = request.body || {};
    const data = {};
    if (hourlyBudget !== undefined) data.hourlyBudget = Number(hourlyBudget);
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (status !== undefined) data.status = status;
    if (clientId !== undefined) data.clientId = clientId;

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update' });
    }

    const project = await fastify.prisma.project.update({
      where: { id: request.params.id },
      data,
      select: { id: true, name: true, hourlyBudget: true, status: true },
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    aiCache.invalidate('projects_list');
    aiCache.invalidate(`project_${request.params.id}`);
    aiCache.invalidate('sync_dense');

    return project;
  });

  // POST /project — create a project
  fastify.post('/project', { preHandler: requireBotAuth }, async (request, reply) => {
    const { name, description, clientId, status } = request.body;

    if (!name || !clientId) {
      return reply.status(400).send({ error: 'name and clientId are required' });
    }

    const project = await fastify.prisma.project.create({
      data: {
        name,
        description: description || null,
        clientId,
        status: status || 'ACTIVE'
      }
    });

    aiCache.invalidate('projects_list');
    aiCache.invalidate('sync_dense');

    return project;
  });

  // POST /project/:id/note — add a Note to a project
  fastify.post('/project/:id/note', { preHandler: requireBotAuth }, async (request, reply) => {
    const project = await fastify.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const { content, title } = request.body;
    if (!content || !title) {
      return reply.status(400).send({ error: 'content and title are required' });
    }

    const admin = await fastify.prisma.user.findFirst({ where: { role: 'ADMIN' } });

    const note = await fastify.prisma.note.create({
      data: {
        title,
        content,
        projectId: request.params.id,
        authorId: admin.id
      }
    });

    return note;
  });

  // POST /thread — create outbound thread for drafting client communications
  fastify.post('/thread', { preHandler: requireBotAuth }, async (request, reply) => {
    const { subject, clientId, projectId, priority } = request.body;

    if (!subject || !clientId) {
      return reply.status(400).send({ error: 'subject and clientId are required' });
    }

    const client = await fastify.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return reply.status(404).send({ error: 'Client not found' });
    }

    const admin = await fastify.prisma.user.findFirst({ where: { role: 'ADMIN' } });

    const thread = await fastify.prisma.thread.create({
      data: {
        subject,
        status: 'DRAFT',
        priority: priority || 'NORMAL',
        clientId,
        projectId: projectId || null,
        assignedToId: admin.id,
        lastActivityAt: new Date()
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    return reply.status(201).send(thread);
  });

  // POST /task — create a task
  fastify.post('/task', { preHandler: requireBotAuth }, async (request) => {
    const { projectId, title, description, priority, tags, category, properties, assigneeId, dueDate } = request.body;

    const task = await fastify.prisma.task.create({
      data: {
        title,
        description: description || null,
        priority: priority || 'NORMAL',
        projectId,
        tags: tags ? JSON.stringify(tags) : '[]',
        category: category || 'UPCOMING',
        properties: properties ? JSON.stringify(properties) : '{}',
        assigneeId: assigneeId || null,
        dueDate: dueDate ? new Date(dueDate) : null
      }
    });

    aiCache.invalidate('dashboard');
    aiCache.invalidate('sync_dense');
    aiCache.invalidate(`project_${projectId}`);

    return task;
  });

  // PATCH /task/:id — update a task
  fastify.patch('/task/:id', { preHandler: requireBotAuth }, async (request, reply) => {
    const existing = await fastify.prisma.task.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ error: 'Task not found' });

    const task = await fastify.prisma.task.update({
      where: { id: request.params.id },
      data: request.body
    });

    aiCache.invalidate('dashboard');
    aiCache.invalidate('sync_dense');
    aiCache.invalidate(`project_${existing.projectId}`);

    return task;
  });

  // POST /thread/:id/note — add internal note
  fastify.post('/thread/:id/note', { preHandler: requireBotAuth }, async (request, reply) => {
    const thread = await fastify.prisma.thread.findUnique({ where: { id: request.params.id } });
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });

    // Use the first admin user as the note author for bot-created notes
    const admin = await fastify.prisma.user.findFirst({ where: { role: 'ADMIN' } });

    const note = await fastify.prisma.internalNote.create({
      data: {
        content: request.body.content,
        threadId: request.params.id,
        authorId: admin.id
      }
    });

    return note;
  });

  // GET /team — all users with active task counts
  fastify.get('/team', { preHandler: requireBotAuth }, async () => {
    const cacheKey = 'team_stats';
    const cached = aiCache.get(cacheKey);
    if (cached) return cached;

    const users = await fastify.prisma.user.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: {
            assignedTasks: { where: { status: { not: 'COMPLETED' } } }
          }
        }
      }
    });

    const result = users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      activeTaskCount: u._count.assignedTasks
    }));

    aiCache.set(cacheKey, result);
    return result;
  });

  // GET /clients — all clients
  fastify.get('/clients', { preHandler: requireBotAuth }, async () => {
    const cacheKey = 'clients_list';
    const cached = aiCache.get(cacheKey);
    if (cached) return cached;

    const clients = await fastify.prisma.client.findMany();
    aiCache.set(cacheKey, clients);
    return clients;
  });

  // POST /client — create client
  fastify.post('/client', { preHandler: requireBotAuth }, async (request) => {
    const { name, domain, status } = request.body;

    const client = await fastify.prisma.client.create({
      data: {
        name,
        domain: domain || null,
        status: status || 'ACTIVE'
      }
    });

    aiCache.invalidate('clients_list');
    aiCache.invalidate('sync_dense');

    return client;
  });

  // ==================== TIME TRACKING ====================

  // GET /projects/hours/summary — all active projects hours summary
  // IMPORTANT: registered before /projects/:id/hours to avoid route conflict
  fastify.get('/projects/hours/summary', { preHandler: requireBotAuth }, async () => {
    const cacheKey = 'hours_summary';
    const cached = aiCache.get(cacheKey);
    if (cached) return cached;

    const projects = await fastify.prisma.project.findMany({
      where: { status: 'ACTIVE' },
      include: {
        client: { select: { name: true } },
        timeEntries: { include: { user: { select: { id: true, name: true, hourlyRate: true } } } }
      }
    });

    const projectSummaries = projects.map(p => {
      const loggedHours = p.timeEntries.reduce((sum, te) => sum + te.duration / 60, 0);
      const costToDate = p.timeEntries.reduce((sum, te) => {
        const rate = te.hourlyRate || te.user.hourlyRate || 0;
        return sum + (te.duration / 60) * rate;
      }, 0);
      const estimatedHours = p.hourlyBudget || 0;
      const percentUsed = estimatedHours > 0 ? Math.round((loggedHours / estimatedHours) * 100) : 0;
      const overBudget = estimatedHours > 0 && loggedHours > estimatedHours;

      return {
        id: p.id,
        name: p.name,
        clientName: p.client?.name,
        estimatedHours,
        loggedHours: Math.round(loggedHours * 100) / 100,
        costToDate: Math.round(costToDate * 100) / 100,
        percentUsed,
        overBudget
      };
    });

    const overBudgetProjects = projectSummaries.filter(p => p.overBudget);

    const result = {
      projects: projectSummaries,
      overBudgetCount: overBudgetProjects.length,
      overBudgetProjects: overBudgetProjects.map(p => p.name)
    };

    aiCache.set(cacheKey, result);
    return result;
  });

  // GET /projects/:id/hours — detailed hours breakdown for a project
  fastify.get('/projects/:id/hours', { preHandler: requireBotAuth }, async (request, reply) => {
    const project = await fastify.prisma.project.findUnique({
      where: { id: request.params.id },
      include: {
        client: { select: { name: true } },
        timeEntries: { include: { user: { select: { id: true, name: true, hourlyRate: true } } } }
      }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const estimatedHours = project.hourlyBudget || 0;
    const loggedHours = project.timeEntries.reduce((sum, te) => sum + te.duration / 60, 0);
    const costToDate = project.timeEntries.reduce((sum, te) => {
      const rate = te.hourlyRate || te.user.hourlyRate || 0;
      return sum + (te.duration / 60) * rate;
    }, 0);
    const budgetRemaining = estimatedHours > 0 ? estimatedHours - loggedHours : null;
    const percentUsed = estimatedHours > 0 ? Math.round((loggedHours / estimatedHours) * 100) : 0;
    const overBudget = estimatedHours > 0 && loggedHours > estimatedHours;

    // Group by user
    const userMap = {};
    for (const te of project.timeEntries) {
      if (!userMap[te.user.id]) {
        userMap[te.user.id] = { userId: te.user.id, userName: te.user.name, hours: 0, cost: 0 };
      }
      const hours = te.duration / 60;
      const rate = te.hourlyRate || te.user.hourlyRate || 0;
      userMap[te.user.id].hours += hours;
      userMap[te.user.id].cost += hours * rate;
    }

    const breakdown = Object.values(userMap).map(u => ({
      ...u,
      hours: Math.round(u.hours * 100) / 100,
      cost: Math.round(u.cost * 100) / 100
    }));

    return {
      id: project.id,
      name: project.name,
      clientName: project.client?.name,
      estimatedHours,
      loggedHours: Math.round(loggedHours * 100) / 100,
      costToDate: Math.round(costToDate * 100) / 100,
      budgetRemaining: budgetRemaining !== null ? Math.round(budgetRemaining * 100) / 100 : null,
      percentUsed,
      overBudget,
      breakdown
    };
  });

  // ==================== APPROVALS ====================

  // POST /approvals — create approval (agents use this)
  fastify.post('/approvals', { preHandler: requireBotAuth }, async (request, reply) => {
    const { type, title, clientName, projectId, content, metadata, createdBy, expiresAt } = request.body || {};
    if (!type || !title || !content || !createdBy) {
      return reply.status(400).send({ error: 'type, title, content, and createdBy are required' });
    }
    const approval = await fastify.prisma.approval.create({
      data: {
        type: type.toUpperCase(),
        title,
        clientName: clientName || null,
        projectId: projectId || null,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        metadata: metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null,
        createdBy,
        status: 'PENDING',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      }
    });

    // Create notification for admin user
    try {
      const admin = await fastify.prisma.user.findFirst({ where: { role: 'ADMIN' } });
      if (admin) {
        const notification = await fastify.prisma.notification.create({
          data: {
            type: 'APPROVAL_NEEDED',
            title: approval.title,
            message: `${createdBy} needs approval: ${title}`,
            userId: admin.id,
          }
        });
        // Emit WebSocket event to admin
        if (fastify.io) {
          fastify.io.to(`user:${admin.id}`).emit('notification:new', notification);
        }
        // Fire webhook (non-blocking)
        sendWebhookNotification(notification).catch(() => {});
        // Fire HITL email for approval (non-blocking)
        import('../utils/hitl-email.service.js').then(({ sendApprovalHITLEmail }) => {
          fastify.prisma.notification.create({
            data: {
              type: 'HITL_REQUIRED',
              title: approval.title,
              message: `Approval needed: ${approval.title}`,
              userId: admin.id,
              data: JSON.stringify({ type: 'APPROVAL', refId: approval.id }),
            }
          }).then(hitlNotif => sendApprovalHITLEmail({ notificationId: hitlNotif.id, approval }))
        }).catch(err => fastify.log.error('Approval HITL email error:', err.message));
      }
    } catch (notifErr) {
      fastify.log.error('Failed to create approval notification:', notifErr.message);
    }

    return {
      id: approval.id,
      url: `https://hub.ashbi.ca/approvals/${approval.id}`,
    };
  });

  // GET /approvals — list approvals (optional ?status=PENDING filter)
  fastify.get('/approvals', { preHandler: requireBotAuth }, async (request) => {
    const { status, type, limit = 50 } = request.query;
    const where = {};
    if (status) where.status = status.toUpperCase();
    if (type) where.type = type.toUpperCase();
    const approvals = await fastify.prisma.approval.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });
    return { approvals };
  });

  // GET /approvals/:id — single approval
  fastify.get('/approvals/:id', { preHandler: requireBotAuth }, async (request, reply) => {
    const approval = await fastify.prisma.approval.findUnique({
      where: { id: request.params.id },
    });
    if (!approval) return reply.status(404).send({ error: 'Not found' });
    return approval;
  });

  // PATCH /approvals/:id — approve or reject (bot can update status)
  fastify.patch('/approvals/:id', { preHandler: requireBotAuth }, async (request, reply) => {
    const { status, reviewNote, reviewedBy } = request.body || {};
    if (!status || !['APPROVED', 'REJECTED', 'EXPIRED'].includes(status.toUpperCase())) {
      return reply.status(400).send({ error: 'status must be APPROVED, REJECTED, or EXPIRED' });
    }
    const approval = await fastify.prisma.approval.update({
      where: { id: request.params.id },
      data: {
        status: status.toUpperCase(),
        reviewNote: reviewNote || null,
        reviewedBy: reviewedBy || 'cameron',
        reviewedAt: new Date(),
      }
    });
    return approval;
  });

  // ==================== ONBOARDING ====================

  // POST /onboard — full client onboarding
  fastify.post('/onboard', { preHandler: requireBotAuth }, async (request, reply) => {
    const { name, email, contactName, retainerTier, notes } = request.body;

    if (!name || !email || !contactName || !retainerTier) {
      return reply.status(400).send({ error: 'name, email, contactName, and retainerTier are required' });
    }

    if (!['999', '1999', '3999'].includes(String(retainerTier))) {
      return reply.status(400).send({ error: 'retainerTier must be 999, 1999, or 3999' });
    }

    return onboardClient(fastify, { name, email, contactName, retainerTier: String(retainerTier), notes });
  });

  // ==================== RETAINER ====================

  // GET /retainer/:clientId — retainer status
  fastify.get('/retainer/:clientId', { preHandler: requireBotAuth }, async (request, reply) => {
    const plan = await fastify.prisma.retainerPlan.findUnique({
      where: { clientId: request.params.clientId },
      include: { client: { select: { name: true } } }
    });

    if (!plan) {
      return reply.status(404).send({ error: 'No retainer plan found' });
    }

    const revisionRounds = await fastify.prisma.revisionRound.count({
      where: { project: { clientId: request.params.clientId } }
    });

    const percentUsed = Math.round((plan.hoursUsed / plan.hoursPerMonth) * 100);

    return {
      clientName: plan.client?.name,
      tier: plan.tier,
      hoursTotal: plan.hoursPerMonth,
      hoursUsed: plan.hoursUsed,
      hoursRemaining: plan.hoursPerMonth - plan.hoursUsed,
      percentUsed,
      revisionRounds,
      scopeCreepRisk: percentUsed > 80
    };
  });

  // GET /retainer-alerts — clients at risk (>80% hours used)
  fastify.get('/retainer-alerts', { preHandler: requireBotAuth }, async () => {
    const plans = await fastify.prisma.retainerPlan.findMany({
      include: { client: { select: { name: true } } }
    });

    const atRisk = plans
      .map(plan => ({
        clientId: plan.clientId,
        clientName: plan.client?.name,
        tier: plan.tier,
        hoursTotal: plan.hoursPerMonth,
        hoursUsed: plan.hoursUsed,
        hoursRemaining: plan.hoursPerMonth - plan.hoursUsed,
        percentUsed: Math.round((plan.hoursUsed / plan.hoursPerMonth) * 100)
      }))
      .filter(p => p.percentUsed > 80);

    return { atRiskCount: atRisk.length, atRisk };
  });

  // ==================== REPORTS ====================

  // POST /reports/generate/:clientId — generate weekly report
  fastify.post('/reports/generate/:clientId', { preHandler: requireBotAuth }, async (request, reply) => {
    try {
      const report = await generateWeeklyReport(request.params.clientId);

      const saved = await fastify.prisma.report.create({
        data: {
          type: 'WEEKLY',
          subject: report.subject,
          body: report.body,
          clientId: report.clientId
        }
      });

      return { ...report, reportId: saved.id };
    } catch (err) {
      if (err.message === 'Client not found') {
        return reply.status(404).send({ error: 'Client not found' });
      }
      throw err;
    }
  });

  // GET /reports/pending — reports generated but not yet sent
  fastify.get('/reports/pending', { preHandler: requireBotAuth }, async () => {
    const reports = await fastify.prisma.report.findMany({
      where: { sentAt: null },
      orderBy: { generatedAt: 'desc' },
      include: { client: { select: { name: true } } }
    });
    return reports;
  });

  // ==================== LEADS ====================

  // GET /leads — list pending leads with basic info
  fastify.get('/leads', { preHandler: requireBotAuth }, async () => {
    const leads = await fastify.prisma.unmatchedEmail.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' }
    });

    return leads.map(lead => {
      let meta = {};
      try { meta = JSON.parse(lead.suggestedClients || '{}'); } catch { /* ignore */ }
      return {
        id: lead.id,
        name: lead.senderName,
        email: lead.senderEmail,
        company: meta.company || null,
        source: meta.source || 'unknown',
        subject: lead.subject,
        message: lead.bodyText,
        receivedAt: lead.createdAt
      };
    });
  });

  // POST /weekly-digest — trigger weekly digest generation
  fastify.post('/weekly-digest', { preHandler: requireBotAuth }, async (request, reply) => {
    const job = await weeklyDigestQueue.add('generate-weekly-digest', {
      triggeredManually: true,
      triggeredAt: new Date().toISOString()
    });

    return { success: true, jobId: job.id, message: 'Weekly digest generation queued' };
  });

  // POST /system/restart-gateway — safely restart OpenClaw gateway via watchdog
  fastify.post('/system/restart-gateway', { preHandler: requireBotAuth }, async (request, reply) => {
    const { exec } = await import('child_process');
    const watchdogScript = 'C:/Users/camst/.openclaw/workspace/watchdog/openclaw-watchdog.js';
    
    exec(`node "${watchdogScript}" restart`, (err) => {
      if (err) fastify.log.error('Watchdog restart error:', err.message);
    });

    return { status: 'restart initiated', timestamp: new Date().toISOString() };
  });

  // GET /system/gateway-status — check gateway health via watchdog
  fastify.get('/system/gateway-status', { preHandler: requireBotAuth }, async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      timestamp: new Date().toISOString(),
    };
  });

  // ==================== ACTIVITY FEED ====================

  // POST /activity — log agent activity
  fastify.post('/activity', { preHandler: requireBotAuth }, async (request, reply) => {
    const { agentRole, type, action, title, entityType, entityId, entityName, projectId, metadata } = request.body || {};

    if (!type || !action || !title || !entityType) {
      return reply.status(400).send({ error: 'type, action, title, and entityType are required' });
    }

    // Find admin user (same pattern as other bot routes)
    const admin = await fastify.prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) {
      return reply.status(500).send({ error: 'No admin user found' });
    }

    // Build metadata with agentRole included
    const activityMeta = {
      ...(metadata || {}),
      agentRole: agentRole || 'system',
    };

    const activity = await fastify.prisma.activity.create({
      data: {
        type: type.toUpperCase(),
        action: action.toLowerCase(),
        entityType: entityType.toUpperCase(),
        entityId: entityId || '',
        entityName: entityName || title,
        metadata: JSON.stringify(activityMeta),
        projectId: projectId || null,
        userId: admin.id,
      },
      include: {
        user: { select: { name: true } },
        project: { select: { name: true } },
      },
    });

    // Emit WebSocket event
    if (fastify.io) {
      fastify.io.emit('activity:new', activity);
    }

    return { id: activity.id, createdAt: activity.createdAt };
  });

  // GET /activities — list recent activities (for frontend)
  fastify.get('/activities', { preHandler: requireBotAuth }, async (request) => {
    const { limit = 50 } = request.query;

    const activities = await fastify.prisma.activity.findMany({
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      include: {
        user: { select: { name: true } },
        project: { select: { name: true } },
      },
    });

    return { activities };
  });

  // ==================== NOTIFICATIONS ====================

  // GET /notifications — list recent notifications (bot API)
  fastify.get('/notifications', { preHandler: requireBotAuth }, async (request) => {
    const { unread, limit = 20 } = request.query;

    const admin = await fastify.prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) return { notifications: [] };

    const where = { userId: admin.id };
    if (unread === 'true') where.read = false;

    const notifications = await fastify.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });

    return {
      notifications: notifications.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        read: n.read,
        createdAt: n.createdAt,
        data: n.data ? JSON.parse(n.data) : null,
      })),
    };
  });

  // ==================== EMAIL COMMUNICATIONS ====================

  // POST /communications — log an email to a project
  fastify.post('/communications', { preHandler: requireBotAuth }, async (request, reply) => {
    const { projectId, gmailThreadId, gmailMessageId, from, to, subject, bodySnippet, fullBody, direction, sentiment, summary, actionItems, account, receivedAt } = request.body || {};

    if (!projectId || !gmailThreadId || !gmailMessageId || !from || !to || !subject || !fullBody || !direction || !account || !receivedAt) {
      return reply.status(400).send({ error: 'projectId, gmailThreadId, gmailMessageId, from, to, subject, fullBody, direction, account, and receivedAt are required' });
    }

    const project = await fastify.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const communication = await fastify.prisma.projectCommunication.upsert({
      where: { gmailMessageId },
      create: {
        projectId,
        gmailThreadId,
        gmailMessageId,
        from,
        to,
        subject,
        bodySnippet: bodySnippet || fullBody.substring(0, 500),
        fullBody,
        direction: direction.toUpperCase(),
        sentiment: sentiment || null,
        summary: summary || null,
        actionItems: actionItems ? (typeof actionItems === 'string' ? actionItems : JSON.stringify(actionItems)) : null,
        account,
        receivedAt: new Date(receivedAt),
      },
      update: {
        from,
        to,
        subject,
        bodySnippet: bodySnippet || fullBody.substring(0, 500),
        fullBody,
        direction: direction.toUpperCase(),
        sentiment: sentiment || null,
        summary: summary || null,
        actionItems: actionItems ? (typeof actionItems === 'string' ? actionItems : JSON.stringify(actionItems)) : null,
        account,
        receivedAt: new Date(receivedAt),
      },
    });

    // Auto-increment emailCount on ProjectContext
    await fastify.prisma.projectContext.upsert({
      where: { projectId },
      create: { projectId, aiSummary: '', emailCount: 1 },
      update: { emailCount: { increment: 1 } },
    });

    return communication;
  });

  // GET /communications/:projectId — get email history for a project
  fastify.get('/communications/:projectId', { preHandler: requireBotAuth }, async (request, reply) => {
    const { projectId } = request.params;
    const { limit = '20', offset = '0', since, full } = request.query;

    const project = await fastify.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const where = { projectId };
    if (since) {
      where.receivedAt = { gte: new Date(since) };
    }

    const includeFullBody = full === 'true';

    const communications = await fastify.prisma.projectCommunication.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
      select: {
        id: true,
        gmailThreadId: true,
        gmailMessageId: true,
        from: true,
        to: true,
        subject: true,
        bodySnippet: true,
        fullBody: includeFullBody,
        direction: true,
        sentiment: true,
        summary: true,
        actionItems: true,
        account: true,
        receivedAt: true,
        createdAt: true,
      },
    });

    return { communications, count: communications.length };
  });

  // ==================== PROJECT CONTEXT ====================

  // POST /context/:projectId — update project context
  fastify.post('/context/:projectId', { preHandler: requireBotAuth }, async (request, reply) => {
    const { projectId } = request.params;
    const { aiSummary, humanNotes, compactionVersion } = request.body || {};

    const project = await fastify.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const updateData = {};
    if (aiSummary !== undefined) {
      updateData.aiSummary = aiSummary;
      updateData.lastCompactedAt = new Date();
    }
    if (humanNotes !== undefined) updateData.humanNotes = humanNotes;
    if (compactionVersion !== undefined) updateData.compactionVersion = compactionVersion;

    const context = await fastify.prisma.projectContext.upsert({
      where: { projectId },
      create: {
        projectId,
        aiSummary: aiSummary || '',
        humanNotes: humanNotes || null,
        compactionVersion: compactionVersion || 0,
        lastCompactedAt: aiSummary ? new Date() : null,
      },
      update: updateData,
    });

    return context;
  });

  // GET /context/:projectId — get project context
  fastify.get('/context/:projectId', { preHandler: requireBotAuth }, async (request, reply) => {
    const { projectId } = request.params;

    const project = await fastify.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const context = await fastify.prisma.projectContext.findUnique({
      where: { projectId },
    });

    const recentComms = await fastify.prisma.projectCommunication.findMany({
      where: { projectId },
      orderBy: { receivedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        from: true,
        to: true,
        subject: true,
        summary: true,
        direction: true,
        sentiment: true,
        receivedAt: true,
      },
    });

    return {
      aiSummary: context?.aiSummary || null,
      humanNotes: context?.humanNotes || null,
      lastCompactedAt: context?.lastCompactedAt || null,
      compactionVersion: context?.compactionVersion || 0,
      emailCount: context?.emailCount || 0,
      recentCommunications: recentComms,
    };
  });

  // ==================== CLIENT EMAIL MAPPINGS ====================

  // GET /client-email-map — get all client email mappings
  fastify.get('/client-email-map', { preHandler: requireBotAuth }, async () => {
    const mappings = await fastify.prisma.clientEmailMapping.findMany({
      include: { client: { select: { name: true } } },
    });

    return mappings.map(m => ({
      clientId: m.clientId,
      clientName: m.client?.name,
      emailAddress: m.emailAddress,
      emailDomain: m.emailDomain,
      contactName: m.contactName,
      isPrimary: m.isPrimary,
    }));
  });

  // POST /client-email-map — add/update email mapping
  fastify.post('/client-email-map', { preHandler: requireBotAuth }, async (request, reply) => {
    const { clientId, emailAddress, emailDomain, contactName, isPrimary } = request.body || {};

    if (!clientId || !emailAddress) {
      return reply.status(400).send({ error: 'clientId and emailAddress are required' });
    }

    const client = await fastify.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return reply.status(404).send({ error: 'Client not found' });

    const mapping = await fastify.prisma.clientEmailMapping.upsert({
      where: {
        emailAddress_clientId: { emailAddress, clientId },
      },
      create: {
        clientId,
        emailAddress,
        emailDomain: emailDomain || null,
        contactName: contactName || null,
        isPrimary: isPrimary || false,
      },
      update: {
        emailDomain: emailDomain || null,
        contactName: contactName || null,
        isPrimary: isPrimary || false,
      },
    });

    return mapping;
  });

  // ==================== GMAIL DRAFT ====================

  // POST /gmail-draft — create a Gmail draft via stored OAuth tokens
  fastify.post('/gmail-draft', { preHandler: requireBotAuth }, async (request, reply) => {
    const { account, to, subject, body, inReplyTo, threadId } = request.body || {};

    if (!account || !to || !subject || !body) {
      return reply.status(400).send({ error: 'account, to, subject, and body are required' });
    }

    const tokenPaths = {
      cameron: 'C:/Users/camst/.openclaw/workspace/memory/google-tokens.json',
      bianca: 'C:/Users/camst/.openclaw/workspace/memory/google-tokens-bianca.json',
    };

    const tokenPath = tokenPaths[account.toLowerCase()];
    if (!tokenPath) {
      return reply.status(400).send({ error: 'account must be "cameron" or "bianca"' });
    }

    let tokens;
    try {
      const { readFile } = await import('fs/promises');
      const raw = await readFile(tokenPath, 'utf-8');
      tokens = JSON.parse(raw);
    } catch (err) {
      return reply.status(500).send({ error: `Failed to load OAuth tokens for ${account}: ${err.message}` });
    }

    try {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(
        tokens.client_id,
        tokens.client_secret,
        tokens.redirect_uri || 'http://localhost'
      );
      oauth2Client.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type || 'Bearer',
        expiry_date: tokens.expiry_date,
      });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Build raw email
      const headers = [
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
      ];
      if (inReplyTo) {
        headers.push(`In-Reply-To: ${inReplyTo}`);
        headers.push(`References: ${inReplyTo}`);
      }

      const rawMessage = headers.join('\r\n') + '\r\n\r\n' + body;
      const encodedMessage = Buffer.from(rawMessage).toString('base64url');

      const draftData = { message: { raw: encodedMessage } };
      if (threadId) draftData.message.threadId = threadId;

      const draft = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: draftData,
      });

      return { draftId: draft.data.id, messageId: draft.data.message?.id };
    } catch (err) {
      return reply.status(500).send({ error: `Failed to create Gmail draft: ${err.message}` });
    }
  });

  // ==================== TASK BULK IMPORT ====================

  // POST /tasks/bulk — bulk create tasks from agent backlog
  fastify.post('/tasks/bulk', { preHandler: requireBotAuth }, async (request, reply) => {
    const { tasks } = request.body || {};
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return reply.status(400).send({ error: 'tasks array is required' });
    }

    const { prisma } = fastify;

    // Get Cameron's user ID
    const cameron = await prisma.user.findFirst({ where: { email: 'cameron@ashbi.ca' } });
    if (!cameron) return reply.status(500).send({ error: 'Cameron user not found' });

    // Get or create Internal Ops project
    let internalOpsProject = await prisma.project.findFirst({ where: { name: 'Internal Ops' } });
    if (!internalOpsProject) {
      // Find or create an internal client
      let ashbiClient = await prisma.client.findFirst({ where: { name: 'Ashbi Design' } });
      if (!ashbiClient) {
        ashbiClient = await prisma.client.create({ data: { name: 'Ashbi Design', status: 'ACTIVE' } });
      }
      internalOpsProject = await prisma.project.create({
        data: {
          name: 'Internal Ops',
          description: 'Internal operations, automation, and agent tasks',
          clientId: ashbiClient.id,
          status: 'ACTIVE',
        }
      });
    }

    const { sendTaskHITLEmail } = await import('../utils/hitl-email.service.js');
    const created = [];

    for (const taskDef of tasks) {
      try {
        const projectId = taskDef.projectId || internalOpsProject.id;

        // Build tags array — add agent tag if present
        const tags = Array.isArray(taskDef.tags) ? [...taskDef.tags] : [];
        if (taskDef.assigneeAgent && !tags.includes(`agent:${taskDef.assigneeAgent}`)) {
          tags.push(`agent:${taskDef.assigneeAgent}`);
        }

        // If requiresHITL, force category to WAITING_US
        const category = taskDef.requiresHITL ? 'WAITING_US' : (taskDef.category || 'UPCOMING');

        const task = await prisma.task.create({
          data: {
            title: taskDef.title,
            description: taskDef.description || null,
            priority: taskDef.priority || 'NORMAL',
            projectId,
            tags: JSON.stringify(tags),
            category,
            status: 'PENDING',
            dueDate: taskDef.dueDate ? new Date(taskDef.dueDate) : null,
          }
        });

        // Create notification for Cameron
        const notification = await prisma.notification.create({
          data: {
            type: 'TASK_CREATED',
            title: task.title,
            message: `Task created: ${task.title}`,
            userId: cameron.id,
            data: JSON.stringify({ type: 'TASK', refId: task.id, requiresHITL: taskDef.requiresHITL }),
          }
        });

        // Fire HITL email if required
        if (taskDef.requiresHITL) {
          const project = await prisma.project.findUnique({ where: { id: projectId } });
          const hitlNotif = await prisma.notification.create({
            data: {
              type: 'HITL_REQUIRED',
              title: `HITL: ${task.title}`,
              message: `Human input required for task: ${task.title}`,
              userId: cameron.id,
              data: JSON.stringify({ type: 'TASK', refId: task.id, assigneeAgent: taskDef.assigneeAgent }),
            }
          });
          sendTaskHITLEmail({
            notificationId: hitlNotif.id,
            task,
            project,
            context: taskDef.description || `Agent ${taskDef.assigneeAgent || 'system'} needs your input on this task.`,
            urgency: taskDef.priority || 'NORMAL',
            replyInstructions: 'Reply with your instructions or approval.',
            assigneeAgent: taskDef.assigneeAgent || 'agent',
          }).catch(err => fastify.log.error('HITL email error:', err.message));
        }

        created.push({ id: task.id, title: task.title, projectId: task.projectId });
      } catch (err) {
        fastify.log.error('Failed to create task:', taskDef.title, err.message);
      }
    }

    return reply.status(201).send({ created: created.length, tasks: created });
  });

  // ==================== HITL NOTIFY ====================

  // POST /hitl/notify — explicit HITL notification from any agent
  fastify.post('/hitl/notify', { preHandler: requireBotAuth }, async (request, reply) => {
    const { type, refId, subject, context, urgency = 'NORMAL', replyInstructions } = request.body || {};
    if (!type || !subject || !context) {
      return reply.status(400).send({ error: 'type, subject, and context are required' });
    }

    const { prisma } = fastify;
    const cameron = await prisma.user.findFirst({ where: { email: 'cameron@ashbi.ca' } });
    if (!cameron) return reply.status(500).send({ error: 'Cameron user not found' });

    // Create HITL notification
    const notification = await prisma.notification.create({
      data: {
        type: 'HITL_REQUIRED',
        title: subject,
        message: context.substring(0, 500),
        userId: cameron.id,
        data: JSON.stringify({ type, refId: refId || null, urgency }),
      }
    });

    const { sendTaskHITLEmail, sendApprovalHITLEmail, sendMailgunEmail } = await import('../utils/hitl-email.service.js');

    let emailResult = { ok: false };

    if (type === 'TASK' && refId) {
      const task = await prisma.task.findUnique({ where: { id: refId } });
      if (task) {
        const project = await prisma.project.findUnique({ where: { id: task.projectId } });
        emailResult = await sendTaskHITLEmail({
          notificationId: notification.id,
          task,
          project,
          context,
          urgency,
          replyInstructions,
        });
      }
    } else if (type === 'APPROVAL' && refId) {
      const approval = await prisma.approval.findUnique({ where: { id: refId } });
      if (approval) {
        emailResult = await sendApprovalHITLEmail({
          notificationId: notification.id,
          approval,
        });
      }
    } else {
      // CUSTOM or PROJECT — send generic email
      const replyTo = `reply+${notification.id}@${process.env.MAILGUN_DOMAIN || 'ashbi.ca'}`;
      const urgencyPrefix = urgency === 'CRITICAL' ? '🔴 [CRITICAL] ' : urgency === 'HIGH' ? '🟠 [ACTION NEEDED] ' : '';
      emailResult = await sendMailgunEmail({
        to: 'cameron@ashbi.ca',
        replyTo,
        subject: `${urgencyPrefix}${subject} — Ashbi Hub`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2>🔔 ${subject}</h2>
          <p><strong>Type:</strong> ${type}${refId ? ` | <strong>Ref:</strong> ${refId}` : ''}</p>
          <p><strong>Urgency:</strong> ${urgency}</p>
          <div style="background:#f5f5f5;padding:16px;border-radius:6px;margin:16px 0">
            <p>${context}</p>
          </div>
          ${replyInstructions ? `<p><strong>Instructions:</strong> ${replyInstructions}</p>` : ''}
          <hr>
          <p style="color:#888;font-size:12px">Reply to this email to respond into Hub. · <a href="https://hub.ashbi.ca">hub.ashbi.ca</a></p>
        </div>`,
      });
    }

    return {
      notificationId: notification.id,
      emailSent: emailResult.ok,
      emailError: emailResult.ok ? undefined : emailResult.error,
    };
  });
}
