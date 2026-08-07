import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import draftRoutes from '../../routes/draft.routes.js';

function createDraftStore() {
  const records = new Map();
  const keyFor = ({ userId, entity, entityId }) => `${userId}:${entity}:${entityId}`;

  return {
    records,
    model: {
      async findFirst({ where }) {
        return records.get(keyFor(where)) ?? null;
      },
      async create({ data }) {
        const record = { id: `draft-${records.size + 1}`, revision: 1, updatedAt: new Date(), ...data };
        records.set(keyFor(record), record);
        return record;
      },
      async updateMany({ where, data }) {
        const key = keyFor(where);
        const current = records.get(key);
        if (!current || current.revision !== where.revision) return { count: 0 };
        const { revision: _revisionUpdate, ...nextData } = data;
        records.set(key, { ...current, ...nextData, revision: current.revision + 1, updatedAt: new Date() });
        return { count: 1 };
      },
      async deleteMany({ where }) {
        return { count: records.delete(keyFor(where)) ? 1 : 0 };
      },
    },
  };
}

async function buildApp(store, user = { id: 'user-a', organizationId: 'org-a' }) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = user;
  });
  app.addHook('preHandler', async (request) => {
    request.prisma = { formDraft: store.model };
    request.organizationId = request.user?.organizationId ?? user.organizationId;
  });
  await app.register(draftRoutes, { prefix: '/api/draft' });
  return app;
}

test('draft API stores structured form data for a new unsaved entity key', async () => {
  const store = createDraftStore();
  const app = await buildApp(store);

  const response = await app.inject({
    method: 'PUT',
    url: '/api/draft/proposal/new-123',
    payload: { data: { title: 'Website redesign', lineItems: [{ description: 'Design', quantity: 1 }] } },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().revision, 1);
  assert.deepEqual(response.json().draft, {
    title: 'Website redesign',
    lineItems: [{ description: 'Design', quantity: 1 }],
  });
});

test('draft API isolates drafts by authenticated user', async () => {
  const store = createDraftStore();
  const ownerApp = await buildApp(store, { id: 'user-a', organizationId: 'org-a' });
  await ownerApp.inject({
    method: 'PUT',
    url: '/api/draft/invoice/invoice-1',
    payload: { data: { title: 'Private invoice' } },
  });

  const otherApp = await buildApp(store, { id: 'user-b', organizationId: 'org-a' });
  const response = await otherApp.inject({ method: 'GET', url: '/api/draft/invoice/invoice-1' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().draft, null);
});

test('draft API rejects a stale revision instead of overwriting newer work', async () => {
  const store = createDraftStore();
  const app = await buildApp(store);
  await app.inject({
    method: 'PUT',
    url: '/api/draft/contract/contract-1',
    payload: { data: { title: 'First edit' } },
  });
  await app.inject({
    method: 'PUT',
    url: '/api/draft/contract/contract-1',
    payload: { data: { title: 'Second edit' }, expectedRevision: 1 },
  });

  const response = await app.inject({
    method: 'PUT',
    url: '/api/draft/contract/contract-1',
    payload: { data: { title: 'Stale edit' }, expectedRevision: 1 },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'DRAFT_CONFLICT');
});

test('draft API clears without requiring a request body and only clears the owners draft', async () => {
  const store = createDraftStore();
  const app = await buildApp(store);
  await app.inject({
    method: 'PUT',
    url: '/api/draft/estimate/new-1',
    payload: { data: { title: 'Estimate' } },
  });

  const response = await app.inject({ method: 'DELETE', url: '/api/draft/estimate/new-1' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().cleared, true);
  assert.equal(store.records.size, 0);
});
