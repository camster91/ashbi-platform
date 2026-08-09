import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SOFT_DELETE_MODELS,
  WITH_DELETED,
  withSoftDelete,
} from '../../services/soft-delete.service.js';

test('every nullable deletedAt schema model is classified exactly once', async () => {
  const schema = await readFile(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)]
    .filter((match) => /^\s*deletedAt\s+DateTime\?/m.test(match[2]))
    .map((match) => match[1][0].toLowerCase() + match[1].slice(1))
    .sort();
  assert.deepEqual([...SOFT_DELETE_MODELS].sort(), models);
  assert.equal(SOFT_DELETE_MODELS.includes('trashedItem'), false);
  assert.equal(Object.isFrozen(SOFT_DELETE_MODELS), true);
});

test('all supported reads exclude deleted rows even without an input where', async () => {
  const calls = [];
  const delegate = Object.fromEntries([
    'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
    'findMany', 'count', 'aggregate', 'groupBy',
  ].map((operation) => [operation, async (args) => { calls.push({ operation, args }); return []; }]));
  const prisma = withSoftDelete({ note: delegate });

  for (const operation of Object.keys(delegate)) await prisma.note[operation]();

  assert.equal(calls.length, 8);
  for (const { args } of calls) assert.deepEqual(args.where, { deletedAt: null });
  assert.equal(calls.find(({ operation }) => operation === 'findMany').args.take, 100);
});

test('explicit deletedAt is preserved for reviewed restore and purge reads', async () => {
  const calls = [];
  const raw = { note: { findFirst: async (args) => { calls.push(args); return null; } } };
  const prisma = withSoftDelete(raw);
  const where = { id: 'note-a', deletedAt: { not: null } };
  await prisma.note.findFirst({ where });
  assert.deepEqual(calls[0].where, where);
  assert.equal(prisma[WITH_DELETED](), raw);
});

test('an undefined deletedAt value cannot accidentally bypass filtering', async () => {
  const calls = [];
  const prisma = withSoftDelete({
    note: { findMany: async (args) => { calls.push(args); return []; } },
  });
  await prisma.note.findMany({ where: { projectId: 'project-a', deletedAt: undefined } });
  assert.deepEqual(calls[0].where, { projectId: 'project-a', deletedAt: null });
});

test('delete families become updates and applying the policy twice is idempotent', async () => {
  const calls = [];
  const raw = {
    note: {
      update: async (args) => { calls.push({ operation: 'update', args }); return args; },
      updateMany: async (args) => { calls.push({ operation: 'updateMany', args }); return args; },
      delete: async () => { throw new Error('hard delete must not run'); },
      deleteMany: async () => { throw new Error('hard deleteMany must not run'); },
    },
  };
  const prisma = withSoftDelete(withSoftDelete(raw));
  await prisma.note.delete({ where: { id: 'note-a' } });
  await prisma.note.deleteMany({ where: { projectId: 'project-a' } });
  assert.deepEqual(calls.map(({ operation }) => operation), ['update', 'updateMany']);
  assert.ok(calls.every(({ args }) => args.data.deletedAt instanceof Date));
});

test('callback transactions retain the soft-delete policy', async () => {
  const calls = [];
  const transaction = { note: { findMany: async (args) => { calls.push(args); return []; } } };
  const prisma = withSoftDelete({
    $transaction: async (callback) => callback(transaction),
  });
  await prisma.$transaction((tx) => tx.note.findMany());
  assert.deepEqual(calls[0], { where: { deletedAt: null }, take: 100 });
});

test('the production lazy client keeps raw and policy caches separate', async () => {
  process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
  const { prisma } = await import('../../config/db.js');
  assert.equal(typeof prisma.note.findMany, 'function');
  assert.equal(typeof prisma.note.delete, 'function');
});
