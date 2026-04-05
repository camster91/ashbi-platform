// VPS Health Dashboard Routes
// GET /api/integrations/vps/health     - Coolify apps status, container health, disk, uptime
// POST /api/integrations/vps/restart/:appUuid  - restart an app

const COOLIFY_URL = process.env.COOLIFY_URL || 'http://187.77.26.99:8000';
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;

function headers() {
  return {
    'Authorization': `Bearer ${COOLIFY_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

export default async function vpsRoutes(fastify) {

  // Full VPS health snapshot
  fastify.get('/health', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const h = headers();

      // Fetch in parallel: applications, services, servers
      const [appsRes, serversRes] = await Promise.allSettled([
        fetch(`${COOLIFY_URL}/api/v1/applications`, { headers: h }),
        fetch(`${COOLIFY_URL}/api/v1/servers`, { headers: h }),
      ]);

      let apps = [];
      let servers = [];

      if (appsRes.status === 'fulfilled' && appsRes.value.ok) {
        apps = await appsRes.value.json();
      }
      if (serversRes.status === 'fulfilled' && serversRes.value.ok) {
        servers = await serversRes.value.json();
      }

      // Normalize app statuses
      const normalizedApps = Array.isArray(apps) ? apps.map(app => ({
        uuid: app.uuid,
        name: app.name,
        status: app.status,
        fqdn: app.fqdn,
        repository: app.git_repository,
        branch: app.git_branch,
        lastDeployedAt: app.last_deployed_at,
        health: deriveHealth(app.status),
      })) : [];

      // Categorize by health
      const healthy = normalizedApps.filter(a => a.health === 'green').length;
      const warning = normalizedApps.filter(a => a.health === 'yellow').length;
      const critical = normalizedApps.filter(a => a.health === 'red').length;

      return {
        summary: { healthy, warning, critical, total: normalizedApps.length },
        apps: normalizedApps,
        servers: Array.isArray(servers) ? servers.map(s => ({
          uuid: s.uuid,
          name: s.name,
          ip: s.ip,
          status: s.validation_status,
          settings: s.settings,
        })) : [],
        fetchedAt: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err, 'VPS health fetch error');
      return reply.status(500).send({ error: 'Failed to fetch VPS health', detail: err.message });
    }
  });

  // Get single application status
  fastify.get('/apps/:uuid', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { uuid } = request.params;
    try {
      const res = await fetch(`${COOLIFY_URL}/api/v1/applications/${uuid}`, { headers: headers() });
      if (!res.ok) return reply.status(502).send({ error: 'Coolify error' });
      return await res.json();
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Restart an application
  fastify.post('/restart/:uuid', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { uuid } = request.params;
    try {
      const res = await fetch(`${COOLIFY_URL}/api/v1/applications/${uuid}/restart`, {
        method: 'GET',
        headers: headers()
      });
      const data = await res.json().catch(() => ({}));
      return { success: res.ok, data, restartedAt: new Date().toISOString() };
    } catch (err) {
      fastify.log.error(err, 'Restart error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // Stop an application
  fastify.post('/stop/:uuid', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { uuid } = request.params;
    try {
      const res = await fetch(`${COOLIFY_URL}/api/v1/applications/${uuid}/stop`, {
        method: 'GET',
        headers: headers()
      });
      const data = await res.json().catch(() => ({}));
      return { success: res.ok, data };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Start an application
  fastify.post('/start/:uuid', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { uuid } = request.params;
    try {
      const res = await fetch(`${COOLIFY_URL}/api/v1/applications/${uuid}/start`, {
        method: 'GET',
        headers: headers()
      });
      const data = await res.json().catch(() => ({}));
      return { success: res.ok, data };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Deployment logs
  fastify.get('/logs/:uuid', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { uuid } = request.params;
    const { lines = 100 } = request.query;
    try {
      const res = await fetch(`${COOLIFY_URL}/api/v1/applications/${uuid}/logs?lines=${lines}`, {
        headers: headers()
      });
      if (!res.ok) return reply.status(502).send({ error: 'Coolify error' });
      const data = await res.json();
      return data;
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
}

// Map Coolify status → traffic light
function deriveHealth(status) {
  if (!status) return 'yellow';
  const s = status.toLowerCase();
  if (s.includes('running') || s === 'healthy') return 'green';
  if (s.includes('starting') || s.includes('restarting') || s.includes('deploying')) return 'yellow';
  if (s.includes('stopped') || s.includes('exited') || s.includes('error') || s.includes('failed')) return 'red';
  return 'yellow';
}
