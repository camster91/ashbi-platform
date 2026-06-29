import logger from '../utils/logger.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import prisma from '../config/db.js';

/**
 * Enterprise Multi-Tenancy Middleware
 * 
 * Ensures that every request is scoped to a specific organization.
 * It injects a scoped prisma client into the request.
 */
export async function tenancyMiddleware(request, reply) {
  // Only enforce tenancy on API routes
  if (!request.url.startsWith('/api/')) {
    request.prisma = prisma;
    return;
  }

  // Exempt Auth, Health, and Public Portal from strict isolation
  if (
    request.url.startsWith('/api/auth') || 
    request.url.startsWith('/api/wp-bridge') ||
    request.url.startsWith('/api/portal') ||
    request.url.startsWith('/api/client-acquisition/config') ||
    request.url.startsWith('/api/client-acquisition/intake') ||
    request.url === '/api/health'
  ) {
    request.prisma = prisma; // Use global for auth/portal/health/public routes
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
  request.prisma = createScopedPrisma(prisma, organizationId);
  request.organizationId = organizationId;
  
  logger.debug({ organizationId }, '🛡️ Tenancy: Request scoped via Proxy');
}
