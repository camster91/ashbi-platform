/**
 * Build the OpenAPI 3.1 contract (docs/openapi.json) from the route inventory
 * (#412). Used by scripts/generate-openapi.mjs and src/tests/unit/openapi.test.js.
 *
 * Everything in the document is derived from code: paths and methods from the
 * registered Fastify routes, security from the auth guard in each route's
 * lifecycle, request bodies / query / path parameters from the Zod validators
 * attached with validateBody / validateQuery / validateParams (or a Fastify
 * JSON `schema` route option). Response bodies are not described yet; every
 * operation documents a generic 2XX plus the shared error contract.
 */
import fs from 'node:fs';
import * as validatorExports from '../../validators/schemas.js';
import { collectRouteInventory, compare } from './route-inventory.js';
import { zodToJsonSchema } from './zod-to-json-schema.js';

export const OPENAPI_URL = new URL('../../../docs/openapi.json', import.meta.url);

/**
 * Routes that cannot be expressed as OpenAPI paths. They stay in the access
 * matrix; the OpenAPI test checks this list against the route table.
 */
export const EXCLUDED_ROUTES = {
  'OPTIONS *': 'CORS preflight handled by @fastify/cors; `*` is not an OpenAPI path.',
};

const JWT_GUARDS = new Set(['admin', 'staff', 'admin (inline)', 'staff (inline)']);

/** @type {Record<string, Array<Record<string, string[]>>>} */
const SECURITY_BY_GUARD = {
  admin: [{ cookieAuth: [] }, { bearerAuth: [] }],
  staff: [{ cookieAuth: [] }, { bearerAuth: [] }],
  'admin (inline)': [{ cookieAuth: [] }, { bearerAuth: [] }],
  'staff (inline)': [{ cookieAuth: [] }, { bearerAuth: [] }],
  'api-key': [{ apiKey: [] }, { apiKeyBearer: [] }],
  'client-portal': [{ clientPortalCookie: [] }, { bearerAuth: [] }],
  'bot-secret': [{ botBearer: [] }],
};

const SECURITY_SCHEMES = {
  cookieAuth: {
    type: 'apiKey',
    in: 'cookie',
    name: 'token',
    description: 'Staff session: the httpOnly `token` cookie holding a JWT issued by POST /api/auth/login '
      + '(or /api/auth/login/mfa). The same JWT is also accepted as `Authorization: Bearer <jwt>` (bearerAuth). '
      + 'The session must be current (not revoked); `admin` routes additionally require role ADMIN.',
  },
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'The session JWT (staff or client portal) sent as a bearer token instead of the `token` cookie.',
  },
  apiKey: {
    type: 'apiKey',
    in: 'header',
    name: 'x-api-key',
    description: 'User API key (prefix `ashbi_`) created under /api/api-keys; stored hashed. Also accepted as '
      + '`Authorization: Bearer ashbi_...` (apiKeyBearer).',
  },
  apiKeyBearer: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'ashbi_ API key',
    description: 'The `ashbi_` API key sent as a bearer token instead of the `x-api-key` header.',
  },
  botBearer: {
    type: 'http',
    scheme: 'bearer',
    description: 'Shared bot secret (`Authorization: Bearer <BOT_SECRET>`). Fails closed (503) when no bot tenant is configured.',
  },
  clientPortalCookie: {
    type: 'apiKey',
    in: 'cookie',
    name: 'token',
    description: 'Client portal session: the `token` cookie set by POST /api/client-portal/verify-token or '
      + 'POST /api/auth/client/login. Also accepted as `Authorization: Bearer <jwt>` (bearerAuth).',
  },
};

const ERROR_RESPONSES = {
  400: ['BadRequest', 'The request body, query or path parameters failed validation, or the JSON was malformed.'],
  401: ['Unauthorized', 'No valid credential for this route, or the session was revoked.'],
  403: ['Forbidden', 'Authenticated but not allowed (for example not an admin, a client session on a staff API, or no organization context).'],
  404: ['NotFound', 'The addressed resource does not exist in the caller\'s organization.'],
  409: ['Conflict', 'The request conflicts with the current state of the resource.'],
  429: ['TooManyRequests', 'Rate limit exceeded.'],
  500: ['InternalError', 'Unexpected server error. The message is generic; use traceId when reporting it.'],
};

