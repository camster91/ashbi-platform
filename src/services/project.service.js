// Project service - Enterprise Logic Layer

import aiClient from '../ai/client.js';
import { buildReplanProjectPrompt } from '../ai/prompts/replanProject.js';
import { safeParse } from '../utils/safeParse.js';

/**
 * Calculate project health score
 */
export function calculateHealthScore(project, threads) {
  let score = 100;

  const criticalThreads = threads.filter(t =>
    t.priority === 'CRITICAL' && t.status !== 'RESOLVED'
  );
  if (criticalThreads.length > 0) score -= 30;

  const needsResponse = threads.filter(t => t.status === 'AWAITING_RESPONSE');
  if (needsResponse.length > 2) score -= 15;

  const now = new Date();
  const staleThreads = threads.filter(t => {
    const daysSinceActivity = (now - new Date(t.lastActivityAt)) / (1000 * 60 * 60 * 24);
    return daysSinceActivity >= 3 && t.status !== 'RESOLVED';
  });
  score -= Math.min(staleThreads.length * 10, 30);

  const longWaits = threads.filter(t => {
    const daysSinceActivity = (now - new Date(t.lastActivityAt)) / (1000 * 60 * 60 * 24);
    return daysSinceActivity >= 5 && t.status === 'AWAITING_RESPONSE';
  });
  score -= Math.min(longWaits.length * 5, 20);

  return Math.max(0, score);
}

export function getHealthStatus(score) {
  if (score >= 80) return 'ON_TRACK';
  if (score >= 50) return 'NEEDS_ATTENTION';
  return 'AT_RISK';
}

/**
 * Calculate full budget metrics for a project
 */
export async function getProjectBudgetMetrics(prisma, projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, budget: true, hourlyBudget: true, clientId: true }
  });
  
  if (!project) return null;

  const timeEntries = await prisma.timeEntry.findMany({
    where: { projectId },
    include: { user: { select: { id: true, name: true, hourlyRate: true } } }
  });

  const totalMinutes = timeEntries.reduce((s, e) => s + e.duration, 0);
  const totalHours = totalMinutes / 60;
  const billableMinutes = timeEntries.filter(e => e.billable).reduce((s, e) => s + e.duration, 0);
  const billableHours = billableMinutes / 60;

  const costByUser = {};
  for (const entry of timeEntries) {
    const rate = entry.user?.hourlyRate || 0;
    const hours = entry.duration / 60;
    const cost = hours * rate;
    const uid = entry.userId;
    if (!costByUser[uid]) costByUser[uid] = { user: entry.user, hours: 0, cost: 0 };
    costByUser[uid].hours += hours;
    costByUser[uid].cost += cost;
  }

  const expenses = await prisma.expense.findMany({ where: { projectId } });
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  const budgetAmount = project.budget || 0;
  const hourlyBudget = project.hourlyBudget || 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentEntries = timeEntries.filter(e => new Date(e.date) >= thirtyDaysAgo);
  const recentHours = recentEntries.reduce((s, e) => s + e.duration, 0) / 60;

  const budgetUsed = budgetAmount > 0 
    ? (Object.values(costByUser).reduce((s, u) => s + u.cost, 0) + totalExpenses) 
    : totalHours * 50;
    
  return {
    project: { id: project.id, name: project.name, budget: budgetAmount, hourlyBudget },
    time: { totalHours, billableHours, totalMinutes, billableMinutes },
    costByUser: Object.values(costByUser),
    totalCost: Object.values(costByUser).reduce((s, u) => s + u.cost, 0),
    expenses: { total: totalExpenses, count: expenses.length },
    budgetUsed,
    budgetRemaining: budgetAmount > 0 ? budgetAmount - budgetUsed : null,
    hoursRemaining: hourlyBudget > 0 ? hourlyBudget - billableHours : null,
    burnRate: recentHours > 0 ? recentHours / 30 : 0,
    percentUsed: budgetAmount > 0 ? Math.round((budgetUsed / budgetAmount) * 100) : (hourlyBudget > 0 ? Math.round((billableHours / hourlyBudget) * 100) : null)
  };
}

/**
 * Refresh project plan using AI
 */
