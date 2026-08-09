import { onboardClient } from '../services/onboarding.service.js';
import {
  validateBody,
  onboardingClientSchema,
  onboardingTaskActionSchema,
} from '../validators/schemas.js';

const ROLE_TASKS = Object.freeze({
  ADMIN: [
    {
      id: 'add-client',
      title: 'Add your first client',
      description: 'Create or import the client account that your team will work with.',
      href: '/clients',
      permission: 'ADMIN',
    },
    {
      id: 'create-project',
      title: 'Create a client project',
      description: 'Give client work a shared home for tasks, documents, time, and communication.',
      href: '/projects',
      permission: 'ADMIN',
    },
    {
      id: 'create-proposal',
      title: 'Create a proposal',
      description: 'Build the first revenue workflow without sending anything automatically.',
      href: '/proposals',
      permission: 'ADMIN',
    },
  ],
  TEAM: [
    {
      id: 'complete-task',
      title: 'Complete an assigned task',
      description: 'Open your assigned work and complete one task.',
      href: '/tasks',
      permission: 'TEAM',
    },
    {
      id: 'log-time',
      title: 'Log time on project work',
      description: 'Record time against an authorized project or assigned task.',
      href: '/time',
      permission: 'TEAM',
    },
    {
      id: 'create-document',
      title: 'Contribute a project document',
      description: 'Create a note or wiki page so project knowledge is shared.',
      href: '/docs',
      permission: 'TEAM',
    },
  ],
});

