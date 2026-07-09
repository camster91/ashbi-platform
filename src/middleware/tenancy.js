import logger from '../utils/logger.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import { enterRequestContext } from '../utils/request-context.js';
import prisma from '../config/db.js';

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
    request.url.startsWith('/api/client-acquisition/config') ||
    request.url.startsWith('/api/client-acquisition/intake') ||
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
