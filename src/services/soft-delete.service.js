/** Single source of truth for application soft deletion. */
export const SOFT_DELETE_MODELS = Object.freeze([
  'client', 'project', 'task', 'note', 'milestone', 'timeEntry', 'retainerPlan',
  'proposal', 'contract', 'invoice', 'expense', 'estimate',
]);
const SOFT_DELETE_MODEL_SET = new Set(SOFT_DELETE_MODELS);

export const WITH_DELETED = Symbol('withDeleted');
const SOFT_DELETE_WRAPPED = Symbol('softDeleteWrapped');
const READ_OPERATIONS = new Set([
  'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'findMany', 'count', 'aggregate', 'groupBy',
]);

function hasExplicitDeletedAt(args) {
  return Object.prototype.hasOwnProperty.call(args?.where ?? {}, 'deletedAt')
    && args.where.deletedAt !== undefined;
}

function activeRecordArgs(args = {}, operation) {
  if (hasExplicitDeletedAt(args)) return args;
  const scoped = { ...args, where: { ...(args.where ?? {}), deletedAt: null } };
  if (operation === 'findMany' && (!Number.isFinite(scoped.take) || scoped.take > 100)) {
    scoped.take = 100;
  }
  return scoped;
}

/**
 * Adds consistent read/delete semantics to any Prisma-like client. Applying
 * this wrapper more than once is idempotent. Explicit `where.deletedAt` and
 * WITH_DELETED are reviewed escape hatches for restore and purge paths.
 */
export function withSoftDelete(prisma) {
  if (prisma?.[SOFT_DELETE_WRAPPED]) return prisma;

  return new Proxy(prisma, {
    get(target, model, receiver) {
      if (model === SOFT_DELETE_WRAPPED) return true;
      if (model === WITH_DELETED) return () => target;
      if (model === '$transaction') {
        return (input, ...options) => {
          if (typeof input !== 'function') return target.$transaction(input, ...options);
          return target.$transaction((transaction) => input(withSoftDelete(transaction)), ...options);
        };
      }

      const delegate = Reflect.get(target, model, receiver);
      if (!SOFT_DELETE_MODEL_SET.has(model) || typeof delegate !== 'object' || delegate === null) {
        return typeof delegate === 'function' ? delegate.bind(target) : delegate;
      }

      return new Proxy(delegate, {
        get(modelTarget, operation) {
          const method = modelTarget[operation];
          if (typeof method !== 'function') return method;
          if (operation === 'delete') {
            return (args = {}) => modelTarget.update({ ...args, data: { deletedAt: new Date() } });
          }
          if (operation === 'deleteMany') {
            return (args = {}) => modelTarget.updateMany({ ...args, data: { deletedAt: new Date() } });
          }
          if (READ_OPERATIONS.has(operation)) {
            return (args = {}) => method.call(modelTarget, activeRecordArgs(args, operation));
          }
          return method.bind(modelTarget);
        },
      });
    },
  });
}
