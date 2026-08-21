import test from 'node:test';
import assert from 'node:assert/strict';
import managedSiteRoutes, { canonicalManagedSiteUrl } from '../../routes/managed-sites.routes.js';

function routeHarness() {
  const routes = new Map();
  const fastify = {
    authenticate: async () => {},
    adminOnly: async () => {},
    get: (path, _options, handler) => routes.set(`GET ${path}`, handler),
    post: (path, _options, handler) => routes.set(`POST ${path}`, handler),
  };
  return { fastify, routes };
}

function reply() {
  return {
    code: 200,
    status(code) { this.code = code; return this; },
    send(payload) { return { statusCode: this.code, ...payload }; },
  };
}

test('managed-site canonical URL discards fragments, search strings, and trailing slashes', () => {
  assert.equal(canonicalManagedSiteUrl('https://example.com/path///?ignored=yes#section'), 'https://example.com/path');
});

test('managed-site import is idempotent and never overwrites existing inventory rows', async () => {
  const { fastify, routes } = routeHarness();
  await managedSiteRoutes(fastify);
  const created = [];
  const prisma = {
    managedSite: {
      findMany: async () => [{ url: 'https://existing.example/' }],
      create: async ({ data }) => {
        const record = { id: `site-${created.length + 1}`, ...data };
        created.push(record);
        return record;
      },
    },
    $transaction: async (callback) => callback({ managedSite: { create: prisma.managedSite.create } }),
  };

  const result = await routes.get('POST /import')({
    prisma,
    body: {
      sites: [
        { name: 'Existing', url: 'https://existing.example', platform: 'WORDPRESS', host: 'HOSTINGER', lifecycle: 'INVENTORIED' },
        { name: 'Shop', url: 'https://shop.example/', platform: 'SHOPIFY', host: 'SHOPIFY', lifecycle: 'ACTIVE' },
        { name: 'Shop duplicate', url: 'https://shop.example/#duplicate', platform: 'SHOPIFY', host: 'SHOPIFY', lifecycle: 'ACTIVE' },
      ],
    },
  }, reply());

  assert.equal(result.statusCode, 201);
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(created.map((site) => site.url), ['https://shop.example/']);
});
