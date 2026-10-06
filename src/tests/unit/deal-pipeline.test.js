import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pipelineDealCreateSchema, pipelineDealUpdateSchema } from '../../validators/schemas.js';
import {
  createDeal,
  DEFAULT_PIPELINE_STAGES,
  deleteStage,
  updateDeal,
  ensureDefaultStages,
  getPipelineStages,
  PipelineError,
} from '../../services/dealPipeline.service.js';

const clientId = 'cjld2cjxh0000qzrmn831i7rn';
const stageId = 'cjld2cjxh0001qzrmn831i7rn';

// The schema, the service and the UI share the Prisma PipelineDeal names:
// title, value, clientId (required) and stageId (required).
test('deal create accepts the PipelineDeal field names and keeps value', () => {
  const result = pipelineDealCreateSchema.safeParse({ title: ' Redesign ', value: 5000, clientId, stageId });
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  assert.deepEqual(result.data, { title: 'Redesign', value: 5000, clientId, stageId });
});

test('deal create rejects the legacy name/amount body and a deal without a client', () => {
  assert.equal(pipelineDealCreateSchema.safeParse({ name: 'Redesign', amount: 5, clientId, stageId }).success, false);
  assert.equal(pipelineDealCreateSchema.safeParse({ title: 'Redesign', stageId }).success, false);
  assert.equal(pipelineDealCreateSchema.safeParse({ title: 'Redesign', clientId }).success, false);
  assert.equal(pipelineDealCreateSchema.safeParse({ title: '   ', clientId, stageId }).success, false);
});

test('deal update only carries PipelineDeal columns', () => {
  const result = pipelineDealUpdateSchema.safeParse({ stageId, value: 10, status: 'WON', amount: 3, lostReason: 'Budget' });
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  assert.deepEqual(result.data, { stageId, value: 10, lostReason: 'Budget' });
});

test('createDeal writes title, value, clientId and stageId to the scoped client', async () => {
  let written;
  const db = { pipelineDeal: { create: async (args) => { written = args; return { id: 'd1', ...args.data }; } } };
  await createDeal(db, { title: 'Redesign', value: 0, clientId, stageId, probability: 0 });
  assert.equal(written.data.title, 'Redesign');
  assert.equal(written.data.value, 0);
  assert.equal(written.data.clientId, clientId);
  assert.equal(written.data.stageId, stageId);
  assert.equal(written.data.probability, 0);
  assert.equal(written.data.expectedCloseDate, null);
  assert.ok(written.include.client && written.include.stage);
});

test('createDeal takes the stage probability when none is given', async () => {
  let written;
  const db = {
    pipelineStage: { findFirst: async ({ where }) => (where.id === stageId ? { probability: 50 } : null) },
    pipelineDeal: { create: async (args) => { written = args; return args.data; } },
  };
  await createDeal(db, { title: 'Redesign', clientId, stageId });
  assert.equal(written.data.probability, 50);
  await assert.rejects(createDeal(db, { title: 'X', clientId, stageId: 'missing' }), (err) => err instanceof PipelineError && err.statusCode === 404);
});

test('updateDeal sets the destination stage probability on a move only', async () => {
  const writes = [];
  const db = {
    pipelineStage: { findFirst: async () => ({ probability: 75 }) },
    pipelineDeal: { update: async (args) => { writes.push(args.data); return args.data; } },
  };
  await updateDeal(db, 'd1', { stageId });
  await updateDeal(db, 'd1', { stageId, probability: 5 });
  await updateDeal(db, 'd1', { value: 10 });
  assert.deepEqual(writes, [{ stageId, probability: 75 }, { stageId, probability: 5 }, { value: 10 }]);
});

test('deleteStage moves the deals and deletes the stage in one transaction', async () => {
  const log = [];
  const tx = {
    pipelineStage: {
      findFirst: async ({ where }) => ({ id: where.id, probability: 100 }),
      delete: async ({ where }) => { log.push(['delete', where.id]); return { id: where.id }; },
    },
    pipelineDeal: {
      updateMany: async ({ where, data }) => { log.push(['move', where.stageId, data.stageId, data.probability]); return { count: 1 }; },
      count: async () => { log.push(['count']); return 0; },
    },
  };
  let transactions = 0;
  const db = { $transaction: async (fn) => { transactions += 1; log.push(['begin']); return fn(tx); } };
  await deleteStage(db, 's1', 's2');
  await deleteStage(db, 's3');
  assert.equal(transactions, 2);
  assert.deepEqual(log, [['begin'], ['move', 's1', 's2', 100], ['delete', 's1'], ['begin'], ['count'], ['delete', 's3']]);
});

function fakeDb(initialStages) {
  let stages = initialStages;
  const calls = { createMany: [], locks: 0 };
  const tx = {
    $executeRaw: async () => { calls.locks += 1; return 1; },
    pipelineStage: {
      count: async () => stages,
      createMany: async ({ data }) => { calls.createMany.push(data); stages += data.length; return { count: data.length }; },
    },
  };
  const db = {
    ...tx,
    pipelineStage: { ...tx.pipelineStage, findMany: async () => [] },
    $transaction: async (fn) => fn(tx),
  };
  return { db, calls };
}

test('ensureDefaultStages seeds the defaults once, under the lock, for an empty organization', async () => {
  const { db, calls } = fakeDb(0);
  assert.equal(await ensureDefaultStages(db, 'org-1'), true);
  assert.equal(calls.locks, 1);
  assert.equal(calls.createMany.length, 1);
  assert.deepEqual(calls.createMany[0].map((s) => s.name), DEFAULT_PIPELINE_STAGES.map((s) => s.name));
  assert.ok(calls.createMany[0].every((s) => s.organizationId === 'org-1'));

  assert.equal(await ensureDefaultStages(db, 'org-1'), false, 'a second call finds the stages and does nothing');
  assert.equal(calls.createMany.length, 1);
});

test('ensureDefaultStages leaves an organization with its own stages alone', async () => {
  const { db, calls } = fakeDb(2);
  assert.equal(await ensureDefaultStages(db, 'org-1'), false);
  assert.equal(calls.locks, 0);
  assert.equal(calls.createMany.length, 0);
});

test('getPipelineStages refuses to seed without an organization', async () => {
  const { db } = fakeDb(0);
  await assert.rejects(getPipelineStages(db, undefined), (err) => err instanceof PipelineError && err.statusCode === 403);
});
