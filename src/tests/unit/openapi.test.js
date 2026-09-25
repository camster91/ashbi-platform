/**
 * OpenAPI contract (#412): docs/openapi.json is generated from the routes and
 * Zod validators by scripts/generate-openapi.mjs. These tests check the Zod
 * converter, that the committed file is current, and that the document covers
 * every route and is structurally sound. Regenerate with `npm run docs:openapi`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { describe } from 'node:test';
import { z } from 'zod';
import {
  EXCLUDED_ROUTES,
  OPENAPI_URL,
  generateOpenApiJson,
  operationIdOf,
  stableStringify,
  toOpenApiPath,
} from '../helpers/openapi.js';
import { collectRouteInventory } from '../helpers/route-inventory.js';
import { zodToJsonSchema } from '../helpers/zod-to-json-schema.js';

describe('zodToJsonSchema', () => {
  test('objects: required keys, strict, defaults and optional fields', () => {
    const schema = z.object({
      name: z.string().trim().min(1).max(100),
      email: z.string().email().max(255),
      site: z.string().url().optional(),
      id: z.string().uuid(),
      code: z.string().regex(/^[A-Z]+$/),
      when: z.string().datetime().nullable().optional(),
      active: z.boolean().optional().default(true),
    }).strict();
    assert.deepEqual(zodToJsonSchema(schema), {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        email: { type: 'string', format: 'email', maxLength: 255 },
        site: { type: 'string', format: 'uri' },
        id: { type: 'string', format: 'uuid' },
        code: { type: 'string', pattern: '^[A-Z]+$' },
        when: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
        active: { type: 'boolean', default: true },
      },
      required: ['name', 'email', 'id', 'code'],
      additionalProperties: false,
    });
  });

  test('numbers, enums, literals, arrays, records, unions and dates', () => {
    const Color = { Red: 'red', Blue: 'blue' };
    const Level = { Low: 0, High: 1, 0: 'Low', 1: 'High' }; // shape of a numeric TS enum
    assert.deepEqual(zodToJsonSchema(z.number().int().min(1).max(10)), { type: 'integer', minimum: 1, maximum: 10 });
    assert.deepEqual(zodToJsonSchema(z.number().positive()), { type: 'number', exclusiveMinimum: 0 });
    assert.deepEqual(zodToJsonSchema(z.number().nonnegative()), { type: 'number', minimum: 0 });
    assert.deepEqual(zodToJsonSchema(z.coerce.number().int().min(1).max(50).default(5)), {
      type: 'integer', minimum: 1, maximum: 50, default: 5,
    });
    assert.deepEqual(zodToJsonSchema(z.enum(['A', 'B'])), { type: 'string', enum: ['A', 'B'] });
    assert.deepEqual(zodToJsonSchema(z.nativeEnum(Color)), { type: 'string', enum: ['red', 'blue'] });
    assert.deepEqual(zodToJsonSchema(z.nativeEnum(Level)), { type: 'integer', enum: [0, 1] });
    assert.deepEqual(zodToJsonSchema(z.literal(true)), { type: 'boolean', const: true });
    assert.deepEqual(zodToJsonSchema(z.array(z.string()).min(1).max(3)), {
      type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3,
    });
    assert.deepEqual(zodToJsonSchema(z.record(z.string(), z.any())), { type: 'object', additionalProperties: {} });
    assert.deepEqual(zodToJsonSchema(z.union([z.string(), z.number()])), { anyOf: [{ type: 'string' }, { type: 'number' }] });
    assert.deepEqual(zodToJsonSchema(z.unknown()), {});
    assert.deepEqual(zodToJsonSchema(z.date()), { type: 'string', format: 'date-time' });
  });

  test('effects describe their input schema', () => {
    const refined = z.object({ a: z.string().optional() }).refine((value) => Object.keys(value).length > 0);
    assert.deepEqual(zodToJsonSchema(refined), { type: 'object', properties: { a: { type: 'string' } } });
    const preprocessed = z.preprocess((value) => (value === 'CHECK' ? 'CHEQUE' : value), z.enum(['CHEQUE']));
    assert.deepEqual(zodToJsonSchema(preprocessed), { type: 'string', enum: ['CHEQUE'] });
    assert.deepEqual(zodToJsonSchema(z.string().transform((value) => value.length)), { type: 'string' });
    const superRefined = z.object({ b: z.number() }).superRefine(() => {});
    assert.deepEqual(zodToJsonSchema(superRefined), { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] });
  });

  test('throws on types and checks it cannot describe', () => {
    assert.throws(() => zodToJsonSchema(z.set(z.string())), /unsupported Zod type ZodSet/);
    assert.throws(() => zodToJsonSchema(z.object({ fn: z.function() })), /unsupported Zod type ZodFunction/);
    assert.throws(() => zodToJsonSchema(z.string().ip()), /unsupported string check "ip"/);
    assert.throws(() => zodToJsonSchema(z.string().regex(/a/i)), /unsupported regex flags/);
    assert.throws(() => zodToJsonSchema({}), /not a Zod v3 schema/);
  });
});

test('path helpers', () => {
  assert.equal(toOpenApiPath('/api/projects/:projectId/tasks/:id'), '/api/projects/{projectId}/tasks/{id}');
  assert.equal(operationIdOf('GET', '/api/projects/{id}'), 'get_api_projects_id');
  assert.equal(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] }), '{\n  "a": [\n    {\n      "c": 2,\n      "d": 1\n    }\n  ],\n  "b": 1\n}\n');
});

let inventoryPromise;
function getInventory() {
  inventoryPromise ??= collectRouteInventory();
  return inventoryPromise;
}

let specTextPromise;
function getSpecText() {
  specTextPromise ??= getInventory().then((routes) => generateOpenApiJson({ routes }));
  return specTextPromise;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** @param {any} spec */
