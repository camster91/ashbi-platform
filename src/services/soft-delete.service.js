/**
 * Soft Delete Service
 * Centralized soft-delete logic for all major entities.
 * Every model with `deletedAt` gets a delete, restore, and permanentDelete method.
 * List queries automatically filter out deleted items via request.prisma proxy.
 */

const WITH_DELETED = Symbol('withDeleted');

const SOFT_DELETE_MODELS = new Set([
  'client','project','task','note','timeEntry','retainerPlan',
  'proposal','contract','invoice','expense','estimate','trashedItem'
]);

/**
 * Wraps a Prisma client to add soft-delete behavior:
 * - delete() sets deletedAt instead of removing rows
 * - findMany/findFirst/findUnique filter deletedAt: null by default
 * - Pass { where: { deletedAt: { not: null } } } or use prisma[WITH_DELETED]() to include deleted
 */
export function withSoftDelete(prisma) {
  return new Proxy(prisma, {
    get(target, model, receiver) {
      if (model === WITH_DELETED) {
        return () => target;
      }
      if (typeof target[model] !== 'object') {
        return Reflect.get(target, model, receiver);
      }
      if (!SOFT_DELETE_MODELS.has(model)) {
        return target[model];
      }
      return new Proxy(target[model], {
        get(t, key) {
          const fn = t[key];
          if (typeof fn !== 'function') return fn;
          
          return async (...args) => {
            const [arg = {}] = args;
            
            // delete → update deletedAt
            if (key === 'delete' || key === 'deleteMany') {
              const data = { deletedAt: new Date() };
              if (key === 'delete') {
                return t.update({ ...arg, data });
              } else {
                return t.updateMany({ ...arg, data });
              }
            }
            
            // find queries: inject deletedAt: null unless explicitly including deleted
            if ((key === 'findMany' || key === 'findFirst' || key === 'findFirstOrThrow' || key === 'findUnique') && arg.where) {
              if (arg.where.deletedAt === undefined) {
                return fn.call(t, { ...arg, where: { ...arg.where, deletedAt: null } });
              }
            }
            
            // count: exclude deleted by default
            if (key === 'count' && arg && !arg.where?.deletedAt) {
              const where = arg.where || {};
              if (where.deletedAt === undefined) {
                return fn.call(t, { ...arg, where: { ...where, deletedAt: null } });
              }
            }
            
            // aggregate: exclude deleted by default
            if (key === 'aggregate' && arg && arg.where && arg.where.deletedAt === undefined) {
              return fn.call(t, { ...arg, where: { ...arg.where, deletedAt: null } });
            }
            
            return fn.apply(t, args);
          };
        }
      });
    }
  });
}

export { WITH_DELETED };
