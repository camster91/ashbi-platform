import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import clientRoutes from '../../routes/client.routes.js';

// The client page edits the pinned note with PUT /api/clients/:id
// { clientNotes }. The note is trimmed, capped at 10,000 characters and can be
// cleared with null; nothing else on the client changes.

async function buildApp(t) {
  const updates = [];
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', role: 'TEAM', organizationId: 'org-1' }; });
  app.addHook('onRequest', async (request) => {
    request.prisma = {
      client: {
        update: async (args) => { updates.push(args); return { id: args.where.id, ...args.data }; },
      },
    };
  });
  await app.register(clientRoutes);
  t.after(() => app.close());
  return { app, updates };
}

test('saves a trimmed note and only the note', async (t) => {
  const { app, updates } = await buildApp(t);
  const response = await app.inject({ method: 'PUT', url: '/c1', payload: { clientNotes: '  Prefers Friday updates.  ' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(updates[0], { where: { id: 'c1' }, data: { clientNotes: 'Prefers Friday updates.' } });
});

test('clears the note with null', async (t) => {
  const { app, updates } = await buildApp(t);
  const response = await app.inject({ method: 'PUT', url: '/c1', payload: { clientNotes: null } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(updates[0].data, { clientNotes: null });
});

test('refuses a note over 10,000 characters or that is not text', async (t) => {
  const { app, updates } = await buildApp(t);
  for (const clientNotes of ['x'.repeat(10_001), 42, { text: 'x' }]) {
    const response = await app.inject({ method: 'PUT', url: '/c1', payload: { clientNotes } });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(updates.length, 0);
});
