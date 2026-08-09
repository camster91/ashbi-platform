import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../../routes/note.routes.js', import.meta.url), 'utf8');

test('note restore requires authentication and targets exactly one deleted note', () => {
  assert.match(route, /post\('\/notes\/:id\/restore'/);
  assert.match(route, /onRequest: \[fastify\.authenticate\]/);
  assert.match(route, /where: \{ id, deletedAt: \{ not: null \} \}/);
  assert.match(route, /data: \{ deletedAt: null, parentId: parent\?\.id \|\| null \}/);
  assert.match(route, /where: \{ id: existing\.parentId, projectId: existing\.projectId \}/);
});

test('note restore preserves author or administrator authorization', () => {
  assert.match(route, /existing\.authorId !== request\.user\.id && request\.user\.role !== 'ADMIN'/);
  assert.match(route, /status\(403\).*Cannot restore this note/s);
});