const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string', description: 'Human-readable message, or an error name for errors raised by the framework.' },
    code: { type: 'string', description: 'Stable machine-readable code, when the route defines one.' },
    message: { type: 'string', description: 'Additional detail sent by the global error handler.' },
    statusCode: { type: 'integer', description: 'HTTP status, sent by the global error handler.' },
    traceId: { type: 'string', description: 'Request id for support, sent by the global error handler.' },
  },
  additionalProperties: true,
};

/** @param {string} url */
export function tagOf(url) {
  const match = /^\/api\/([^/]+)/.exec(url);
  return match ? match[1] : 'root';
}

/** @param {string} url */
export function toOpenApiPath(url) {
  return url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * @param {string} method
 * @param {string} path
 */
export function operationIdOf(method, path) {
  const slug = path.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${method.toLowerCase()}_${slug || 'root'}`;
}

/**
 * Convert a params/query validator (Zod or Fastify JSON schema) into an
 * object JSON schema with `properties` and `required`.
 *
 * @param {any} zodSchema
 * @param {any} jsonSchema
 * @returns {{ properties: Record<string, any>, required: string[] } | null}
 */
function objectSchemaOf(zodSchema, jsonSchema) {
  const converted = zodSchema ? zodToJsonSchema(zodSchema) : jsonSchema;
  if (!converted) return null;
  if (converted.type !== 'object' || !converted.properties) {
    throw new Error('query and path parameter validators must be object schemas');
  }
  return { properties: converted.properties, required: converted.required ?? [] };
}

/**
 * @param {import('./route-inventory.js').InventoryRoute} route
 * @param {string} path
 */
function parametersOf(route, path) {
  const parameters = [];
  const params = objectSchemaOf(route.zod.params, route.jsonSchema.params);
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  for (const name of names) {
    parameters.push({ name, in: 'path', required: true, schema: params?.properties[name] ?? { type: 'string' } });
  }
  const query = objectSchemaOf(route.zod.query, route.jsonSchema.querystring);
  if (query) {
    for (const [name, schema] of Object.entries(query.properties)) {
      const parameter = { name, in: 'query', required: query.required.includes(name), schema };
      parameters.push(parameter);
    }
  }
  return parameters;
}

/**
 * @param {import('./route-inventory.js').InventoryRoute} route
 * @param {(zodSchema: any) => Record<string, any>} describe
 */
function requestBodyOf(route, describe) {
  if (route.zod.body) {
    return {
      required: !route.zod.body.safeParse({}).success,
      content: { 'application/json': { schema: describe(route.zod.body) } },
    };
  }
  if (route.jsonSchema.body) {
    return { required: true, content: { 'application/json': { schema: route.jsonSchema.body } } };
  }
  return null;
}

/**
 * Map each exported Zod schema of a module to a component name
 * (`createProjectSchema` -> `CreateProject`).
 *
 * @param {Record<string, any>} moduleExports
 * @returns {Map<any, string>}
 */
export function schemaNamesFromExports(moduleExports) {
  const names = new Map();
  for (const exportName of Object.keys(moduleExports).sort(compare)) {
    const value = moduleExports[exportName];
    if (!value?._def?.typeName || names.has(value)) continue;
    const base = exportName.replace(/Schema$/, '');
    names.set(value, base.charAt(0).toUpperCase() + base.slice(1));
  }
  return names;
}

/**
 * @param {import('./route-inventory.js').InventoryRoute[]} routes
 * @param {{ version: string, schemaNames?: Map<any, string> }} options
 *   `schemaNames` names shared request-body schemas; they are emitted once
 *   under components.schemas and referenced. Other schemas are inlined.
 */
export function buildOpenApiSpec(routes, { version, schemaNames = new Map() }) {
  /** @type {Record<string, Record<string, any>>} */
  const paths = {};
  /** @type {Record<string, any>} */
  const schemas = { Error: ERROR_SCHEMA };
  const describe = (zodSchema) => {
    const name = schemaNames.get(zodSchema);
    if (!name) return zodToJsonSchema(zodSchema);
    if (name === 'Error') throw new Error('A request schema cannot be named Error');
    schemas[name] ??= zodToJsonSchema(zodSchema);
    return { $ref: `#/components/schemas/${name}` };
  };
  const operationIds = new Map();
  const tags = new Set();

  for (const route of routes) {
    const key = `${route.method} ${route.url}`;
    if (Object.hasOwn(EXCLUDED_ROUTES, key)) continue;
    if (!route.url.startsWith('/')) throw new Error(`${key} is not an OpenAPI path; add it to EXCLUDED_ROUTES with a reason`);
    const path = toOpenApiPath(route.url);
    const method = route.method.toLowerCase();
    const operationId = operationIdOf(route.method, path);
    if (operationIds.has(operationId)) {
      throw new Error(`operationId ${operationId} is shared by ${operationIds.get(operationId)} and ${key}`);
    }
    operationIds.set(operationId, key);
    const tag = tagOf(route.url);
    tags.add(tag);

    const access = route.guards.length ? route.guards.join(' + ') : 'public';
    const security = [];
    // Step-up and API-key scope checks add a requirement on top of the
    // session or key; they are extensions, not alternative security schemes.
    const recentAuth = route.guards.some((guard) => guard.startsWith('recent-auth'));
    const apiKeyScopes = route.guards.filter((guard) => guard.startsWith('scope ')).map((guard) => guard.slice(6));
    for (const guard of route.guards) {
      if (guard.startsWith('recent-auth') || guard.startsWith('scope ')) continue;
      const requirements = SECURITY_BY_GUARD[guard];
      if (!requirements) throw new Error(`${key}: no security scheme mapped for guard "${guard}"`);
      for (const requirement of requirements) {
        if (!security.some((entry) => Object.keys(entry)[0] === Object.keys(requirement)[0])) security.push(requirement);
      }
    }

    /** @type {Record<string, any>} */
    const operation = {
      operationId,
      summary: `${route.method} ${route.url}`,
      tags: [tag],
      security,
      'x-access': access,
      'x-tenancy': route.tenancy,
    };
    if (recentAuth) operation['x-requires-recent-auth'] = true;
    if (apiKeyScopes.length) operation['x-api-key-scopes'] = apiKeyScopes;
    const parameters = parametersOf(route, path);
    if (parameters.length) operation.parameters = parameters;
    const requestBody = requestBodyOf(route, describe);
    if (requestBody) operation.requestBody = requestBody;

    const errorCodes = new Set([429, 500]);
    if (requestBody || parameters.length) errorCodes.add(400);
    if (route.guards.length) {
      errorCodes.add(401);
      if (route.guards.some((guard) => JWT_GUARDS.has(guard)) || route.tenancy === 'scoped' || recentAuth || apiKeyScopes.length) errorCodes.add(403);
    }
    if (path.includes('{')) errorCodes.add(404);
    /** @type {Record<string, any>} */
    const responses = { '2XX': { description: 'Success. Response bodies are not yet described by this contract.' } };
    for (const code of [...errorCodes].sort((a, b) => a - b)) {
      responses[String(code)] = { $ref: `#/components/responses/${ERROR_RESPONSES[code][0]}` };
    }
    operation.responses = responses;

    paths[path] ??= {};
    paths[path][method] = operation;
  }

  const responses = {};
  for (const [name, description] of Object.values(ERROR_RESPONSES)) {
    responses[name] = {
      description,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Ashbi Hub API',
      version,
      description: 'GENERATED FILE: do not edit by hand. Generated from the Fastify routes and Zod validators by '
        + 'scripts/generate-openapi.mjs (`npm run docs:openapi`); `npm run check:openapi` fails when it is stale. '
        + 'See docs/api-contract.md.',
    },
    servers: [{ url: '/' }],
    tags: [...tags].sort(compare).map((name) => ({ name })),
    paths,
    components: {
      schemas,
      responses,
      securitySchemes: SECURITY_SCHEMES,
    },
  };
}

/**
 * JSON.stringify with object keys sorted recursively (arrays keep their order),
 * two-space indent and a trailing newline.
 *
 * @param {any} value
 * @returns {string}
 */
export function stableStringify(value) {
  const sort = (input) => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.keys(input).sort(compare).map((key) => [key, sort(input[key])]));
    }
    return input;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/**
 * Build the application and render docs/openapi.json exactly as committed.
 * The version comes from package.json; request schemas exported from
 * src/validators/schemas.js become named components.
 *
 * @param {{ routes?: import('./route-inventory.js').InventoryRoute[] }} [options]
 *   Pass an already collected inventory to avoid building the app again.
 * @returns {Promise<string>}
 */
export async function generateOpenApiJson({ routes } = {}) {
  const { version } = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  routes ??= await collectRouteInventory();
  const schemaNames = schemaNamesFromExports(validatorExports);
  return stableStringify(buildOpenApiSpec(routes, { version, schemaNames }));
}
