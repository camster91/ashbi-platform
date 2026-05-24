import logger from './logger.js';
import { withSoftDelete } from '../services/soft-delete.service.js';

/**
 * Enterprise Scoped Prisma Proxy with Soft Delete
 * 
 * Creates a proxy around the Prisma client that:
 * 1. Automatically injects organizationId into all queries (tenant isolation)
 * 2. Enforces soft-delete filtering (deletedAt: null on reads)
 * 3. Converts delete/deleteMany to updates (sets deletedAt)
 * 
 * This provides a Virtual Private Database feel and prevents
 * cross-tenant data leaks AND accidental permanent deletions.
 */
export function createScopedPrisma(prisma, organizationId) {
  if (!organizationId) {
    throw new Error('Tenancy Error: organizationId is required for scoped queries');
  }

  // Apply soft-delete wrapper first, then tenant scoping
  const softPrisma = withSoftDelete(prisma);

  // List of models that should be scoped to an organization
  const scopedModels = ['client', 'project', 'user', 'thread', 'task', 'invoice'];

  return new Proxy(softPrisma, {
    get(target, modelName) {
      if (modelName === Symbol.for('__proxy__')) return true;
      const model = target[modelName];
      
      // If not a scoped model or not a Prisma model, return as-is (still has soft-delete)
      if (!scopedModels.includes(modelName.toLowerCase()) || typeof model !== 'object') {
        return model;
      }

      return new Proxy(model, {
        get(modelTarget, methodName) {
          const method = modelTarget[methodName];
          
          if (typeof method !== 'function') return method;

          return async (...args) => {
            const queryArgs = args[0] || {};
            
            // Auto-inject organizationId into 'where' or 'data'
            if (['findMany', 'findUnique', 'findFirst', 'count', 'aggregate', 'groupBy'].includes(methodName)) {
              queryArgs.where = { ...queryArgs.where, organizationId };
            } else if (['create', 'createMany'].includes(methodName)) {
              if (Array.isArray(queryArgs.data)) {
                queryArgs.data = queryArgs.data.map(d => ({ ...d, organizationId }));
              } else {
                queryArgs.data = { ...queryArgs.data, organizationId };
              }
            } else if (['update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(methodName)) {
              queryArgs.where = { ...queryArgs.where, organizationId };
              if (queryArgs.data) {
                queryArgs.data = { ...queryArgs.data, organizationId };
              }
            }

            logger.debug({ modelName, methodName, organizationId }, 'Scoped Query Execution');
            return method.apply(modelTarget, [queryArgs, ...args.slice(1)]);
          };
        }
      });
    }
  });
}
