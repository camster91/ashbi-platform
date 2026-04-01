// Project service

import { prisma } from '../index.js';
import aiClient from '../ai/client.js';
import { buildReplanProjectPrompt } from '../ai/prompts/replanProject.js';

/**
 * Calculate project health score
 */
export function calculateHealthScore(project, threads) {
  let score = 100;

  // Critical open threads: -30
  const criticalThreads = threads.filter(t =>
    t.priority === 'CRITICAL' && t.status !== 'RESOLVED'
  );
  if (criticalThreads.length > 0) {
    score -= 30;
  }

  // More than 2 threads needing response: -15
  const needsResponse = threads.filter(t =>
    t.status === 'AWAITING_RESPONSE'
  );
  if (needsResponse.length > 2) {
    score -= 15;
  }

  // Stale threads (no activity 3+ days): -10 each
  const now = new Date();
  const staleDays = 3;
  const staleThreads = threads.filter(t => {
    const daysSinceActivity = (now - new Date(t.lastActivityAt)) / (1000 * 60 * 60 * 24);
    return daysSinceActivity >= staleDays && t.status !== 'RESOLVED';
  });
  score -= Math.min(staleThreads.length * 10, 30); // Cap at -30

  // Long client waits: -5 each
  const longWaits = threads.filter(t => {
    const daysSinceActivity = (now - new Date(t.lastActivityAt)) / (1000 * 60 * 60 * 24);
    return daysSinceActivity >= 5 && t.status === 'AWAITING_RESPONSE';
  });
  score -= Math.min(longWaits.length * 5, 20); // Cap at -20

  return Math.max(0, score);
}

/**
 * Determine health status from score
 */
export function getHealthStatus(score) {
  if (score >= 80) return 'ON_TRACK';
  if (score >= 50) return 'NEEDS_ATTENTION';
  return 'AT_RISK';
}

/**
 * Update all project health scores
 */
export async function updateAllProjectHealth() {
  const projects = await prisma.project.findMany({
    where: { status: 'ACTIVE' },
    include: {
      threads: {
        where: { status: { not: 'RESOLVED' } }
      }
    }
  });

  for (const project of projects) {
    const score = calculateHealthScore(project, project.threads);
    const health = getHealthStatus(score);

    await prisma.project.update({
      where: { id: project.id },
      data: { healthScore: score, health }
    });
  }

  return projects.length;
}

/**
 * Refresh project plan using AI
 */
export async function refreshProjectPlan(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: true,
      threads: {
        where: { status: { not: 'RESOLVED' } },
        orderBy: { lastActivityAt: 'desc' },
        include: {
          messages: {
            orderBy: { receivedAt: 'desc' },
            take: 1
          }
        }
      },
      tasks: {
        where: { status: { not: 'COMPLETED' } }
      }
    }
  });

  if (!project) {
    throw new Error('Project not found');
  }

  // Get most recent message for context
  const recentMessage = project.threads[0]?.messages[0];

  if (!recentMessage) {
    // No messages to analyze, just update health
    const score = calculateHealthScore(project, project.threads);
    const health = getHealthStatus(score);

    return prisma.project.update({
      where: { id: projectId },
      data: {
        healthScore: score,
        health,
        aiSummary: `Project ${project.name} has ${project.threads.length} active threads and ${project.tasks.length} pending tasks.`
      }
    });
  }

  const { system, prompt, temperature } = buildReplanProjectPrompt({
    project,
    threads: project.threads,
    newMessage: recentMessage
  });

  const result = await aiClient.chatJSON({ system, prompt, temperature });

  // Update project
  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: {
      aiSummary: result.projectSummary,
      aiPlan: JSON.stringify(result.plan),
      health: result.overallHealth,
      healthScore: result.healthScore,
      risks: JSON.stringify(result.risks)
    }
  });

  // Sync tasks from AI plan
  await syncTasksFromPlan(projectId, result.plan);

  return updatedProject;
}

/**
 * Sync AI-generated tasks with existing tasks
 */
async function syncTasksFromPlan(projectId, plan) {
  // Get existing AI-generated tasks
  const existingAiTasks = await prisma.task.findMany({
    where: {
      projectId,
      aiGenerated: true,
      status: { not: 'COMPLETED' }
    }
  });

  // Create new immediate tasks that don't exist
  if (plan.immediate?.length > 0) {
    for (const item of plan.immediate) {
      // Check if similar task exists
      const exists = existingAiTasks.some(t =>
        t.title.toLowerCase().includes(item.task.toLowerCase().substring(0, 20))
      );

      if (!exists) {
        await prisma.task.create({
          data: {
            title: item.task,
            description: item.reason,
            priority: 'HIGH',
            category: 'IMMEDIATE',
            estimatedTime: item.estimatedTime,
            blockedBy: item.blockedBy,
            aiGenerated: true,
            projectId
          }
        });
      }
    }
  }

  // Create this week tasks
  if (plan.thisWeek?.length > 0) {
    for (const item of plan.thisWeek) {
      const exists = existingAiTasks.some(t =>
        t.title.toLowerCase().includes(item.task.toLowerCase().substring(0, 20))
      );

      if (!exists) {
        await prisma.task.create({
          data: {
            title: item.task,
            description: item.reason,
            priority: 'NORMAL',
            category: 'THIS_WEEK',
            estimatedTime: item.estimatedTime,
            aiGenerated: true,
            projectId
          }
        });
      }
    }
  }
}

/**
 * Get project timeline/history
 */
export async function getProjectTimeline(projectId) {
  const [threads, tasks, responses] = await Promise.all([
    prisma.thread.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        subject: true,
        status: true,
        createdAt: true,
        priority: true
      }
    }),
    prisma.task.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        completedAt: true
      }
    }),
    prisma.response.findMany({
      where: {
        thread: { projectId }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        sentAt: true
      }
    })
  ]);

  // Combine and sort by date
  const timeline = [
    ...threads.map(t => ({ type: 'thread', ...t })),
    ...tasks.map(t => ({ type: 'task', ...t })),
    ...responses.map(r => ({ type: 'response', ...r }))
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return timeline;
}
