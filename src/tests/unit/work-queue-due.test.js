import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import workQueueRoutes, { workQueueQuerySchema } from '../../routes/work-queue.routes.js';
import { buildWorkQueue, workQueueDueRange, WORK_QUEUE_SOURCES } from '../../services/work-queue.service.js';

test('due ranges are whole inclusive UTC days, with leap-day and one-sided support', () => {
  assert.deepEqual(workQueueDueRange({ dueFrom: '2024-02-29', dueTo: '2024-02-29' }), {
    not: null, gte: new Date('2024-02-29T00:00:00Z'), lt: new Date('2024-03-01T00:00:00Z'),
  });
  assert.deepEqual(workQueueDueRange({ dueFrom: '2026-10-16' }), { not: null, gte: new Date('2026-10-16T00:00:00Z') });
  assert.deepEqual(workQueueDueRange({ dueTo: '2026-12-31' }), { not: null, lt: new Date('2027-01-01T00:00:00Z') });
  assert.equal(workQueueDueRange({}), null);
  for (const dueFrom of ['', '2023-02-29', '2024-02-30', '2026-1-01', '2026-10-16T00:00:00Z', 'no date']) {
    assert.equal(workQueueQuerySchema.safeParse({ dueFrom }).success, false);
    assert.throws(() => workQueueDueRange({ dueFrom }), { statusCode: 400 });
  }
  assert.equal(workQueueQuerySchema.safeParse({ dueFrom: '2026-10-17', dueTo: '2026-10-16' }).success, false);
  assert.throws(() => workQueueDueRange({ dueFrom: '2026-10-17', dueTo: '2026-10-16' }), { statusCode: 400 });
});

test('the HTTP route refuses malformed/reversed dates before reading any source', async () => {
  const app = Fastify();
  app.decorate('authenticate', async request => { request.user = { id: 'admin', role: 'ADMIN' }; });
  let reads = 0;
  app.addHook('preHandler', async request => { request.prisma = { task: { findMany: async () => { reads++; return []; } } }; });
  await app.register(workQueueRoutes, { prefix: '/api/work-queue' });
  try {
    for (const q of ['dueFrom=2026-02-30', 'dueTo=not-a-date', 'dueFrom=2026-10-17&dueTo=2026-10-16']) {
      assert.equal((await app.inject(`/api/work-queue?${q}`)).statusCode, 400);
    }
    assert.equal(reads, 0);
  } finally { await app.close(); }
});

for (const [key, model, dateField] of [['tasks', 'task', 'dueDate'], ['approvals', 'approval', 'expiresAt'], ['proposals', 'proposal', 'validUntil'], ['invoices', 'invoice', 'dueDate']]) {
  test(`${key} applies range and existing scope before the 101-row database limit`, async () => {
    const source = WORK_QUEUE_SOURCES.find(s => s.key === key);
    const records = [
      ...Array.from({ length: 120 }, (_, id) => ({ id: `older-${id}`, [dateField]: new Date('2024-02-28T23:59:59.999Z') })),
      { id: 'midnight', [dateField]: new Date('2024-02-29T00:00:00.000Z') },
      { id: 'last-millisecond', [dateField]: new Date('2024-02-29T23:59:59.999Z') },
      { id: 'next-midnight', [dateField]: new Date('2024-03-01T00:00:00Z') },
      { id: 'undated', [dateField]: null },
    ];
    let query;
    const db = { [model]: { findMany: async args => {
      query = args;
      const range = args.where[dateField];
      assert.equal(range.not, null);
      return records.filter(r => r[dateField] && r[dateField] >= range.gte && r[dateField] < range.lt).slice(0, args.take);
    } } };
    const rows = await source.load(db, { user: { id: 'actor', role: 'TEAM' }, filters: { owner: 'me', clientId: 'client', projectId: 'project', dueFrom: '2024-02-29', dueTo: '2024-02-29' }, now: new Date('2024-02-29T12:00:00Z') });
    assert.deepEqual(rows.map(r => r.id), ['midnight', 'last-millisecond']);
    assert.equal(query.take, 101);
    if (key === 'tasks') {
      assert.equal(query.where.assigneeId, 'actor');
      assert.equal(query.where.project.clientId, 'client');
      assert.equal(query.where.projectId, 'project');
    } else if (key === 'approvals') {
      assert.equal(query.where.project.is.clientId, 'client');
      assert.equal(query.where.project.is.id, 'project');
    } else {
      assert.equal(query.where.createdById, 'actor');
      assert.equal(query.where.clientId, 'client');
      assert.equal(query.where.projectId, 'project');
    }
  });
}

test('active due range omits undated sources without executing them and retains partial/truncation counts', async () => {
  const sources = [
    { key: 'tasks', load: async () => Array.from({ length: 101 }, (_, id) => ({ id, view: 'needs_action', dueAt: '2024-02-29T00:00:00Z' })) },
    { key: 'invoices', load: async () => { throw new Error('unavailable'); } },
    ...['reviews', 'contracts', 'portal_handoffs', 'workspace_chat_attention'].map(key => ({ key, load: async () => { assert.fail('undated source queried'); } })),
  ];
  const body = await buildWorkQueue({}, { user: { id: 'actor', role: 'ADMIN' }, filters: { dueTo: '2024-02-29' }, sources });
  assert.deepEqual(body.sources, ['tasks', 'invoices']);
  assert.equal(body.partial, true);
  assert.deepEqual(body.failedSources, ['invoices']);
  assert.deepEqual(body.truncatedSources, ['tasks']);
  assert.equal(body.counts.needs_action, 100);
  assert.equal(body.total, 100);
});

test('due filtering never broadens TEAM/STAFF source access', async () => {
  for (const role of ['TEAM', 'STAFF']) {
    const calls = [];
    const body = await buildWorkQueue({ task: { findMany: async q => { calls.push(q); return []; } } }, {
      user: { id: 'team', role }, filters: { dueFrom: '2026-10-16', owner: 'everyone' },
    });
    assert.deepEqual(body.sources, ['tasks']);
    assert.equal(calls[0].where.assigneeId, 'team');
    assert.equal(body.partial, false);
  }
});
