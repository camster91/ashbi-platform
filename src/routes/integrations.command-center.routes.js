// Command Center Aggregate Route
// GET /api/command-center   - single endpoint that aggregates all integration data
// Returns all panels in one response for the dashboard

import { prisma } from '../index.js';

const COOLIFY_URL = process.env.COOLIFY_URL || 'http://187.77.26.99:8000';
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG || 'camster91';
const NOTION_TOKEN = process.env.NOTION_TOKEN;

export default async function commandCenterRoutes(fastify) {

  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const results = await Promise.allSettled([
      fetchGithubSummary(),
      fetchVpsSummary(),
      fetchHubTasks(),
      fetchRecentActivity(),
    ]);

    const [github, vps, tasks, activity] = results.map(r =>
      r.status === 'fulfilled' ? r.value : { error: r.reason?.message || 'fetch failed' }
    );

    return {
      github,
      vps,
      tasks,
      activity,
      generatedAt: new Date().toISOString()
    };
  });

  // Minimal live ping for the 60s auto-refresh
  fastify.get('/ping', {
    onRequest: [fastify.authenticate]
  }, async () => {
    return { alive: true, ts: new Date().toISOString() };
  });
}

async function fetchGithubSummary() {
  try {
    const token = process.env.GITHUB_TOKEN;
    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    // Get recent pushes / open PRs count
    const [reposRes, pullsRes] = await Promise.allSettled([
      fetch(`https://api.github.com/users/${GITHUB_ORG}/repos?per_page=10&sort=pushed`, { headers }),
      fetch(`https://api.github.com/search/issues?q=is:pr+is:open+user:${GITHUB_ORG}&per_page=5`, { headers }),
    ]);

    let recentRepos = [];
    let openPRCount = 0;
    let failingCI = 0;

    if (reposRes.status === 'fulfilled' && reposRes.value.ok) {
      const repos = await reposRes.value.json();
      recentRepos = repos.slice(0, 5).map(r => ({
        name: r.name,
        pushedAt: r.pushed_at,
        url: r.html_url
      }));
    }

    if (pullsRes.status === 'fulfilled' && pullsRes.value.ok) {
      const data = await pullsRes.value.json();
      openPRCount = data.total_count || 0;
    }

    return {
      recentRepos,
      openPRCount,
      failingCI,
      health: failingCI > 0 ? 'yellow' : 'green'
    };
  } catch (err) {
    return { error: err.message, health: 'yellow' };
  }
}

async function fetchVpsSummary() {
  if (!COOLIFY_TOKEN) return { error: 'COOLIFY_TOKEN not set', health: 'yellow' };

  try {
    const headers = {
      'Authorization': `Bearer ${COOLIFY_TOKEN}`,
      'Content-Type': 'application/json'
    };
    const res = await fetch(`${COOLIFY_URL}/api/v1/applications`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { error: `Coolify ${res.status}`, health: 'yellow' };

    const apps = await res.json();
    const appList = Array.isArray(apps) ? apps : [];

    const running = appList.filter(a => a.status?.toLowerCase().includes('running')).length;
    const stopped = appList.filter(a => a.status?.toLowerCase().includes('stopped') || a.status?.toLowerCase().includes('exited')).length;
    const errored = appList.filter(a => a.status?.toLowerCase().includes('error') || a.status?.toLowerCase().includes('failed')).length;

    return {
      total: appList.length,
      running,
      stopped,
      errored,
      health: errored > 0 ? 'red' : stopped > 0 ? 'yellow' : 'green',
      apps: appList.slice(0, 8).map(a => ({
        name: a.name,
        status: a.status,
        fqdn: a.fqdn
      }))
    };
  } catch (err) {
    return { error: err.message, health: 'yellow' };
  }
}

async function fetchHubTasks() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayTasks, overdueTasks, inProgressTasks] = await Promise.all([
      prisma.task.findMany({
        where: {
          dueDate: { gte: today, lt: new Date(today.getTime() + 86400000) },
          status: { not: 'DONE' }
        },
        include: { project: { select: { name: true } } },
        take: 10,
        orderBy: { priority: 'desc' }
      }),
      prisma.task.count({
        where: {
          dueDate: { lt: today },
          status: { notIn: ['DONE', 'CANCELLED'] }
        }
      }),
      prisma.task.count({
        where: { status: 'IN_PROGRESS' }
      })
    ]);

    return {
      todayCount: todayTasks.length,
      overdueCount: overdueTasks,
      inProgressCount: inProgressTasks,
      todayTasks: todayTasks.map(t => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        project: t.project?.name,
        dueDate: t.dueDate
      })),
      health: overdueTasks > 5 ? 'red' : overdueTasks > 0 ? 'yellow' : 'green'
    };
  } catch (err) {
    return { error: err.message, health: 'yellow' };
  }
}

async function fetchRecentActivity() {
  try {
    const activity = await prisma.activity?.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true } } }
    }).catch(() => []);

    return {
      items: activity.map(a => ({
        id: a.id,
        type: a.type,
        description: a.entityName || a.action,
        user: a.user?.name,
        createdAt: a.createdAt
      }))
    };
  } catch {
    return { items: [] };
  }
}
