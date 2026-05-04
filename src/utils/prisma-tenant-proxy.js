import logger from './logger.js';

/**
 * Enterprise Scoped Prisma Proxy
 * 
 * This utility creates a proxy around the Prisma client that 
 * automatically injects the tenant's organizationId into all queries.
 * This provides a "Virtual Private Database" feel and is the 
 * most robust way to prevent cross-tenant data leaks.
 */
export function createScopedPrisma(prisma, organizationId) {
  if (!organizationId) {
    throw new Error('Tenancy Error: organizationId is required for scoped queries');
  }

  // List of models that should be scoped to an organization
  // In a real enterprise app, this would be derived from the schema
  const scopedModels = ['client', 'project', 'user', 'thread', 'task', 'invoice'];

  return new Proxy(prisma, {
    get(target, modelName) {
      const model = target[modelName];
      
      // If not a scoped model or not a Prisma model, return as-is
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

            logger.debug({ modelName, methodName, organizationId }, '🛡️ Scoped Query Execution');
            return method.apply(modelTarget, [queryArgs, ...args.slice(1)]);
          };
        }
      });
    }
  });
}
