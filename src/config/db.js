// Prisma Client with Soft Delete + Autosave Interception
// Import: import prisma from '../config/db.js'

// @prisma/client is a CommonJS module (no "type": "module" in its package.json),
// so Node's ESM loader can't statically resolve `import { PrismaClient }` from it
// — it throws "Named export 'PrismaClient' not found". Default-import the package
// and destructure on the runtime side. Prisma 7's ESM story is still settling;
// this is the canonical workaround until they publish an ESM build.
import prismaPkg from '@prisma/client';
const { PrismaClient } = prismaPkg;

// Prisma 7 removed the implicit `datasource db { url }` config that the old
// PrismaClient would pick up automatically. Now the client requires either
// a driver adapter (`adapter:`) or `accelerateUrl` in its options — passing
// only `log:` throws "PrismaClient needs non-empty, valid PrismaClientOptions".
// Use the official pg driver adapter and pass DATABASE_URL through it.
import { PrismaPg } from '@prisma/adapter-pg';

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
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
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

// SECURITY: Wrap the default export in an outer Proxy that resolves to the
// per-request scoped prisma (set by `src/middleware/tenancy.js` via
// AsyncLocalStorage) when called from a route handler, and to the lazy
// soft-delete prisma otherwise.
//
// This closes the C1/C2 audit findings: 50+ service/agent files import
// `prisma from '../config/db.js'` directly. Previously every one of them
// bypassed tenancy and could read cross-tenant data. With this wrapper, the
// import is unchanged but the resolved client is automatically scoped.
//
// Background jobs (no Fastify request) see the lazy soft-delete prisma, so
// they must continue to filter queries explicitly by organizationId.
import { getRequestPrisma } from '../utils/request-context.js';
export default new Proxy({}, {
  get(_target, prop) {
    // Resolve to the per-request scoped client if we are inside a request,
    // otherwise fall back to the soft-delete-extended lazy prisma.
    const client = getRequestPrisma() ?? prisma;
    const value = /** @type {any} */ (client)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});