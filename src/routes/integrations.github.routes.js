// GitHub Integration Routes
// GET /api/integrations/github/repos   - list repos with last commit, open PRs, CI status
// GET /api/integrations/github/deploys - trigger deploy via Coolify
// POST /api/integrations/github/deploy - trigger a deploy

const GITHUB_API = 'https://api.github.com';
const GITHUB_ORG = process.env.GITHUB_ORG || 'camster91';
const COOLIFY_URL = process.env.COOLIFY_URL || 'http://localhost:8000';
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  const headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function coolifyHeaders() {
  return { 'Authorization': `Bearer ${COOLIFY_TOKEN}`, 'Content-Type': 'application/json' };
}

export default async function githubRoutes(fastify) {

  // List all repos with last commit + open PR count + CI status
  fastify.get('/repos', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const headers = githubHeaders();
      const perPage = 100;

      // Fetch repos
      const reposRes = await fetch(`${GITHUB_API}/users/${GITHUB_ORG}/repos?per_page=${perPage}&sort=pushed`, { headers });
      if (!reposRes.ok) {
        return reply.status(502).send({ error: 'GitHub API error', detail: await reposRes.text() });
      }
      const repos = await reposRes.json();

      // Enrich with PR counts and CI status (parallel, best-effort)
      const enriched = await Promise.allSettled(
        repos.map(async (repo) => {
          const [prsRes, runsRes] = await Promise.allSettled([
            fetch(`${GITHUB_API}/repos/${GITHUB_ORG}/${repo.name}/pulls?state=open&per_page=100`, { headers }),
            fetch(`${GITHUB_API}/repos/${GITHUB_ORG}/${repo.name}/actions/runs?per_page=5`, { headers }),
          ]);

          let openPRs = 0;
          let ciStatus = 'unknown';
          let ciConclusion = null;

          if (prsRes.status === 'fulfilled' && prsRes.value.ok) {
            const prs = await prsRes.value.json();
            openPRs = Array.isArray(prs) ? prs.length : 0;
          }

          if (runsRes.status === 'fulfilled' && runsRes.value.ok) {
            const runs = await runsRes.value.json();
            const latest = runs.workflow_runs?.[0];
            if (latest) {
              ciStatus = latest.status;
              ciConclusion = latest.conclusion;
            }
          }

          return {
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description,
            url: repo.html_url,
            private: repo.private,
            defaultBranch: repo.default_branch,
            language: repo.language,
            pushedAt: repo.pushed_at,
            updatedAt: repo.updated_at,
            openPRs,
            ciStatus,
            ciConclusion,
            stars: repo.stargazers_count,
            topics: repo.topics || [],
          };
        })
      );

      const result = enriched
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

      return { repos: result, count: result.length, fetchedAt: new Date().toISOString() };
    } catch (err) {
      fastify.log.error(err, 'GitHub repos fetch error');
      return reply.status(500).send({ error: 'Failed to fetch repos', detail: err.message });
    }
  });

  // List Coolify deployments (linked to GitHub repos)
  fastify.get('/deploys', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const headers = await coolifyHeaders();
      const appsRes = await fetch(`${COOLIFY_URL}/api/v1/applications`, { headers });
      if (!appsRes.ok) {
        return reply.status(502).send({ error: 'Coolify API error', detail: await appsRes.text() });
      }
      const apps = await appsRes.json();
      return { deployments: apps, count: apps.length, fetchedAt: new Date().toISOString() };
    } catch (err) {
      fastify.log.error(err, 'Coolify deploys fetch error');
      return reply.status(500).send({ error: 'Failed to fetch deployments', detail: err.message });
    }
  });

  // Trigger a deploy for a Coolify application
  fastify.post('/deploy/:appUuid', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { appUuid } = request.params;
    try {
      const headers = await coolifyHeaders();
      const res = await fetch(`${COOLIFY_URL}/api/v1/deploy?uuid=${appUuid}&force=false`, {
        method: 'GET',
        headers
      });
      const data = await res.json();
      return { success: res.ok, data };
    } catch (err) {
      fastify.log.error(err, 'Deploy trigger error');
      return reply.status(500).send({ error: 'Deploy failed', detail: err.message });
    }
  });

  // Open PRs across all repos
  fastify.get('/pulls', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const headers = githubHeaders();
      const searchRes = await fetch(
        `${GITHUB_API}/search/issues?q=is:pr+is:open+user:${GITHUB_ORG}&per_page=50`,
        { headers }
      );
      if (!searchRes.ok) {
        return reply.status(502).send({ error: 'GitHub search error' });
      }
      const data = await searchRes.json();
      return { pulls: data.items || [], totalCount: data.total_count, fetchedAt: new Date().toISOString() };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