function safeSkippedTaskIds(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

export function tasksForRole(role) {
  return ROLE_TASKS[role] || [];
}

async function completionFacts(request) {
  const userId = request.user.id;
  if (request.user.role === 'ADMIN') {
    const [clientCount, projectCount, proposalCount] = await Promise.all([
      request.prisma.client.count({ where: { deletedAt: null } }),
      request.prisma.project.count({ where: { deletedAt: null } }),
      request.prisma.proposal.count({ where: { createdById: userId, deletedAt: null } }),
    ]);
    return {
      'add-client': clientCount > 0,
      'create-project': projectCount > 0,
      'create-proposal': proposalCount > 0,
    };
  }
  if (request.user.role === 'TEAM') {
    const [completedTaskCount, timeEntryCount, noteCount] = await Promise.all([
      request.prisma.task.count({ where: { assigneeId: userId, status: 'COMPLETED', deletedAt: null } }),
      request.prisma.timeEntry.count({ where: { userId, deletedAt: null } }),
      request.prisma.note.count({ where: { authorId: userId, deletedAt: null } }),
    ]);
    return {
      'complete-task': completedTaskCount > 0,
      'log-time': timeEntryCount > 0,
      'create-document': noteCount > 0,
    };
  }
  return {};
}

async function getOrCreateProgress(request) {
  const existing = await request.prisma.onboardingProgress.findFirst({
    where: { userId: request.user.id },
  });
  if (existing?.roleSnapshot === request.user.role) return existing;
  if (existing) {
    return request.prisma.onboardingProgress.update({
      where: { userId: request.user.id },
      data: {
        roleSnapshot: request.user.role,
        skippedTaskIds: [],
        startedAt: null,
        dismissedAt: null,
        completedAt: null,
      },
    });
  }
  try {
    return await request.prisma.onboardingProgress.create({
      data: {
        userId: request.user.id,
        roleSnapshot: request.user.role,
        skippedTaskIds: [],
      },
    });
  } catch (error) {
    // Two tabs can initialize the same account simultaneously. The unique
    // user key makes one winner authoritative; the other request resumes it.
    if (error?.code !== 'P2002') throw error;
    return request.prisma.onboardingProgress.findFirst({ where: { userId: request.user.id } });
  }
}

async function presentProgress(request, progress, { persistCompletion = true } = {}) {
  if (!ROLE_TASKS[request.user.role]) {
    return {
      supported: false,
      role: request.user.role,
      state: 'deferred',
      reason: request.user.role === 'CLIENT'
        ? 'Client onboarding is deferred to the authenticated client-portal acceptance gate in issue #286.'
        : 'Onboarding is unavailable for this account role.',
      tasks: [],
    };
  }

  const facts = await completionFacts(request);
  const skippedTaskIds = safeSkippedTaskIds(progress.skippedTaskIds);
  const tasks = tasksForRole(request.user.role).map(task => ({
    ...task,
    completed: Boolean(facts[task.id]),
    skipped: skippedTaskIds.includes(task.id),
  }));
  const allResolved = tasks.every(task => task.completed || task.skipped);
  let current = progress;
  if (persistCompletion && allResolved && !progress.completedAt) {
    current = await request.prisma.onboardingProgress.update({
      where: { userId: request.user.id },
      data: { completedAt: new Date(), dismissedAt: null },
    });
  } else if (persistCompletion && !allResolved && progress.completedAt) {
    current = await request.prisma.onboardingProgress.update({
      where: { userId: request.user.id },
      data: { completedAt: null },
    });
  }

  const state = current.completedAt
    ? 'completed'
    : current.dismissedAt
      ? 'skipped'
      : current.startedAt
        ? 'in_progress'
        : 'eligible';
  return {
    supported: true,
    role: request.user.role,
    state,
    startedAt: current.startedAt,
    dismissedAt: current.dismissedAt,
    completedAt: current.completedAt,
    completedCount: tasks.filter(task => task.completed || task.skipped).length,
    totalCount: tasks.length,
    tasks,
  };
}

async function updateProgress(request, data) {
  await getOrCreateProgress(request);
  return request.prisma.onboardingProgress.update({
    where: { userId: request.user.id },
    data: { ...data, roleSnapshot: request.user.role },
  });
}

export default async function onboardingRoutes(fastify) {
  fastify.get('/progress', { onRequest: [fastify.authenticate] }, async request => {
    const progress = await getOrCreateProgress(request);
    return presentProgress(request, progress);
  });

  fastify.post('/progress/start', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!ROLE_TASKS[request.user.role]) return reply.status(409).send({ error: 'Onboarding is deferred for this role' });
    const progress = await updateProgress(request, { startedAt: new Date(), dismissedAt: null });
    return presentProgress(request, progress);
  });

  fastify.post('/progress/tasks/skip', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(onboardingTaskActionSchema),
  }, async (request, reply) => {
    const validTasks = tasksForRole(request.user.role);
    if (!validTasks.some(task => task.id === request.body.taskId)) {
      return reply.status(404).send({ error: 'Onboarding task is not available for this role' });
    }
    const current = await getOrCreateProgress(request);
    const skippedTaskIds = [...new Set([...safeSkippedTaskIds(current.skippedTaskIds), request.body.taskId])];
    const progress = await updateProgress(request, {
      startedAt: current.startedAt || new Date(),
      dismissedAt: null,
      skippedTaskIds,
    });
    return presentProgress(request, progress);
  });

  fastify.post('/progress/skip', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!ROLE_TASKS[request.user.role]) return reply.status(409).send({ error: 'Onboarding is deferred for this role' });
    const progress = await updateProgress(request, { dismissedAt: new Date(), completedAt: null });
    return presentProgress(request, progress, { persistCompletion: false });
  });

  fastify.post('/progress/restart', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!ROLE_TASKS[request.user.role]) return reply.status(409).send({ error: 'Onboarding is deferred for this role' });
    const progress = await updateProgress(request, {
      skippedTaskIds: [],
      startedAt: null,
      dismissedAt: null,
      completedAt: null,
    });
    return presentProgress(request, progress, { persistCompletion: false });
  });

  // Existing admin/Bot client setup workflow.
  fastify.post('/client', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(onboardingClientSchema),
  }, async (request, reply) => {
    if (request.user.role !== 'BOT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin or Bot access required' });
    }
    const { name, email, contactName, retainerTier, notes } = request.body;
    if (!name || !email || !contactName || !retainerTier) {
      return reply.status(400).send({ error: 'name, email, contactName, and retainerTier are required' });
    }
    if (!['999', '1999', '3999'].includes(String(retainerTier))) {
      return reply.status(400).send({ error: 'retainerTier must be 999, 1999, or 3999' });
    }
    return onboardClient(fastify, { name, email, contactName, retainerTier: String(retainerTier), notes });
  });
}