function operationsOf(spec) {
  return Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item)
    .filter(([method]) => HTTP_METHODS.includes(method))
    .map(([method, operation]) => ({ path, method, operation })));
}

test('docs/openapi.json matches the application', async () => {
  const actual = await getSpecText();
  const expected = fs.existsSync(OPENAPI_URL) ? fs.readFileSync(OPENAPI_URL, 'utf8') : '';
  assert.ok(actual === expected, 'docs/openapi.json is stale; run npm run docs:openapi');
});

test('every route in the committed route table is in the spec', async () => {
  const spec = JSON.parse(await getSpecText());
  // printRoutes merges parameter names (`:id|:projectId`) and roots `*` at `/`.
  const bare = (url) => {
    const normalized = url.replace(/:[\w|:]+/g, ':').replace(/\{[^}]+\}/g, ':').replace(/^\/?\*$/, '*');
    return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
  };
  const covered = new Set(operationsOf(spec).map(({ path, method }) => `${method.toUpperCase()} ${bare(path)}`));
  const excluded = new Set(Object.keys(EXCLUDED_ROUTES).map((key) => {
    const [method, url] = key.split(' ');
    return `${method} ${bare(url)}`;
  }));
  const table = JSON.parse(fs.readFileSync(new URL('../fixtures/route-table.json', import.meta.url), 'utf8'));
  const missing = table
    .map((entry) => entry.split(' '))
    .filter(([method]) => method !== 'HEAD')
    .map(([method, url]) => `${method} ${bare(url)}`)
    .filter((key) => !covered.has(key) && !excluded.has(key));
  assert.deepEqual(missing, []);
});

test('every excluded route still exists', async () => {
  const keys = new Set((await getInventory()).map((route) => `${route.method} ${route.url}`));
  assert.deepEqual(Object.keys(EXCLUDED_ROUTES).filter((key) => !keys.has(key)), []);
});

test('every operation with a body validator has a requestBody', async () => {
  const spec = JSON.parse(await getSpecText());
  const routes = await getInventory();
  const withBody = routes.filter((route) => route.zod.body || route.jsonSchema.body);
  assert.ok(withBody.length > 100, `expected many validated bodies, found ${withBody.length}`);
  const missing = withBody
    .filter((route) => !spec.paths[toOpenApiPath(route.url)]?.[route.method.toLowerCase()]?.requestBody)
    .map((route) => `${route.method} ${route.url}`);
  assert.deepEqual(missing, []);
});

