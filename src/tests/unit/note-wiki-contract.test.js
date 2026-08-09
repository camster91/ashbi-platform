import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { findAuthorizedMentionUsers, presentNote, validateParent } from '../../routes/note.routes.js';
import noteRoutes from '../../routes/note.routes.js';
import { noteFromTemplateSchema, noteProjectCreateSchema, noteUpdateV2Schema } from '../../validators/schemas.js';

test('note routes mount at the frontend canonical API paths', async () => {
  const index = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../../routes/note.routes.js', import.meta.url), 'utf8');
  assert.match(index, /register\(noteRoutes, \{ prefix: '\/api' \}\)/);
  assert.match(routes, /get\('\/notes'/);
  assert.match(routes, /post\('\/projects\/:projectId\/notes'/);
  assert.match(routes, /get\('\/notes\/templates'/);
  assert.match(routes, /post\('\/projects\/:projectId\/notes\/from-template\/:templateId'/);
});

test('wiki schemas accept the shipped document types and bounded hierarchy fields', () => {
  const created = noteProjectCreateSchema.parse({
    title: 'Launch guide', content: '', type: 'WIKI', parentId: null,
    mentionUserIds: ['cm0mention0000000000000001'], isTemplate: true,
  });
  assert.equal(created.type, 'WIKI');
  assert.equal(created.isTemplate, true);
  assert.deepEqual(noteUpdateV2Schema.parse({ type: 'MEETING_NOTES', parentId: null }).parentId, null);
  assert.equal(noteFromTemplateSchema.parse({}).mentionUserIds.length, 0);
  assert.throws(() => noteProjectCreateSchema.parse({ title: 'Bad', content: '', type: 'TASK' }));
});

test('hierarchy validation accepts same-project parents and rejects missing, self, and cyclic moves', async () => {
  const rows = new Map([
    ['root', { id: 'root', parentId: null, projectId: 'project-a' }],
    ['child', { id: 'child', parentId: 'root', projectId: 'project-a' }],
    ['grandchild', { id: 'grandchild', parentId: 'child', projectId: 'project-a' }],
  ]);
  const prisma = {
    note: {
      findFirst: async ({ where }) => {
        const row = rows.get(where.id);
        return row?.projectId === where.projectId ? row : null;
      },
    },
  };

  assert.equal((await validateParent(prisma, { parentId: 'root', projectId: 'project-a' })).ok, true);
  assert.match((await validateParent(prisma, { parentId: 'missing', projectId: 'project-a' })).error, /same project/i);
  assert.match((await validateParent(prisma, { parentId: 'child', projectId: 'project-a', noteId: 'child' })).error, /own parent/i);
  assert.match((await validateParent(prisma, { parentId: 'grandchild', projectId: 'project-a', noteId: 'root' })).error, /cycle/i);
});

test('mentions fail closed unless every requested member is active in the tenant', async () => {
  const calls = [];
  const prisma = {
    user: {
      findMany: async args => {
        calls.push(args);
        return args.where.id.in.includes('outside') ? [{ id: 'inside', name: 'Inside' }] : [{ id: 'inside', name: 'Inside' }];
      },
    },
  };
  assert.equal((await findAuthorizedMentionUsers(prisma, 'org-a', ['inside']))[0].id, 'inside');
  assert.equal(await findAuthorizedMentionUsers(prisma, 'org-a', ['inside', 'outside']), null);
  assert.deepEqual(calls[0].where, { id: { in: ['inside'] }, organizationId: 'org-a', isActive: true });
});

test('note presentation treats malformed legacy metadata as empty arrays', () => {
  assert.deepEqual(presentNote({ id: 'note', tags: '{bad', mentions: 'null' }), {
    id: 'note', tags: [], mentions: [], contentFormat: 'MARKDOWN_PLAINTEXT',
  });
});

test('migration enforces same-project parent ownership at the database boundary', async () => {
  const migration = await readFile(new URL('../../../prisma/migrations/20260809111500_note_hierarchy_templates_mentions/migration.sql', import.meta.url), 'utf8');
  assert.match(migration, /notes_parent_project_guard/);
  assert.match(migration, /parent\."projectId" = NEW\."projectId"/);
  assert.match(migration, /parent\."deletedAt" IS NULL/);
  assert.match(migration, /WITH RECURSIVE ancestors/);
  assert.match(migration, /note hierarchy cannot contain a cycle/);
});

test('canonical wiki API creates nested pages, audit rows, template copies, and mention notifications', async () => {
  const rows = [{ id: 'root', title: 'Root', content: '', type: 'WIKI', tags: '[]', mentions: '[]', projectId: 'project-a', parentId: null, isTemplate: false }];
  const activities = [];
  const notifications = [];
  const prisma = {
    project: { findFirst: async ({ where }) => where.id === 'project-a' ? { id: 'project-a' } : null },
    user: { findMany: async ({ where }) => where.id.in.map(id => ({ id, name: id })) },
    note: {
      findMany: async () => rows,
      findFirst: async ({ where }) => rows.find(row => row.id === where.id && (!where.projectId || row.projectId === where.projectId) && (where.isTemplate === undefined || row.isTemplate === where.isTemplate)) || null,
      findUnique: async ({ where }) => rows.find(row => row.id === where.id) || null,
      create: async ({ data }) => {
        const row = { id: `note-${rows.length}`, ...data, tags: data.tags || '[]', mentions: data.mentions || '[]', author: { id: 'author', name: 'Author' } };
        rows.push(row);
        return row;
      },
    },
    activity: { create: async ({ data }) => { activities.push(data); return data; } },
    notification: { create: async ({ data }) => { notifications.push(data); return data; } },
  };
  prisma.$transaction = async callback => callback(prisma);
  const app = Fastify();
  app.decorate('authenticate', async request => {
    request.user = { id: 'author', role: 'ADMIN', organizationId: 'org-a' };
  });
  app.decorate('prisma', prisma);
  app.addHook('preHandler', async request => { request.prisma = prisma; });
  await app.register(noteRoutes, { prefix: '/api' });

  try {
    const created = await app.inject({
      method: 'POST', url: '/api/projects/project-a/notes',
      payload: { title: 'Nested', content: '', type: 'WIKI', parentId: 'root', mentionUserIds: ['member-a'], isTemplate: true },
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().parentId, 'root');
    assert.deepEqual(created.json().mentions, ['member-a']);
    assert.equal(activities.at(-1).type, 'NOTE_CREATED');
    assert.equal(notifications.at(-1).userId, 'member-a');

    const copied = await app.inject({
      method: 'POST', url: `/api/projects/project-a/notes/from-template/${created.json().id}`,
      payload: { title: 'Copied', parentId: 'root' },
    });
    assert.equal(copied.statusCode, 201, copied.body);
    assert.equal(copied.json().isTemplate, false);
    assert.equal(activities.at(-1).type, 'NOTE_CREATED_FROM_TEMPLATE');

    assert.equal((await app.inject({ method: 'GET', url: '/api/notes' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/notes/notes' })).statusCode, 404);
  } finally {
    await app.close();
  }
});
