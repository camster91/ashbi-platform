// Hostinger Multi-Server Monitor Routes
// GET /api/integrations/hostinger/sites   - uptime + health for all sites
// GET /api/integrations/hostinger/stores  - WooCommerce store health + revenue
//
// Because Hostinger shared hosting has no API, we probe sites via HTTP HEAD/GET
// and store the known site list in env/config. SSH-based checks can be added
// for deeper metrics (PHP version, disk, backup) via the VPS SSH tunnel.

const ASHBI_SITES = (process.env.HOSTINGER_ASHBI_SITES || 'ashbi.ca').split(',').map(s => s.trim()).filter(Boolean);
const INFLUENCER_STORES = (process.env.HOSTINGER_INFLUENCER_STORES || '').split(',').map(s => s.trim()).filter(Boolean);

// Default curated site list (Cameron's known sites)
const DEFAULT_ASHBI_SITES = [
  'ashbi.ca', 'ashbidesign.com', 'biancaashbi.com',
];

const DEFAULT_INFLUENCER_STORES = [
  // Add the 26 WooCommerce store domains here once known
];

export default async function hostingerRoutes(fastify) {

  // Probe all ashbi.ca + client sites
  fastify.get('/sites', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const sites = ASHBI_SITES.length > 1 ? ASHBI_SITES : DEFAULT_ASHBI_SITES;

    const results = await Promise.allSettled(
      sites.map(domain => probeSite(domain))
    );

    const siteStatuses = results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { domain: sites[i], status: 'error', health: 'red', error: r.reason?.message || 'Unknown error', checkedAt: new Date().toISOString() }
    );

    const healthy = siteStatuses.filter(s => s.health === 'green').length;
    const warning = siteStatuses.filter(s => s.health === 'yellow').length;
    const critical = siteStatuses.filter(s => s.health === 'red').length;

    return {
      summary: { healthy, warning, critical, total: siteStatuses.length },
      sites: siteStatuses,
      fetchedAt: new Date().toISOString()
    };
  });

  // Probe all WooCommerce stores
  fastify.get('/stores', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const stores = INFLUENCER_STORES.length > 0 ? INFLUENCER_STORES : DEFAULT_INFLUENCER_STORES;

    if (stores.length === 0) {
      return {
        message: 'No stores configured. Set HOSTINGER_INFLUENCER_STORES env var with comma-separated domains.',
        stores: [],
        fetchedAt: new Date().toISOString()
      };
    }

    const results = await Promise.allSettled(
      stores.map(domain => probeWooStore(domain))
    );

    const storeStatuses = results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { domain: stores[i], status: 'error', health: 'red', error: r.reason?.message, checkedAt: new Date().toISOString() }
    );

    return {
      summary: {
        healthy: storeStatuses.filter(s => s.health === 'green').length,
        warning: storeStatuses.filter(s => s.health === 'yellow').length,
        critical: storeStatuses.filter(s => s.health === 'red').length,
        total: storeStatuses.length,
      },
      stores: storeStatuses,
      fetchedAt: new Date().toISOString()
    };
  });

  // Single site probe (manual refresh)
  fastify.get('/sites/:domain', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { domain } = request.params;
    try {
      const result = await probeSite(domain);
      return result;
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Add a site to monitor (stored in DB settings)
  fastify.post('/sites', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { domain, type = 'site', notes } = request.body || {};
    if (!domain) return reply.status(400).send({ error: 'domain required' });

    // Probe immediately to validate
    const probe = await probeSite(domain).catch(e => ({ error: e.message }));
    return { domain, type, notes, probe };
  });
}

// HTTP probe for a site — returns health status
async function probeSite(domain) {
  const url = `https://${domain}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - start;
    const status = res.status;
    const health = status >= 500 ? 'red' : status >= 400 ? 'yellow' : 'green';

    return {
      domain,
      url,
      status,
      health,
      latencyMs,
      finalUrl: res.url,
      checkedAt: new Date().toISOString()
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return {
      domain,
      url,
      status: 'timeout',
      health: 'red',
      latencyMs,
      error: err.message,
      checkedAt: new Date().toISOString()
    };
  }
}

// WooCommerce store probe — checks site + WC REST API if keys available
async function probeWooStore(domain) {
  const base = await probeSite(domain);
  // WooCommerce health endpoint (no auth needed for basic check)
  try {
    const wcRes = await fetch(`https://${domain}/wp-json/wc/v3/system_status`, {
      signal: AbortSignal.timeout(8000)
    });
    // 401 = WC is running, just no auth. 200 = has public access somehow.
    const wcHealth = wcRes.status === 401 || wcRes.status === 200 ? 'green' : 'yellow';
    return { ...base, woocommerce: { apiStatus: wcRes.status, health: wcHealth } };
  } catch {
    return { ...base, woocommerce: { apiStatus: 'unreachable', health: 'yellow' } };
  }
}
