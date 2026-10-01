// The API key guard runs as a route's onRequest hook, before the tenancy
// middleware (a global preHandler) sets `request.prisma`. It must read the key
// with the raw client it was built with, and only establish the identity: the
// key owner's organization (for the tenancy middleware) and the key's scopes
// (for requireApiKeyScope).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';
const { createApiKeyAuthenticator } = await import('../../routes/api-key.routes.js');
const { requireApiKeyScope } = await import('../../auth/api-key-scopes.js');

const RAW_KEY = `ashbi_${'a'.repeat(64)}`;
const OWNER = { id: 'user-1', email: 'owner@agency.test', name: 'Owner', role: 'ADMIN', organizationId: 'org-1', clientId: null, isActive: true };

function keyStore(overrides = {}) {
  const store = { lookups: [], touched: [] };
  store.prisma = {
    apiKey: {
      findUnique: async ({ where }) => {
        store.lookups.push(where);
        if (where.key !== createHash('sha256').update(RAW_KEY).digest('hex')) return null;
        return { id: 'key-1', isActive: true, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), scopes: ['ai_bridge:read'], user: OWNER, ...overrides };
      },
      update: async ({ where }) => { store.touched.push(where.id); return {}; },
    },
  };
  return store;
}

async function buildApp(t, store) {
  const app = Fastify({ logger: false });
  const seen = {};
  // As in src/index.js: request.prisma is only set by a later preHandler.
  app.addHook('preHandler', async (request) => {
    seen.organizationId = request.user?.organizationId;
    request.prisma = { scopedFor: request.user?.organizationId };
  });
  app.decorate('authenticateWithApiKey', createApiKeyAuthenticator({ prisma: store.prisma }));
  app.get('/read', { onRequest: [app.authenticateWithApiKey], preHandler: [requireApiKeyScope('ai_bridge:read')] }, async (request) => ({
    user: request.user, scopes: request.apiKeyScopes, prisma: request.prisma,
  }));
  app.get('/actions', { onRequest: [app.authenticateWithApiKey], preHandler: [requireApiKeyScope('ai_bridge:actions')] }, async () => ({ ok: true }));
  t.after(() => app.close());
  return { app, seen };
}

test('a valid key authenticates without request.prisma and scopes the request to its owner', async (t) => {
  const store = keyStore();
  const { app, seen } = await buildApp(t, store);
  for (const headers of [{ 'x-api-key': RAW_KEY }, { authorization: `Bearer ${RAW_KEY}` }]) {
    const response = await app.inject({ method: 'GET', url: '/read', headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().user.organizationId, 'org-1');
    assert.deepEqual(response.json().scopes, ['ai_bridge:read']);
    assert.deepEqual(response.json().prisma, { scopedFor: 'org-1' }, 'the tenancy step sees the key owner organization');
  }
  assert.equal(seen.organizationId, 'org-1');
  assert.deepEqual(store.touched, ['key-1', 'key-1'], 'lastUsedAt is recorded');
});

test('scopes are enforced after authentication', async (t) => {
  const { app } = await buildApp(t, keyStore());
  const response = await app.inject({ method: 'GET', url: '/actions', headers: { 'x-api-key': RAW_KEY } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, 'INSUFFICIENT_SCOPE');
});

test('missing, unknown, revoked, inactive, expired and disabled-owner keys are refused', async (t) => {
  const cases = [
    ['missing', keyStore(), {}],
    ['not an ashbi key', keyStore(), { 'x-api-key': 'sk-something' }],
    ['unknown', keyStore(), { 'x-api-key': `ashbi_${'b'.repeat(64)}` }],
    ['revoked', keyStore({ revokedAt: new Date() }), { 'x-api-key': RAW_KEY }],
    ['inactive', keyStore({ isActive: false }), { 'x-api-key': RAW_KEY }],
    ['expired', keyStore({ expiresAt: new Date(Date.now() - 1_000) }), { 'x-api-key': RAW_KEY }],
    ['disabled owner', keyStore({ user: { ...OWNER, isActive: false } }), { 'x-api-key': RAW_KEY }],
  ];
  for (const [label, store, headers] of cases) {
    const { app } = await buildApp(t, store);
    const response = await app.inject({ method: 'GET', url: '/read', headers });
    assert.equal(response.statusCode, 401, `${label}: ${response.body}`);
    assert.deepEqual(store.touched, [], `${label}: lastUsedAt untouched`);
  }
});
