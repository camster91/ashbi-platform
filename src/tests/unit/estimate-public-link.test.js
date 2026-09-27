// M1 (security audit at 8687cf9): the public estimate link returned the whole
// row (draftData, delivery fields, the client's email), showed DRAFT
// estimates, never expired, and approve had no body validation, no validUntil
// check and no audit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Fastify from 'fastify';
import estimateRoutes from '../../routes/estimate.routes.js';

const DAY = 24 * 60 * 60 * 1000;

function estimateRow(overrides = {}) {
  return {
    id: 'estimate-a',
    clientId: 'client-a',
    title: 'Website refresh',
    description: 'Scope',
    status: 'SENT',
    lineItems: [{ description: 'Design', quantity: 2, rate: 500, amount: 1000, internalNote: 'margin 40%' }],
    subtotal: 1000,
    tax: 130,
    total: 1130,
    validUntil: new Date(Date.now() + 10 * DAY),
    viewToken: 'strong-token',
    publicAccessExpiresAt: new Date(Date.now() + 30 * DAY),
    publicAccessRevokedAt: null,
    sentAt: new Date(),
    deliveryMessageId: '<msg@mail>',
    deliveryStatus: 'DELIVERED',
    deliveryError: null,
    draftData: '{"secret":"unsaved internal draft"}',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    client: { id: 'client-a', name: 'Avery Client', email: 'avery@example.test', organizationId: 'org-a' },
    ...overrides,
  };
}

async function buildApp(t, row) {
  const audits = [];
  const updates = [];
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'user-a', organizationId: 'org-a', role: 'ADMIN' }; });
  const prisma = {
    estimate: {
      findUnique: async ({ where }) => (row && where.viewToken === row.viewToken ? row : null),
      updateMany: async ({ where, data }) => {
        if (!row || where.status !== row.status) return { count: 0 };
        updates.push(data);
        row.status = data.status;
        return { count: 1 };
      },
    },
    auditEvent: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  app.decorate('prisma', prisma);
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(estimateRoutes);
  t.after(() => app.close());
  return { app, audits, updates };
}

test('the public view returns an explicit safe shape', async (t) => {
  const { app } = await buildApp(t, estimateRow());
  const response = await app.inject({ method: 'GET', url: '/view/strong-token' });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(Object.keys(body).sort(), [
    'clientName', 'createdAt', 'description', 'lineItems', 'sentAt', 'status', 'subtotal', 'tax', 'title', 'total', 'validUntil',
  ]);
  assert.equal(body.clientName, 'Avery Client');
  assert.deepEqual(Object.keys(body.lineItems[0]).sort(), ['amount', 'description', 'quantity', 'rate']);
  assert.doesNotMatch(response.body, /draftData|unsaved internal draft|avery@example|deliveryMessageId|viewToken|strong-token|margin|estimate-a|client-a/);
});

test('a DRAFT estimate is never viewable or answerable through its token', async (t) => {
  const { app, updates } = await buildApp(t, estimateRow({ status: 'DRAFT' }));
  assert.equal((await app.inject({ method: 'GET', url: '/view/strong-token' })).statusCode, 404);
  const answer = await app.inject({ method: 'POST', url: '/view/strong-token/approve', payload: { action: 'approve' } });
  assert.equal(answer.statusCode, 404);
  assert.deepEqual(updates, []);
});

test('expired, never-issued and revoked links are refused', async (t) => {
  for (const [overrides, status] of [
    [{ publicAccessExpiresAt: new Date(Date.now() - 1000) }, 410],
    [{ publicAccessExpiresAt: null }, 410],
    [{ publicAccessRevokedAt: new Date() }, 410],
  ]) {
    const { app } = await buildApp(t, estimateRow(overrides));
    assert.equal((await app.inject({ method: 'GET', url: '/view/strong-token' })).statusCode, status, JSON.stringify(overrides));
  }
});

test('approve validates its body strictly', async (t) => {
  const { app, updates } = await buildApp(t, estimateRow());
  for (const payload of [{}, { action: 'APPROVE' }, { action: 'approve', status: 'CONVERTED' }, { action: 'approve', total: 1 }]) {
    const response = await app.inject({ method: 'POST', url: '/view/strong-token/approve', payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
  assert.deepEqual(updates, []);
});

test('approve enforces validUntil and records an audit event', async (t) => {
  const expired = await buildApp(t, estimateRow({ validUntil: new Date(Date.now() - DAY) }));
  const late = await expired.app.inject({ method: 'POST', url: '/view/strong-token/approve', payload: { action: 'approve' } });
  assert.equal(late.statusCode, 410);
  assert.equal(late.json().code, 'ESTIMATE_EXPIRED');
  assert.deepEqual(expired.updates, []);

  const { app, audits, updates } = await buildApp(t, estimateRow());
  const response = await app.inject({ method: 'POST', url: '/view/strong-token/approve', payload: { action: 'approve' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, 'APPROVED');
  assert.deepEqual(updates, [{ status: 'APPROVED' }]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'estimate.approved');
  assert.equal(audits[0].actorType, 'CLIENT');
  assert.equal(audits[0].organizationId, 'org-a');

  const again = await app.inject({ method: 'POST', url: '/view/strong-token/approve', payload: { action: 'decline' } });
  assert.equal(again.statusCode, 400);
});

test('public link routes carry per-route rate limits', () => {
  const estimates = readFileSync(new URL('../../routes/estimate.routes.js', import.meta.url), 'utf8');
  assert.match(estimates, /fastify\.get\('\/view\/:viewToken', \{ config: \{ public: true, \.\.\.PUBLIC_VIEW_RATE_LIMIT \} \}/);
  assert.match(estimates, /config: \{ public: true, \.\.\.PUBLIC_RESPOND_RATE_LIMIT \}/);
  const portal = readFileSync(new URL('../../routes/portal.routes.js', import.meta.url), 'utf8');
  assert.match(portal, /fastify\.get\('\/:token', LEGACY_LINK_VIEW_RATE_LIMIT/);
  assert.match(portal, /fastify\.get\('\/form\/:viewToken', LEGACY_LINK_VIEW_RATE_LIMIT/);
  assert.match(portal, /fastify\.post\('\/form\/:viewToken', \{ \.\.\.LEGACY_LINK_SUBMIT_RATE_LIMIT/);
});

test('the migration rotates every existing estimate token', () => {
  const migration = readFileSync(new URL('../../../prisma/migrations/20260927050000_estimate_public_access/migration.sql', import.meta.url), 'utf8');
  assert.match(migration, /UPDATE "estimates"\s+SET "viewToken" = /);
  assert.doesNotMatch(migration, /DROP /);
});
