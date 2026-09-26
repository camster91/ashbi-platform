import logger from '../utils/logger.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import { enterRequestContext } from '../utils/request-context.js';
// CRITICAL: Import the NAMED `prisma` (the raw soft-delete-extended client
// at src/config/db.js line ~110), NOT the default export (the outer
// request-context-aware Proxy at line ~133). The default Proxy calls
// getRequestPrisma() on every property access. If we register it in the
// request context (enterRequestContext), then the default Proxy's get
// resolves to ITSELF when the request handler runs, causing infinite
// recursion → "Maximum call stack size exceeded". This was the cause of
// the login 500 + every other auth/webhook/portal route failing with the
// same error after the swarm-audit deploy on 2026-07-10.
//
// The same trap is documented in src/utils/request-context.js:30-32 —
// that file imports `prisma as basePrisma` for exactly this reason.
// tenancy.js was missed; fixed here.
import { prisma } from '../config/db.js';

/**
 * Whether an /api URL bypasses the tenant guard and gets the raw Prisma client.
 * Routes under these prefixes must scope their own queries (see the API access
 * matrix test, which lists every signed-in route that relies on that).
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isTenancyExemptUrl(url) {
  // Exempt Auth, Health, Public Portal, and Webhooks from strict isolation.
  //
  // Webhooks (Stripe, email inbound) authenticate via HMAC, not JWT —
  // they have no `request.user.organizationId`. Without this exemption
  // every webhook POST fails with 403 ORG_CONTEXT_REQUIRED before the
  // HMAC verify ever runs. Routes still verify signatures themselves.
  return (
    url.startsWith('/api/auth') ||
    url.startsWith('/api/webhooks') ||
    url.startsWith('/api/portal') ||
    // Bot API authenticates via BOT_SECRET bearer (not a JWT with org context);
    // client portal authenticates via its own CLIENT-role JWT and scopes every
    // query by clientId. Both must bypass the org guard (which would 403 before
    // their own auth runs), same as the webhook/portal exemptions above.
    url.startsWith('/api/bot') ||
    url.startsWith('/api/client-portal') ||
    url.startsWith('/api/client-acquisition/config') ||
    url.startsWith('/api/client-acquisition/intake') ||
    // Public, capability-token-based client flows (no JWT / org context).
    // These are scoped by an unguessable viewToken/signToken in the URL, not
    // by tenant. Without these exemptions the tenancy guard 403s before the
    // token lookup runs, breaking client proposal/contract/estimate/invoice
    // review links and the Mailgun HITL webhook.
    url.startsWith('/api/proposals/client') ||
    url.startsWith('/api/contracts/sign') ||
    url.startsWith('/api/estimates/view') ||
    url.startsWith('/api/invoices/client') ||
    url.startsWith('/api/invoices/stripe-webhook') ||
    url.startsWith('/api/mailgun') ||
    url.startsWith('/api/slack/events') ||
    url.startsWith('/api/slack/oauth/callback') ||
    url === '/api/health' ||
    url === '/api/live'
  );
}

/**
 * Enterprise Multi-Tenancy Middleware
 *
 * Ensures that every request is scoped to a specific organization.
 * It injects a scoped prisma client into the request AND publishes the scoped
 * client via AsyncLocalStorage so that service-layer code which imports the
 * raw `prisma` from `config/db.js` (or uses `fastify.prisma`) automatically
 * resolves to the per-request scoped client.
 */
export async function tenancyMiddleware(request, reply) {
  // Only enforce tenancy on API routes
  if (!request.url.startsWith('/api/')) {
    request.prisma = prisma;
    enterRequestContext({ prisma, organizationId: null });
    return;
  }

  if (isTenancyExemptUrl(request.url)) {
    request.prisma = prisma; // Use global for auth/portal/health/public routes
    enterRequestContext({ prisma, organizationId: null });
    return;
  }

  // SECURITY: Client-portal sessions carry the agency's organizationId (their
  // client belongs to it), so without this guard a CLIENT cookie would pass
  // the org scope below and read every other client's invoices, contracts,
  // proposals and the client list through the staff APIs. Clients reach their
  // own data only through /api/client-portal (scoped by clientId) and the
  // capability-token /api/portal routes, both exempted above.
  if (request.user?.role === 'CLIENT') {
    return reply.status(403).send({
      error: 'Client portal sessions cannot access staff APIs',
      code: 'CLIENT_SESSION_FORBIDDEN'
    });
  }

  // SECURITY: Derive organizationId from the verified JWT only.
  // The x-org-id header fallback was a tenant-spoofing vector (C5) — any
  // authenticated user could send x-org-id: <other-tenant> and read their data.
  const organizationId = request.user?.organizationId;

  if (!organizationId) {
    logger.warn({ url: request.url }, '🚫 Tenancy: Organization context missing');
    return reply.status(403).send({
      error: 'Organization context required',
      code: 'ORG_CONTEXT_REQUIRED'
    });
  }
  // Inject Scoped Prisma Client
  // This ensures no developer accidentally queries data from another tenant.
  const scopedPrisma = createScopedPrisma(prisma, organizationId);
  request.prisma = scopedPrisma;
  request.organizationId = organizationId;

  // Publish to AsyncLocalStorage so that any code calling `getRequestPrisma()`
  // (or accessing `db.js`'s default proxy / `fastify.prisma`) sees the same
  // scoped client for the duration of this request.
  // requestId and feature label AI usage records made during the request
  // (src/ai/governance.js).
  enterRequestContext({
    prisma: scopedPrisma,
    organizationId,
    requestId: request.id,
    feature: request.routeOptions?.url ?? null,
  });

  logger.debug({ organizationId }, '🛡️ Tenancy: Request scoped via Proxy');
}
