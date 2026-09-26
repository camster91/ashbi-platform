// Per-request async context for tenant scoping.
//
// Why this exists:
//   - `src/utils/prisma-tenant-proxy.js` provides `createScopedPrisma(prisma,
//     organizationId)` which wraps the prisma client to auto-filter by orgId.
//   - The middleware `src/middleware/tenancy.js` calls `createScopedPrisma` and
//     attaches the scoped client to `request.prisma` for the current request.
//   - But 50+ service/agent files import `prisma` from `config/db.js` directly
//     or use `fastify.prisma`, BOTH of which are the unscoped raw client.
//     Wiring `request.prisma` into every call site is a 50+ file refactor.
//
// How this fixes it:
//   - We use AsyncLocalStorage to expose the per-request scoped prisma client
//     to any code that calls `getRequestPrisma()` — including the default
//     `db.js` export (which is now a Proxy that reads from this store) and
//     `fastify.prisma` (also a Proxy).
//   - `tenancy.js` calls `enterRequestContext({ prisma, organizationId })`
//     after computing the scoped client. `enterWith()` is the right primitive:
//     it sets the store for the current async chain WITHOUT requiring
//     `storage.run()` to wrap the entire handler (Fastify's hook chain and
//     handler are separate async operations, so `run()` would exit too early).
//   - For background jobs (no Fastify request), no context is set, so callers
//     see the raw prisma client. Jobs that need tenant scoping MUST filter
//     queries explicitly by organizationId.
//
// Verified pattern: see scripts/test-als-fastify.mjs.
import { AsyncLocalStorage } from 'node:async_hooks';
// Import the NAMED `prisma` export (the lazy soft-delete-extended proxy)
// rather than the default export (which is the outer request-context-aware
// Proxy). Importing the default would create a circular reference because
// db.js's default Proxy calls back into getRequestPrisma() on every property
// access — infinite recursion.
import { prisma as basePrisma } from '../config/db.js';

export const requestStorage = new AsyncLocalStorage();

/**
 * Set the per-request context for the current async chain. Called from
 * `src/middleware/tenancy.js` after the scoped prisma client is computed.
 *
 * Uses `enterWith` rather than `run` because Fastify's preHandler hooks and
 * the actual route handler run as separate async operations. `run` would
 * require the storage.run callback to remain alive for the duration of the
 * handler — which isn't expressible in a Fastify hook. `enterWith` simply
 * marks "from this point in the async chain, the store is X" and Node's
 * async_hooks propagate that to subsequent awaits.
 *
 * @param {{ prisma: any, organizationId: string | null, requestId?: string, feature?: string | null }} ctx
 */
export function enterRequestContext(ctx) {
  requestStorage.enterWith(ctx);
}

/**
 * Returns the per-request scoped prisma client, or the raw client if called
 * outside a request context (e.g. cron jobs).
 */
export function getRequestPrisma() {
  return requestStorage.getStore()?.prisma ?? basePrisma;
}

export function getRequestOrganizationId() {
  return requestStorage.getStore()?.organizationId;
}

/** The Fastify request id of the current request, when there is one. */
export function getRequestId() {
  return requestStorage.getStore()?.requestId ?? null;
}

/** A label for what is running: the route pattern, or a job's label. */
export function getRequestFeature() {
  return requestStorage.getStore()?.feature ?? null;
}
