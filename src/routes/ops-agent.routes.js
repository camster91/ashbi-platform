// Ops Agent Routes — site health, deployments, infrastructure status

export default async function opsAgentRoutes(fastify) {
  // Known Ashbi sites to monitor
  const ASHBI_SITES = [
    { name: 'Agency Hub', url: 'https://hub.ashbi.ca', type: 'app' },
    { name: 'Ashbi Design', url: 'https://ashbi.ca', type: 'wordpress' },
    { name: 'Ashbi Blog', url: 'https://ashbi.ca/blog', type: 'wordpress' },
  ];

  // GET /api/ops/sites/health — health check all Ashbi sites
  fastify.get('/sites/health', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const healthChecks = await Promise.allSettled(
      ASHBI_SITES.map(async (site) => {
        const start = Date.now();
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(site.url, {
            method: 'HEAD',
            signal: controller.signal,
            headers: { 'User-Agent': 'AshbiHub-Monitor/1.0' }
          });
          clearTimeout(timeout);
          const latency = Date.now() - start;
          return {
            ...site,
            status: res.ok ? 'online' : `http_${res.status}`,
            statusCode: res.status,
            latencyMs: latency,
            checkedAt: new Date().toISOString()
          };
        } catch (err) {
          return {
            ...site,
            status: err.name === 'AbortError' ? 'timeout' : 'offline',
            error: err.message,
            latencyMs: Date.now() - start,
            checkedAt: new Date().toISOString()
          };
        }
      })
    );

    const results = healthChecks.map(r =>
      r.status === 'fulfilled' ? r.value : { status: 'error', error: r.reason?.message }
    );

    const allOnline = results.every(r => r.status === 'online');
    const anyOffline = results.some(r => r.status === 'offline' || r.status === 'timeout');

    return {
      overall: anyOffline ? 'degraded' : allOnline ? 'healthy' : 'partial',
      sites: results,
      summary: `${results.filter(r => r.status === 'online').length}/${results.length} sites online`,
      timestamp: new Date().toISOString()
    };
  });

  // POST /api/ops/deploy/:appUuid — trigger Coolify deployment
  fastify.post('/deploy/:appUuid', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { appUuid } = request.params;

    const coolifyUrl = process.env.COOLIFY_URL;
    const coolifyToken = process.env.COOLIFY_TOKEN;

    if (!coolifyUrl || !coolifyToken) {
      return reply.status(503).send({
        error: 'Coolify not configured',
        hint: 'Set COOLIFY_URL and COOLIFY_TOKEN in environment variables'
      });
    }

    try {
      const res = await fetch(`${coolifyUrl}/api/v1/deploy`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${coolifyToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uuid: appUuid, force: request.body?.force || false })
      });

      if (!res.ok) {
        const error = await res.text();
        return reply.status(res.status).send({ error: 'Coolify deploy failed', details: error });
      }

      const result = await res.json();
      return {
        appUuid,
        status: 'deployment_triggered',
        coolifyResponse: result,
        triggeredAt: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to trigger deployment', details: err.message });
    }
  });

  // GET /api/ops/infrastructure/status — VPS and infrastructure health
  fastify.get('/infrastructure/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const coolifyUrl = process.env.COOLIFY_URL;
    const coolifyToken = process.env.COOLIFY_TOKEN;

    const infra = {
      hub: {
        status: 'online',
        uptime: process.uptime(),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        nodeVersion: process.version,
        pid: process.pid
      },
      coolify: null,
      timestamp: new Date().toISOString()
    };

    if (coolifyUrl && coolifyToken) {
      try {
        const res = await fetch(`${coolifyUrl}/api/v1/healthcheck`, {
          headers: { 'Authorization': `Bearer ${coolifyToken}` },
          signal: AbortSignal.timeout(5000)
        });
        infra.coolify = {
          status: res.ok ? 'connected' : `http_${res.status}`,
          url: coolifyUrl
        };
      } catch (err) {
        infra.coolify = { status: 'unreachable', error: err.message };
      }
    } else {
      infra.coolify = { status: 'not_configured', hint: 'Set COOLIFY_URL and COOLIFY_TOKEN' };
    }

    return infra;
  });
}
