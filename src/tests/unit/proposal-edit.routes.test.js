// Proposal create/edit contract: every edit of a draft must succeed, line
// items and discount must be accepted by both schemas, and totals are always
// recomputed on the server (never trusted from the client).
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import proposalRoutes from '../../routes/proposal.routes.js';
import { proposalCreateSchema, proposalUpdateSchema } from '../../validators/schemas.js';

function harness(initial = {}) {
  const state = {
    proposal: {
      id: 'proposal-a',
      title: 'Brand refresh',
      status: 'DRAFT',
      notes: null,
      discount: 0,
      subtotal: 1000,
      total: 1000,
      clientId: 'client-a',
      projectId: null,
      ...initial,
    },
    lineItems: [{ id: 'li-1', description: 'Strategy', quantity: 2, unitPrice: 500, total: 1000, proposalId: 'proposal-a' }],
    versions: [],
    created: null,
  };
  const tx = {
    proposal: {
      create: async ({ data }) => {
        state.created = data;
        return { id: 'proposal-new', status: 'DRAFT', ...data, lineItems: data.lineItems.create };
      },
      update: async ({ data }) => {
        Object.assign(state.proposal, data);
        return { ...state.proposal, lineItems: state.lineItems };
      },
    },
    proposalLineItem: {
      deleteMany: async () => { state.lineItems = []; return { count: 0 }; },
      createMany: async ({ data }) => { state.lineItems = data.map((item, index) => ({ id: `li-new-${index}`, ...item })); return { count: data.length }; },
      findMany: async () => state.lineItems,
    },
    proposalVersion: {
      create: async ({ data }) => { state.versions.push(data); return data; },
    },
  };
  const prisma = {
    ...tx,
    proposal: {
      ...tx.proposal,
      findUnique: async ({ include } = {}) => (include?.lineItems ? { ...state.proposal, lineItems: state.lineItems } : { ...state.proposal }),
    },
    $transaction: async (callback) => callback(tx),
  };
  return { state, prisma };
}

async function buildApp(t, prisma) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'user-a', organizationId: 'org-a', role: 'ADMIN' };
  });
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(proposalRoutes);
  t.after(() => app.close());
  return app;
}

test('editing a draft proposal title only succeeds and snapshots the unchanged line items', async (t) => {
  const { state, prisma } = harness();
  const app = await buildApp(t, prisma);
  const response = await app.inject({ method: 'PUT', url: '/proposal-a', payload: { title: 'Brand refresh v2' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().title, 'Brand refresh v2');
  assert.equal(state.versions.length, 1);
  assert.equal(state.versions[0].data.lineItems.length, 1);
  assert.equal(state.versions[0].data.lineItems[0].description, 'Strategy');
});

test('editing line items and discount recomputes totals on the server', async (t) => {
  const { state, prisma } = harness();
  const app = await buildApp(t, prisma);
  const response = await app.inject({
    method: 'PUT',
    url: '/proposal-a',
    payload: {
      discount: 150,
      subtotal: 1, // client-supplied totals are ignored
      total: 1,
      lineItems: [
        { description: 'Strategy', quantity: 2, unitPrice: 500 },
        { description: 'Design', quantity: 1, unitPrice: 250.5 },
      ],
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(state.proposal.subtotal, 1250.5);
  assert.equal(state.proposal.discount, 150);
  assert.equal(state.proposal.total, 1100.5);
  assert.equal(state.lineItems.length, 2);
  assert.equal(state.versions[0].data.lineItems.length, 2);
});

test('a discount alone recomputes the total against the stored subtotal', async (t) => {
  const { state, prisma } = harness();
  const app = await buildApp(t, prisma);
  const response = await app.inject({ method: 'PUT', url: '/proposal-a', payload: { discount: 200 } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(state.proposal.discount, 200);
  assert.equal(state.proposal.total, 800);
});

test('a discount larger than the subtotal clamps the total at zero', async (t) => {
  const { state, prisma } = harness();
  const app = await buildApp(t, prisma);
  const response = await app.inject({ method: 'PUT', url: '/proposal-a', payload: { discount: 5000 } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(state.proposal.total, 0);
});

test('proposal create accepts a discount and clamps the total at zero', async (t) => {
  const { state, prisma } = harness();
  const app = await buildApp(t, prisma);
  const response = await app.inject({
    method: 'POST',
    url: '/',
    payload: { clientId: 'client-a', title: 'New', discount: 100, lineItems: [{ description: 'Audit', quantity: 1, unitPrice: 400 }] },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(state.created.discount, 100);
  assert.equal(state.created.subtotal, 400);
  assert.equal(state.created.total, 300);

  const clamped = await app.inject({
    method: 'POST',
    url: '/',
    payload: { clientId: 'client-a', title: 'New', discount: 900, lineItems: [{ description: 'Audit', quantity: 1, unitPrice: 400 }] },
  });
  assert.equal(clamped.statusCode, 201, clamped.body);
  assert.equal(state.created.total, 0);
});

test('proposal schemas keep line items and discount and reject negative discounts', () => {
  const create = proposalCreateSchema.parse({ clientId: 'c', title: 't', discount: 10, lineItems: [{ description: 'x', unitPrice: 1 }] });
  assert.equal(create.discount, 10);
  const update = proposalUpdateSchema.parse({ discount: 5, lineItems: [{ description: 'x', quantity: 2, unitPrice: 3 }] });
  assert.equal(update.discount, 5);
  assert.equal(update.lineItems.length, 1);
  assert.equal(proposalUpdateSchema.safeParse({ discount: -1 }).success, false);
  assert.equal(proposalCreateSchema.safeParse({ clientId: 'c', title: 't', discount: -1, lineItems: [{ description: 'x', unitPrice: 1 }] }).success, false);
});

test('only draft proposals can be edited', async (t) => {
  const { prisma } = harness({ status: 'SENT' });
  const app = await buildApp(t, prisma);
  const response = await app.inject({ method: 'PUT', url: '/proposal-a', payload: { title: 'x' } });
  assert.equal(response.statusCode, 400);
});
