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
  const organizationId = request.user?.organizationId || request.headers['x-org-id'];

  if (!organizationId) {
    if (request.url.startsWith('/api/auth') || request.url.startsWith('/api/portal')) {
      request.prisma = prisma; // Use global for auth/portal
      return;
    }
    
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