test('the spec is structurally valid OpenAPI 3.1', async () => {
  const spec = JSON.parse(await getSpecText());
  const pkg = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.title, 'Ashbi Hub API');
  assert.equal(spec.info.version, pkg.version);
  assert.deepEqual(spec.servers, [{ url: '/' }]);
  assert.ok(Object.keys(spec.paths).length > 0);

  const schemes = new Set(Object.keys(spec.components.securitySchemes));
  const tags = new Set(spec.tags.map((tag) => tag.name));
  const seenIds = new Set();
  const problems = [];
  for (const { path, method, operation } of operationsOf(spec)) {
    const where = `${method.toUpperCase()} ${path}`;
    if (!path.startsWith('/')) problems.push(`${where}: path must start with /`);
    if (/:[A-Za-z]/.test(path)) problems.push(`${where}: Fastify-style parameter left in path`);
    if (!operation.operationId) problems.push(`${where}: no operationId`);
    if (seenIds.has(operation.operationId)) problems.push(`${where}: duplicate operationId ${operation.operationId}`);
    seenIds.add(operation.operationId);
    if (!operation.responses || Object.keys(operation.responses).length === 0) problems.push(`${where}: no responses`);
    for (const tag of operation.tags ?? []) if (!tags.has(tag)) problems.push(`${where}: undeclared tag ${tag}`);
    if (!['scoped', 'exempt'].includes(operation['x-tenancy'])) problems.push(`${where}: bad x-tenancy`);
    if (!operation['x-access']) problems.push(`${where}: no x-access`);
    if ((operation['x-access'] === 'public') !== (operation.security.length === 0)) {
      problems.push(`${where}: security does not match x-access ${operation['x-access']}`);
    }
    for (const requirement of operation.security) {
      for (const name of Object.keys(requirement)) if (!schemes.has(name)) problems.push(`${where}: unknown security scheme ${name}`);
    }

    const templated = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    const parameters = operation.parameters ?? [];
    const declared = parameters.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name).sort();
    if (JSON.stringify(templated) !== JSON.stringify(declared)) problems.push(`${where}: path parameters ${declared} != ${templated}`);
    for (const parameter of parameters) {
      if (parameter.in === 'path' && parameter.required !== true) problems.push(`${where}: path parameter ${parameter.name} not required`);
      if (!parameter.schema) problems.push(`${where}: parameter ${parameter.name} has no schema`);
    }
    const unique = new Set(parameters.map((parameter) => `${parameter.in}:${parameter.name}`));
    if (unique.size !== parameters.length) problems.push(`${where}: duplicate parameters`);
  }
  assert.deepEqual(problems, []);

  // Every $ref resolves inside the document.
  const unresolved = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') {
      const target = node.$ref.replace(/^#\//, '').split('/').reduce((value, key) => value?.[key], spec);
      if (!node.$ref.startsWith('#/') || target === undefined) unresolved.push(node.$ref);
    }
    Object.values(node).forEach(visit);
  };
  visit(spec);
  assert.deepEqual(unresolved, []);
});

test('security and extensions follow the access matrix guards', async () => {
  const spec = JSON.parse(await getSpecText());
  const op = (method, path) => spec.paths[path][method];
  assert.deepEqual(op('get', '/api/auth/me').security, [{ cookieAuth: [] }, { bearerAuth: [] }]);
  assert.equal(op('get', '/api/auth/me')['x-tenancy'], 'exempt');
  assert.equal(op('get', '/api/audit-events')['x-access'], 'admin');
  assert.deepEqual(op('get', '/api/ai-bridge/capabilities').security, [{ apiKey: [] }, { apiKeyBearer: [] }]);
  assert.deepEqual(op('post', '/api/auth/login').security, []);
  assert.equal(op('post', '/api/auth/login')['x-access'], 'public');
  assert.ok(op('post', '/api/auth/login').requestBody, 'login body schema not recovered');
  assert.ok(operationsOf(spec).some(({ operation }) => operation.security.some((entry) => 'botBearer' in entry)));
  assert.ok(operationsOf(spec).some(({ operation }) => operation.security.some((entry) => 'clientPortalCookie' in entry)));
  const errorSchema = spec.components.schemas.Error;
  assert.deepEqual(errorSchema.required, ['error']);
  assert.equal(errorSchema.properties.code.type, 'string');
  assert.deepEqual(Object.keys(spec.components.responses).sort(), [
    'BadRequest', 'Conflict', 'Forbidden', 'InternalError', 'NotFound', 'TooManyRequests', 'Unauthorized',
  ]);
  for (const response of Object.values(spec.components.responses)) {
    assert.equal(response.content['application/json'].schema.$ref, '#/components/schemas/Error');
  }
});

test('a validated body is required unless its schema accepts no body at all', async () => {
  const spec = JSON.parse(await getSpecText());
  // Every field optional, but validateBody still rejects a missing body.
  assert.equal(spec.paths['/api/auth/me'].put.requestBody.required, true);
});

test('the error schema covers the AI bridge object form', async () => {
  const spec = JSON.parse(await getSpecText());
  const shapes = spec.components.schemas.Error.properties.error.oneOf.map((shape) => shape.type).sort();
  assert.deepEqual(shapes, ['object', 'string']);
});

test('the web client never calls a body-required route without a body', async () => {
  const spec = JSON.parse(await getSpecText());
  const client = fs.readFileSync(new URL('../../../web/src/lib/api.js', import.meta.url), 'utf8');
  const required = operationsOf(spec)
    .filter(({ operation }) => operation.requestBody?.required)
    .map(({ path, method }) => ({ method: method.toUpperCase(), path, match: new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`) }));
  const bodiless = /request\(\s*`([^`]+)`\s*,\s*\{\s*method:\s*'(POST|PUT|PATCH|DELETE)'\s*\}\s*\)/g;
  const offending = [];
  for (const [, template, method] of client.matchAll(bodiless)) {
    const url = `/api${template.replace(/\$\{[^}]+\}/g, 'x').split('?')[0]}`;
    for (const operation of required) {
      if (operation.method === method && operation.match.test(url)) offending.push(`${method} ${template} -> ${operation.path}`);
    }
  }
  assert.deepEqual(offending, [], 'these calls send no body, so the route\'s body validator answers 400');
});
