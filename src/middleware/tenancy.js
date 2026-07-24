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

  // Exempt Auth, Health, Public Portal, and Webhooks from strict isolation.
  //
  // Webhooks (Stripe, email inbound) authenticate via HMAC, not JWT —
  // they have no `request.user.organizationId`. Without this exemption
  // every webhook POST fails with 403 ORG_CONTEXT_REQUIRED before the
  // HMAC verify ever runs. Routes still verify signatures themselves.
  if (
    request.url.startsWith('/api/auth') ||
    request.url.startsWith('/api/webhooks') ||
    request.url.startsWith('/api/wp-bridge') ||
    request.url.startsWith('/api/portal') ||
    // Bot API authenticates via BOT_SECRET bearer (not a JWT with org context);
    // client portal authenticates via its own CLIENT-role JWT and scopes every
    // query by clientId. Both must bypass the org guard (which would 403 before
    // their own auth runs), same as the webhook/portal exemptions above.
    request.url.startsWith('/api/bot') ||
    request.url.startsWith('/api/client-portal') ||
    request.url.startsWith('/api/client-acquisition/config') ||
    request.url.startsWith('/api/client-acquisition/intake') ||
    // Public, capability-token-based client flows (no JWT / org context).
    // These are scoped by an unguessable viewToken/signToken in the URL, not
    // by tenant. Without these exemptions the tenancy guard 403s before the
    // token lookup runs, breaking client proposal/contract/estimate/invoice
    // review links and the Mailgun HITL + lead-intake webhooks.
    request.url.startsWith('/api/proposals/client') ||
    request.url.startsWith('/api/contracts/sign') ||
    request.url.startsWith('/api/estimates/view') ||
    request.url.startsWith('/api/invoices/client') ||
    request.url.startsWith('/api/invoices/stripe-webhook') ||
    request.url.startsWith('/api/mailgun') ||
    request.url.startsWith('/api/leads/leads/intake') ||
    request.url === '/api/health'
  ) {
    request.prisma = prisma; // Use global for auth/portal/health/public routes
    enterRequestContext({ prisma, organizationId: null });
    return;
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
  enterRequestContext({ prisma: scopedPrisma, organizationId });

  logger.debug({ organizationId }, '🛡️ Tenancy: Request scoped via Proxy');
}
