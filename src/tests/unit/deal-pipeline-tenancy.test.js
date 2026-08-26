import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createDeal,
  getPipelineStages,
  updateDeal,
} from '../../services/dealPipeline.service.js';
import { pipelineDealCreateSchema } from '../../validators/schemas.js';

test('pipeline stages are read through the injected tenant client and shaped for the shipped page', async () => {
  const calls = [];
  const prisma = {
    pipelineStage: {
      findMany: async (args) => {
        calls.push(args);
        return [{
          id: 'stage-1', name: 'Qualified', order: 1, color: '#123456', probability: 50,
          deals: [{ id: 'deal-1', title: 'Packaging system', value: 12000, client: { id: 'client-1', name: 'Example Foods' } }],
        }];
      },
    },
  };

  const result = await getPipelineStages(prisma);

  assert.equal(calls.length, 1);
  assert.deepEqual(result, [{
    id: 'stage-1', key: 'stage-1', label: 'Qualified', name: 'Qualified', order: 1,
    color: '#123456', probability: 50, count: 1, value: 12000,
    items: [{ id: 'deal-1', title: 'Packaging system', name: 'Packaging system', value: 12000, total: 12000, clientId: 'client-1', clientName: 'Example Foods' }],
  }]);
});

test('deal creation requires a tenant stage and maps the web contract to the Prisma model', async () => {
  let createArgs;
  const prisma = {
    pipelineStage: { findFirst: async ({ where }) => where.id === 'stage-1' ? { id: 'stage-1' } : null },
    pipelineDeal: {
      create: async (args) => { createArgs = args; return { id: 'deal-1', ...args.data }; },
    },
  };

  await assert.rejects(
    createDeal(prisma, { name: 'Bad stage', clientId: 'client-1', stageId: 'stage-foreign', value: 1000 }),
    (error) => error.code === 'PIPELINE_STAGE_NOT_FOUND',
  );

  const result = await createDeal(prisma, {
    name: 'Packaging system', clientId: 'client-1', stageId: 'stage-1', value: 12000,
    expectedCloseDate: '2026-10-01T00:00:00.000Z', notes: 'Human-reviewed scope only.',
  });

  assert.equal(result.id, 'deal-1');
  assert.deepEqual(createArgs.data, {
    title: 'Packaging system', clientId: 'client-1', stageId: 'stage-1', value: 12000,
    expectedCloseDate: new Date('2026-10-01T00:00:00.000Z'), notes: 'Human-reviewed scope only.',
  });
});

test('moving a deal verifies the destination stage through the tenant client', async () => {
  let updateCalls = 0;
  const prisma = {
    pipelineStage: { findFirst: async () => null },
    pipelineDeal: { update: async () => { updateCalls += 1; } },
  };

  await assert.rejects(
    updateDeal(prisma, 'deal-1', { stageId: 'stage-foreign' }),
    (error) => error.code === 'PIPELINE_STAGE_NOT_FOUND',
  );
  assert.equal(updateCalls, 0);
});

test('pipeline routes and service never bypass the request-scoped tenant client', () => {
  const routes = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'pipeline.routes.js'), 'utf8');
  const service = fs.readFileSync(path.join(process.cwd(), 'src', 'services', 'dealPipeline.service.js'), 'utf8');
  assert.doesNotMatch(service, /import prisma from/);
  assert.match(routes, /getPipelineStages\(request\.prisma\)/);
  assert.match(routes, /getPipelineAnalytics\(request\.prisma\)/);
  assert.match(routes, /createStage\(request\.prisma, request\.body\)/);
  assert.match(routes, /createDeal\(request\.prisma, request\.body\)/);
  assert.match(routes, /updateDeal\(request\.prisma, id, request\.body\)/);
  assert.match(routes, /deleteDeal\(request\.prisma, id\)/);
});

test('deal creation contract requires a client and uses the page value field', () => {
  const accepted = pipelineDealCreateSchema.safeParse({
    name: 'Packaging system',
    clientId: 'cm12345678901234567890123',
    stageId: 'cm12345678901234567890124',
    value: 12000,
  });
  const missingClient = pipelineDealCreateSchema.safeParse({
    name: 'Packaging system',
    stageId: 'cm12345678901234567890124',
    value: 12000,
  });
  assert.equal(accepted.success, true);
  assert.equal(missingClient.success, false);
});

test('pipeline page does not offer an ownerless deal', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'web', 'src', 'pages', 'Pipeline.jsx'), 'utf8');
  assert.doesNotMatch(page, /-- No client --/);
  assert.match(page, /Client \*/);
});

test('pipeline page does not invent a close score from a deal name and value', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'web', 'src', 'pages', 'Pipeline.jsx'), 'utf8');
  assert.doesNotMatch(page, /AI Lead Score/);
  assert.doesNotMatch(page, /Rate this deal's likelihood of closing/);
});

test('pipeline page fails closed when no tenant stages are configured', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'web', 'src', 'pages', 'Pipeline.jsx'), 'utf8');
  assert.match(page, /disabled={!stages\.length}/);
  assert.match(page, /Set up at least one pipeline stage before creating a deal/);
});
