// Prisma Client with Soft Delete + Autosave Interception
// Import: import prisma from '../config/db.js'

import { PrismaClient } from '@prisma/client';

const SOFT_DELETE_MODELS = new Set([
  'client',
  'project', 
  'invoice',
  'proposal',
  'contract',
  'expense',
  'task',
  'retainerPlan',
  'timeEntry',
  'estimate',
  'note',
]);

// Prisma 7: lazy proxy to defer PrismaClient construction
const globalForPrisma = /** @type {{ prisma?: PrismaClient }} */ (globalThis);
const buildBase = () => new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'info', 'warn', 'error']
    : ['warn', 'error'],
});
const base = new Proxy({}, {
  get(_target, prop) {
    const client = (globalForPrisma.prisma ??= buildBase());
    const value = /** @type {any} */ (client)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

function buildExtension() {
  const modelQueries = {};

  for (const model of SOFT_DELETE_MODELS) {
    modelQueries[model] = {
      findFirst: softDeleteFilter,
      findFirstOrThrow: softDeleteFilter,
      findUnique: softDeleteFilter,
      findUniqueOrThrow: softDeleteFilter,
      findMany: softDeleteFilter,
      count: softDeleteFilter,
      groupBy: softDeleteFilter,
      aggregate: softDeleteFilter,
      delete: softDeleteWrite,
      deleteMany: softDeleteWriteMany,
    };
  }

  return base.$extends({
    query: modelQueries,
  });
}

function isDeletedAtExplicit(args) {
  if (!args?.where) return false;
  // If deletedAt is explicitly in the where clause (any value), user is opting out
  return Object.prototype.hasOwnProperty.call(args.where, 'deletedAt');
}

function softDeleteFilter({ model, operation, args, query }) {
  if (isDeletedAtExplicit(args)) {
    return query(args);
  }
  if (args?.where) {
    args.where = { ...args.where, deletedAt: null };
  } else {
    args = { ...args, where: { deletedAt: null } };
  }
  // Enforce default pagination limit on findMany
  if (operation === 'findMany' && (!args.take || args.take > 100)) {
    args = { ...args, take: 100 };
  }
  return query(args);
}

async function softDeleteWrite({ model, operation, args, query }) {
  return base[model].update({
    where: args.where,
    data: { deletedAt: new Date() },
  });
}

async function softDeleteWriteMany({ model, operation, args, query }) {
  return base[model].updateMany({
    where: args.where,
    data: { deletedAt: new Date() },
  });
}

// Lazy prisma export - defer $extends until first use
const globalForExtended = /** @type {{ prisma?: ReturnType<typeof buildExtension> }} */ (globalThis);
export const prisma = new Proxy({}, {
  get(_target, prop) {
    const client = (globalForExtended.prisma ??= buildExtension());
    const value = /** @type {any} */ (client)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
// Also export base for admin ops that need to see deleted records
export { base as rawPrisma };
export default prisma;
