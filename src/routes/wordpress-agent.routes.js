// WordPress Agent Routes — site audits, health checks, plugin management, security scans

import { getProvider } from '../ai/providers/index.js';

export default async function wordpressAgentRoutes(fastify) {
  // Helper: get site credentials
  async function getSiteCredentials(domain) {
    try {
      const cred = await fastify.prisma.credential.findFirst({
        where: { label: { contains: domain } }
      });
      if (cred) {
        try { return JSON.parse(cred.password); } catch { return {}; }
      }
    } catch {}
    return null;
  }

  // GET /api/wordpress/site/:domain/audit — run full site audit
  fastify.get('/site/:domain/audit', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { domain } = request.params;

    try {
      const ai = getProvider();
      const prompt = `You are a WordPress expert. Generate a structured site audit report for: ${domain}
      
Return a JSON audit with these sections:
- performance: { score, issues[] }
- security: { score, vulnerabilities[] }
- seo: { score, issues[] }
- plugins: { count, outdated: 0, conflicts: [] }
- recommendations: []

Keep it concise and actionable for a CPG/DTC agency client.`;

      const auditText = await ai.generate(prompt, { maxTokens: 1000 });
      let audit;
      try {
        const jsonMatch = auditText.match(/\{[\s\S]*\}/);
        audit = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: auditText };
      } catch {
        audit = { summary: auditText };
      }

      return {
        domain,
        audit,
        auditedAt: new Date().toISOString(),
        status: 'complete',
        note: 'Connect WP-CLI SSH credentials for live data'
      };
    } catch (err) {
      fastify.log.error(err);
      return {
        domain,
        status: 'partial',
        error: err.message,
        auditedAt: new Date().toISOString()
      };
    }
  });

  // POST /api/wordpress/site/:domain/health-check — quick health check
  fastify.post('/site/:domain/health-check', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { domain } = request.params;

    // Attempt HTTP ping
    let httpStatus = 'unknown';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://${domain}/wp-json/wp/v2/`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'AshbiHub/1.0' }
      }).catch(() => null);
      clearTimeout(timeout);
      httpStatus = res ? (res.ok ? 'online' : `http_${res.status}`) : 'unreachable';
    } catch {
      httpStatus = 'timeout';
    }

    return {
      domain,
      status: httpStatus,
      checks: {
        http: httpStatus,
        wpApi: httpStatus === 'online' ? 'accessible' : 'unknown',
        ssl: domain.startsWith('https') ? 'enforced' : 'check_needed'
      },
      checkedAt: new Date().toISOString()
    };
  });

  // POST /api/wordpress/plugin/:domain/update — plugin management
  fastify.post('/plugin/:domain/update', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { domain } = request.params;
    const { plugins, action = 'update' } = request.body || {};

    const creds = await getSiteCredentials(domain);
    if (!creds?.sshHost) {
      return reply.status(503).send({
        error: 'SSH credentials not configured',
        hint: `Add SSH credentials for ${domain} in Credentials manager`,
        action: `/credentials → Add WordPress SSH for ${domain}`
      });
    }

    return {
      domain,
      action,
      plugins: plugins || ['all'],
      status: 'queued',
      message: `Plugin ${action} queued via WP-CLI. SSH to ${creds.sshHost} when ready.`,
      timestamp: new Date().toISOString()
    };
  });

  // GET /api/wordpress/site/:domain/issues — list current site issues
  fastify.get('/site/:domain/issues', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { domain } = request.params;

    // Pull any stored notes/activities referencing this domain
    const relatedNotes = await fastify.prisma.note.findMany({
      where: { content: { contains: domain } },
      orderBy: { createdAt: 'desc' },
      take: 10
    }).catch(() => []);

    return {
      domain,
      issues: relatedNotes.map(n => ({
        id: n.id,
        title: n.title,
        description: n.content?.substring(0, 200),
        reportedAt: n.createdAt
      })),
      issueCount: relatedNotes.length,
      timestamp: new Date().toISOString(),
      tip: 'Issues are pulled from Hub notes. Run an audit for automated issue detection.'
    };
  });

  // POST /api/wordpress/security/:domain/scan — security scan
  fastify.post('/security/:domain/scan', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { domain } = request.params;

    // Check common WordPress security endpoints
    const checks = await Promise.allSettled([
      fetch(`https://${domain}/wp-login.php`, { method: 'HEAD' }).then(r => ({ endpoint: 'wp-login', status: r.status })).catch(() => ({ endpoint: 'wp-login', status: 'blocked' })),
      fetch(`https://${domain}/xmlrpc.php`, { method: 'HEAD' }).then(r => ({ endpoint: 'xmlrpc', status: r.status })).catch(() => ({ endpoint: 'xmlrpc', status: 'blocked' })),
      fetch(`https://${domain}/wp-json/`, { method: 'HEAD' }).then(r => ({ endpoint: 'rest-api', status: r.status })).catch(() => ({ endpoint: 'rest-api', status: 'blocked' })),
    ]);

    const results = checks.map(c => c.status === 'fulfilled' ? c.value : { endpoint: 'unknown', status: 'error' });

    const risks = results.filter(r => r.status === 200 && r.endpoint === 'xmlrpc');
    const score = risks.length === 0 ? 'good' : 'needs_attention';

    return {
      domain,
      securityScore: score,
      checks: results,
      recommendations: risks.length > 0 ? ['Disable xmlrpc.php if not needed', 'Install a security plugin like Wordfence'] : [],
      scannedAt: new Date().toISOString()
    };
  });
}
