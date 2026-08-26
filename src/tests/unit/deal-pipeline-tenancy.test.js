import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createStage,
  createDeal,
  getPipelineAnalytics,
  getPipelineStages,
  updateStage,
  updateDeal,
} from '../../services/dealPipeline.service.js';
import {
  pipelineDealCreateSchema,
  pipelineStageCreateSchema,
  pipelineStageUpdateSchema,
} from '../../validators/schemas.js';

test('pipeline stages are read through the injected tenant client and shaped for the shipped page', async () => {
  const calls = [];
  const prisma = {
    pipelineStage: {
      findMany: async (args) => {
        calls.push(args);
        return [{
          id: 'stage-1', name: 'Qualified', order: 1, color: '#123456', probability: 50,
          deals: [{ id: 'deal-1', title: 'Packaging system', value: 12000, currency: 'CAD', client: { id: 'client-1', name: 'Example Foods' } }],
        }];
      },
    },
  };

  const result = await getPipelineStages(prisma);

  assert.equal(calls.length, 1);
  assert.deepEqual(result, [{
    id: 'stage-1', key: 'stage-1', label: 'Qualified', name: 'Qualified', order: 1,
    color: '#123456', probability: 50, count: 1, valuesByCurrency: { CAD: 12000 },
    items: [{ id: 'deal-1', title: 'Packaging system', name: 'Packaging system', value: 12000, total: 12000, currency: 'CAD', clientId: 'client-1', clientName: 'Example Foods' }],
  }]);
});

test('pipeline stage creation rejects a case-insensitive duplicate in the tenant', async () => {
  let createCalls = 0;
  const prisma = {
    pipelineStage: {
      findFirst: async () => ({ id: 'stage-existing' }),
      create: async () => { createCalls += 1; },
    },
  };

  await assert.rejects(
    createStage(prisma, { name: 'qualified', probability: 40, order: 1 }),
    (error) => error.code === 'PIPELINE_STAGE_EXISTS',
  );
  assert.equal(createCalls, 0);
});

test('pipeline stage rename rejects another tenant stage with the same name', async () => {
  let findCalls = 0;
  let updateCalls = 0;
  const prisma = {
    pipelineStage: {
      findFirst: async () => {
        findCalls += 1;
        return findCalls === 1 ? { id: 'stage-1' } : { id: 'stage-2' };
      },
      update: async () => { updateCalls += 1; },
    },
  };

  await assert.rejects(
    updateStage(prisma, 'stage-1', { name: 'Discovery' }),
    (error) => error.code === 'PIPELINE_STAGE_EXISTS',
  );
  assert.equal(updateCalls, 0);
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
    name: 'Packaging system', clientId: 'client-1', stageId: 'stage-1', value: 12000, currency: 'CAD',
    expectedCloseDate: '2026-10-01T00:00:00.000Z', notes: 'Human-reviewed scope only.',
  });

  assert.equal(result.id, 'deal-1');
  assert.deepEqual(createArgs.data, {
    title: 'Packaging system', clientId: 'client-1', stageId: 'stage-1', value: 12000, currency: 'CAD',
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

test('pipeline stage creation returns reviewed domain conflicts instead of a server error', () => {
  const routes = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'pipeline.routes.js'), 'utf8');
  const createRoute = routes.slice(
    routes.indexOf("fastify.post('/stages'"),
    routes.indexOf('// Update a stage'),
  );
  assert.match(createRoute, /try\s*{/);
  assert.match(createRoute, /handlePipelineError\(error, reply\)/);
});

test('deal creation contract requires a client and uses the page value field', () => {
  const accepted = pipelineDealCreateSchema.safeParse({
    name: 'Packaging system',
    clientId: 'cm12345678901234567890123',
    stageId: 'cm12345678901234567890124',
    value: 12000,
    currency: 'CAD',
  });
  const missingClient = pipelineDealCreateSchema.safeParse({
    name: 'Packaging system',
    stageId: 'cm12345678901234567890124',
    value: 12000,
  });
  assert.equal(accepted.success, true);
  assert.equal(missingClient.success, false);
});

test('deal creation requires an explicit supported currency', () => {
  const base = {
    name: 'Packaging system',
    clientId: 'cm12345678901234567890123',
    stageId: 'cm12345678901234567890124',
    value: 12000,
  };
  assert.equal(pipelineDealCreateSchema.safeParse(base).success, false);
  assert.equal(pipelineDealCreateSchema.safeParse({ ...base, currency: 'EUR' }).success, false);
  assert.equal(pipelineDealCreateSchema.safeParse({ ...base, currency: 'CAD' }).success, true);
  assert.equal(pipelineDealCreateSchema.safeParse({ ...base, currency: 'USD' }).success, true);
});

test('pipeline values are grouped by currency instead of being added together', async () => {
  const prisma = {
    pipelineStage: {
      findMany: async () => [{
        id: 'stage-1', name: 'Qualified', order: 1, color: '#123456', probability: 50,
        deals: [
          { id: 'deal-cad', title: 'Packaging', value: 12000, currency: 'CAD', client: { id: 'client-1', name: 'Example Foods' } },
          { id: 'deal-usd', title: 'Website', value: 8000, currency: 'USD', client: { id: 'client-2', name: 'Example Goods' } },
          { id: 'deal-legacy', title: 'Needs review', value: 500, currency: null, client: { id: 'client-3', name: 'Legacy Client' } },
        ],
      }],
    },
  };

  const [stage] = await getPipelineStages(prisma);

  assert.deepEqual(stage.valuesByCurrency, { CAD: 12000, USD: 8000, UNASSIGNED: 500 });
  assert.equal('value' in stage, false);
});

test('pipeline analytics reports currency totals separately', async () => {
  const prisma = {
    pipelineDeal: {
      groupBy: async () => [
        { currency: 'CAD', _sum: { value: 15000 } },
        { currency: 'USD', _sum: { value: 9000 } },
        { currency: null, _sum: { value: 500 } },
      ],
      aggregate: async () => ({ _avg: { probability: 35 } }),
      count: async ({ where } = {}) => where ? 1 : 4,
    },
  };

  const analytics = await getPipelineAnalytics(prisma);

  assert.deepEqual(analytics.totalPipelineValueByCurrency, { CAD: 15000, USD: 9000, UNASSIGNED: 500 });
  assert.equal('totalPipelineValue' in analytics, false);
});

test('pipeline stage contracts reject whitespace-only names', () => {
  assert.equal(pipelineStageCreateSchema.safeParse({ name: '   ' }).success, false);
  assert.equal(pipelineStageUpdateSchema.safeParse({ name: '\t' }).success, false);
});

test('pipeline page does not offer an ownerless deal', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'web', 'src', 'pages', 'Pipeline.jsx'), 'utf8');
  assert.doesNotMatch(page, /-- No client --/);
  assert.match(page, /htmlFor="pipeline-deal-client"[^>]*>Client</);
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