export async function refreshProjectPlan(prisma, projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: true,
      threads: {
        where: { status: { not: 'RESOLVED' } },
        orderBy: { lastActivityAt: 'desc' },
        include: {
          messages: { orderBy: { receivedAt: 'desc' }, take: 1 }
        }
      },
      tasks: { where: { status: { not: 'COMPLETED' } } }
    }
  });

  if (!project) throw new Error('Project not found');

  const recentMessage = project.threads[0]?.messages[0];

  if (!recentMessage) {
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

  await syncTasksFromPlan(prisma, projectId, result.plan);

  return updatedProject;
}

async function syncTasksFromPlan(prisma, projectId, plan) {
  const existingAiTasks = await prisma.task.findMany({
    where: { projectId, aiGenerated: true, status: { not: 'COMPLETED' } }
  });

  const allPlannedTasks = [...(plan.immediate || []), ...(plan.thisWeek || [])];
  
  for (const item of allPlannedTasks) {
    const exists = existingAiTasks.some(t =>
      t.title.toLowerCase().includes(item.task.toLowerCase().substring(0, 20))
    );

    if (!exists) {
      await prisma.task.create({
        data: {
          title: item.task,
          description: item.reason,
          priority: item.priority || 'NORMAL',
          category: item.category || 'UPCOMING',
          estimatedTime: item.estimatedTime,
          blockedBy: item.blockedBy,
          aiGenerated: true,
          projectId
        }
      });
    }
  }
}

export const HEALTH_HISTORY_LIMIT = 90;
export const HEALTH_HISTORY_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Finished projects keep their last score; scoring them hourly is wasted work.
export const HEALTH_INACTIVE_STATUSES = Object.freeze(['LAUNCHED', 'CANCELLED']);
const HEALTH_UPDATE_CONCURRENCY = 10;

/**
 * The stored Json? history as an array of points. Earlier code wrote
 * `{ push: point }` (Prisma stored the literal object on the Json column),
 * so that legacy shape is recovered as a one-point history.
 */
export function normalizeHealthHistory(value) {
  if (value && !Array.isArray(value) && typeof value === 'object' && value.push && typeof value.push === 'object') {
    value = [value.push];
  }
  if (!Array.isArray(value)) return [];
  return value.filter((point) => point && typeof point === 'object' && typeof point.timestamp === 'string');
}

/**
 * Append a point when the health changed or the newest point is at least a
 * day old, keeping the newest HEALTH_HISTORY_LIMIT points. Returns null when
 * nothing needs to be written.
 */
export function nextHealthHistory(history, point, { now = Date.now() } = {}) {
  const points = normalizeHealthHistory(history);
  const last = points[points.length - 1];
  const changed = !last || last.health !== point.health || last.score !== point.score;
  const stale = !last || now - Date.parse(last.timestamp) >= HEALTH_HISTORY_MIN_INTERVAL_MS;
  if (!changed && !stale) return null;
  return [...points, point].slice(-HEALTH_HISTORY_LIMIT);
}

/**
 * Update health scores for active projects (called by the hourly health job).
 * `healthHistory` is a Json? column, so it is read, extended and capped here.
 * (`{ push }` only works on scalar lists; on Json Prisma stored the literal
 * `{"push": point}` object, overwriting the history every hour.)
 * Projects whose score, status and history are unchanged are not written.
 */
export async function updateAllProjectHealth(prismaClient, { now = new Date() } = {}) {
  const prisma = prismaClient || (await import('../config/db.js')).default;

  const projects = await prisma.project.findMany({
    where: { status: { notIn: [...HEALTH_INACTIVE_STATUSES] } },
    select: {
      id: true,
      health: true,
      healthScore: true,
      healthHistory: true,
      threads: {
        where: { status: { not: 'RESOLVED' } },
        select: { priority: true, status: true, lastActivityAt: true },
      },
    },
  });

  const writes = [];
  for (const project of projects) {
    const score = calculateHealthScore(project, project.threads);
    const health = getHealthStatus(score);
    const history = nextHealthHistory(
      project.healthHistory,
      { health, score, timestamp: now.toISOString() },
      { now: now.getTime() },
    );
    if (!history && score === project.healthScore && health === project.health) continue;
    writes.push({
      where: { id: project.id },
      data: { healthScore: score, health, ...(history ? { healthHistory: history } : {}) },
    });
  }

  for (let index = 0; index < writes.length; index += HEALTH_UPDATE_CONCURRENCY) {
    await Promise.all(writes.slice(index, index + HEALTH_UPDATE_CONCURRENCY).map((args) => prisma.project.update(args)));
  }

  console.log(`[health] Scored ${projects.length} active projects, updated ${writes.length}`);
  return writes.length;
}
