import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import noteRoutes from '../../routes/note.routes.js';

async function fixture() {
  const row = { id: 'note', projectId: 'project', revision: 0, title: 'Original', content: 'Original content', authorId: 'staff', tags: '[]', mentions: '[]', deletedAt: null };
  const activities = [], notifications = [];
  const prisma = {
    note: { findUnique: async ({ where }) => where.id === row.id ? structuredClone(row) : null,
      updateMany: async ({ where, data }) => { if (where.id !== row.id || where.revision !== row.revision || row.deletedAt) return { count: 0 }; Object.assign(row, data, { revision: row.revision + 1 }); return { count: 1 }; } },
    user: { findMany: async () => [] },
    activity: { create: async ({ data }) => { activities.push(data); return data; } },
    notification: { create: async ({ data }) => { notifications.push(data); return data; } },
  };
  prisma.$transaction = async work => work(prisma);
  const app = Fastify();
  app.decorate('authenticate', async request => { request.user = { id: 'staff', organizationId: 'org', role: 'TEAM' }; request.prisma = prisma; });
  await app.register(noteRoutes, { prefix: '/api' });
  return { app, row, activities, notifications };
}

test('document updates require an observed revision and racing drafts have one winner', async () => {
  const { app, row, activities, notifications } = await fixture();
  try {
    assert.equal((await app.inject({ method: 'PUT', url: '/api/notes/note', payload: { content: 'Unversioned' } })).statusCode, 400);
    const results = await Promise.all(['First draft', 'Second draft'].map(content => app.inject({ method: 'PUT', url: '/api/notes/note', payload: { revision: 0, content } })));
    assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
    const winner = results.find(result => result.statusCode === 200).json();
    assert.equal(row.content, winner.content); assert.equal(row.revision, 1);
    assert.equal(activities.length, 1); assert.equal(notifications.length, 0);
    const stale = await app.inject({ method: 'PUT', url: '/api/notes/note', payload: { revision: 0, title: 'Overwrite' } });
    assert.equal(stale.statusCode, 409); assert.equal(row.title, 'Original'); assert.equal(activities.length, 1);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/notes/note', payload: { revision: 1, title: 'Fresh revision' } })).statusCode, 200);
    assert.equal(row.revision, 2);
  } finally { await app.close(); }
});

test('foreign or deleted documents do not become writable through a revision guess', async () => {
  const { app, row } = await fixture();
  try {
    assert.equal((await app.inject({ method: 'PUT', url: '/api/notes/foreign', payload: { revision: 0, content: 'Guess' } })).statusCode, 404);
    row.deletedAt = new Date();
    assert.equal((await app.inject({ method: 'PUT', url: '/api/notes/note', payload: { revision: 0, content: 'Deleted draft' } })).statusCode, 409);
    assert.equal(row.content, 'Original content');
  } finally { await app.close(); }
});
