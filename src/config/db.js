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
import { withSoftDelete } from '../services/soft-delete.service.js';

// Prisma 7: lazy proxy to defer PrismaClient construction
const globalForPrisma = /** @type {{ ashbiRawPrisma?: PrismaClient }} */ (globalThis);
const buildBase = () => new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'info', 'warn', 'error']
    : ['warn', 'error'],
});
const base = new Proxy({}, {
  get(_target, prop) {
    const client = (globalForPrisma.ashbiRawPrisma ??= buildBase());
    const value = /** @type {any} */ (client)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

// The policy proxy is cheap to create and delegates to the lazy raw client.
// Keep it module-local so it can never replace its own underlying global cache.
const softDeletePrisma = withSoftDelete(base);
export const prisma = new Proxy({}, {
  get(_target, prop) {
    const value = /** @type {any} */ (softDeletePrisma)[prop];
    return typeof value === 'function' ? value.bind(softDeletePrisma) : value;
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
