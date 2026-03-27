// Shopify Agent Routes — store health, product management, OAuth integration

export default async function shopifyAgentRoutes(fastify) {
  // GET /api/shopify/store/health — health check all connected stores
  fastify.get('/store/health', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      // Fetch connected Shopify stores from credentials
      const shopifyCredentials = await fastify.prisma.credential.findMany({
        where: { service: { startsWith: 'shopify' } }
      }).catch(() => []);

      if (!shopifyCredentials.length) {
        return {
          status: 'no_stores',
          message: 'No Shopify stores connected yet',
          stores: [],
          timestamp: new Date().toISOString()
        };
      }

      const storeHealth = await Promise.allSettled(
        shopifyCredentials.map(async (cred) => {
          let config = {};
          try { config = JSON.parse(cred.value); } catch { config = {}; }
          const storeName = cred.name || cred.service;
          return {
            store: storeName,
            status: config.accessToken ? 'connected' : 'needs_auth',
            domain: config.domain || null,
            lastChecked: new Date().toISOString()
          };
        })
      );

      return {
        stores: storeHealth.map(r => r.status === 'fulfilled' ? r.value : { status: 'error', error: r.reason?.message }),
        totalStores: shopifyCredentials.length,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to check store health', details: err.message });
    }
  });

  // POST /api/shopify/products/bulk-upload — bulk product import
  fastify.post('/products/bulk-upload', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { storeId, products } = request.body || {};

    if (!products || !Array.isArray(products)) {
      return reply.status(400).send({ error: 'products array is required' });
    }

    // Queue bulk upload job (placeholder — wire to actual Shopify API when credentials set)
    const jobId = `shopify-bulk-${Date.now()}`;

    return {
      jobId,
      status: 'queued',
      productCount: products.length,
      storeId: storeId || 'default',
      message: `Queued ${products.length} products for import`,
      timestamp: new Date().toISOString()
    };
  });

  // GET /api/shopify/products/:id — fetch product details
  fastify.get('/products/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { store } = request.query;

    return {
      id,
      store: store || 'default',
      status: 'not_configured',
      message: 'Connect a Shopify store to fetch product details',
      hint: 'POST /api/shopify/integration/connect to set up OAuth',
      timestamp: new Date().toISOString()
    };
  });

  // POST /api/shopify/integration/connect — OAuth flow initiation
  fastify.post('/integration/connect', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { shopDomain, redirectUri } = request.body || {};

    if (!shopDomain) {
      return reply.status(400).send({ error: 'shopDomain is required (e.g. mystore.myshopify.com)' });
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    if (!clientId) {
      return reply.status(503).send({
        error: 'Shopify integration not configured',
        hint: 'Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in environment variables'
      });
    }

    const scopes = 'read_products,write_products,read_orders,write_orders,read_inventory';
    const redirect = redirectUri || `${process.env.APP_URL || 'https://hub.ashbi.ca'}/api/shopify/integration/callback`;
    const authUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirect)}`;

    return {
      authUrl,
      shopDomain,
      scopes,
      message: 'Redirect user to authUrl to complete OAuth connection'
    };
  });

  // GET /api/shopify/integration/callback — OAuth callback handler
  fastify.get('/integration/callback', async (request, reply) => {
    const { code, shop, hmac } = request.query;

    if (!code || !shop) {
      return reply.status(400).send({ error: 'Missing OAuth parameters' });
    }

    // Store would be exchanged for access token here
    return {
      status: 'oauth_received',
      shop,
      message: 'Configure SHOPIFY_CLIENT_SECRET to complete token exchange',
      timestamp: new Date().toISOString()
    };
  });
}
