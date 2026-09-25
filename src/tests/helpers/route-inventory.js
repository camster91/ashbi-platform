/**
 * Route inventory shared by the API access matrix test and the OpenAPI
 * generator (#412).
 *
 * Builds the real application, records every route through an `onRoute` hook
 * attached as the Fastify instance is created, and describes each route's
 * effective request lifecycle (route options plus hooks inherited from its
 * plugin): the auth guards it carries, whether tenancy middleware scopes it,
 * and the Zod validators (`validateBody` / `validateQuery` / `validateParams`
 * in src/validators/schemas.js) or Fastify JSON schemas it declares.
 *
 * Guards are recognised by function identity against the root decorators
 * (`fastify.authenticate`, `fastify.adminOnly`, `fastify.authenticateWithApiKey`)
 * and by name for the two plugin-local guards (`clientAuth`, `requireBotAuth`).
 */
import diagnosticsChannel from 'node:diagnostics_channel';
import { isTenancyExemptUrl } from '../../middleware/tenancy.js';

const LIFECYCLE_HOOKS = ['onRequest', 'preParsing', 'preValidation', 'preHandler'];

/**
 * @typedef {object} RouteValidators
 * @property {any} [body] Zod schema checked by `validateBody`.
 * @property {any} [query] Zod schema checked by `validateQuery`.
 * @property {any} [params] Zod schema checked by `validateParams`.
 */

/**
 * @typedef {object} InventoryRoute
 * @property {string} method
 * @property {string} url
 * @property {string[]} guards Sorted guard names; empty for an unguarded route.
 * @property {'exempt' | 'scoped'} tenancy
 * @property {RouteValidators} zod
 * @property {Record<string, any>} jsonSchema Fastify `schema` route option (body, querystring, params), if any.
 */

/**
 * @param {string} a
 * @param {string} b
 */
export function compare(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Build the application and return every registered route, sorted by URL then
 * method. HEAD routes Fastify derives from GET, and the trailing-slash alias of
 * a prefix root, share the listed route's lifecycle and are omitted.
 *
 * @param {{ jwtSecret?: string }} [options]
 * @returns {Promise<InventoryRoute[]>}
 */
export async function collectRouteInventory({ jwtSecret = 'test-only-jwt-secret' } = {}) {
  /** @type {Array<{ url: string, methods: string[], opts: any, instance: any }>} */
  const recorded = [];
  const onInit = ({ fastify }) => {
    fastify.addHook('onRoute', function recordRoute(opts) {
      // Fastify reuses and mutates `opts` for a prefix root's trailing-slash
      // alias, so copy the URL and methods now.
      recorded.push({ url: opts.url, methods: [].concat(opts.method), opts, instance: this });
    });
  };
  diagnosticsChannel.subscribe('fastify.initialization', onInit);
  const { buildApp } = await import('../../index.js');
  let app;
  try {
    app = await buildApp({ initializeRuntime: false, jwtSecret });
  } finally {
    diagnosticsChannel.unsubscribe('fastify.initialization', onInit);
  }
  try {
    await app.ready();
    const kHooks = Object.getOwnPropertySymbols(app).find((symbol) => symbol.description === 'fastify.hooks');
    if (!kHooks) {
      throw new Error('Fastify internal hooks symbol not found; the route inventory needs updating for this Fastify version');
    }

    const identityGuards = new Map([
      [app.adminOnly, 'admin'],
      [app.authenticate, 'staff'],
      [app.authenticateWithApiKey, 'api-key'],
    ]);
    const namedGuards = new Map([
      ['clientAuth', 'client-portal'],
      ['requireBotAuth', 'bot-secret'],
      // Additional checks, not authentication by themselves (the access
      // matrix test requires a session or API-key guard alongside them).
      ['requireRecentAuth', 'recent-auth'],
      ['requireRecentAuthForAccessChange', 'recent-auth (access change)'],
    ]);

    /** @param {Function} fn */
    const classify = (fn) => {
      if (identityGuards.has(fn)) return identityGuards.get(fn);
      if (namedGuards.has(fn.name)) return namedGuards.get(fn.name);
      if (typeof (/** @type {any} */ (fn).apiKeyScope) === 'string') return `scope ${/** @type {any} */ (fn).apiKeyScope}`;
      const source = Function.prototype.toString.call(fn);
      if (/fastify\.adminOnly\(/.test(source)) return 'admin (inline)';
      if (/fastify\.authenticate\(/.test(source)) return 'staff (inline)';
      return null;
    };

    /** @type {InventoryRoute[]} */
    const routes = [];
    for (const { url, methods, opts, instance } of recorded) {
      const hooks = LIFECYCLE_HOOKS.flatMap((name) => [
        ...(instance[kHooks][name] ?? []),
        ...[].concat(opts[name] ?? []),
      ]);
      const guards = [...new Set(hooks.map(classify).filter(Boolean))].sort();
      /** @type {RouteValidators} */
      const zod = {};
      for (const hook of hooks) {
        if (!hook?.zodSchema || !hook.zodTarget) continue;
        if (zod[hook.zodTarget] && zod[hook.zodTarget] !== hook.zodSchema) {
          throw new Error(`${methods.join(',')} ${url} declares more than one ${hook.zodTarget} validator`);
        }
        zod[hook.zodTarget] = hook.zodSchema;
      }
      const jsonSchema = opts.schema && typeof opts.schema === 'object' ? opts.schema : {};
      for (const method of methods) {
        routes.push({ method, url, guards, tenancy: isTenancyExemptUrl(url) ? 'exempt' : 'scoped', zod, jsonSchema });
      }
    }

    // HEAD routes Fastify derives from GET routes share the GET lifecycle.
    // Compare without a trailing slash: the HEAD twin of a prefix root is
    // recorded under its trailing-slash alias.
    const bare = (url) => (url.length > 1 ? url.replace(/\/$/, '') : url);
    const getUrls = new Set(routes.filter((route) => route.method === 'GET').map((route) => bare(route.url)));
    const unique = new Map();
    for (const route of routes) {
      if (route.method === 'HEAD' && getUrls.has(bare(route.url))) continue;
      unique.set(`${route.method} ${route.url}`, route);
    }
    return [...unique.values()].sort((a, b) => (a.url === b.url
      ? compare(a.method, b.method)
      : compare(a.url, b.url)));
  } finally {
    await app.close();
  }
}
