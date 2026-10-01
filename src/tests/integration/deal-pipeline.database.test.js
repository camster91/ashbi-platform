import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { enterRequestContext } from '../../utils/request-context.js';
import pipelineRoutes from '../../routes/pipeline.routes.js';
import { DEFAULT_PIPELINE_STAGES, ensureDefaultStages, wonStageFor } from '../../services/dealPipeline.service.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

// The deal pipeline: an organization's first GET /pipeline creates the
// default stages exactly once (even under concurrent first reads), deals are
// created with the PipelineDeal field names, and nothing crosses tenants.
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

async function buildApp(raw, org, user) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: user, role: 'ADMIN', organizationId: org }; });
  const scoped = createScopedPrisma(raw, org);
  app.addHook('onRequest', async (request) => {
    request.prisma = scoped;
    request.organizationId = org;
    enterRequestContext({ prisma: scoped, organizationId: org });
  });
  await app.register(pipelineRoutes, { prefix: '/api/pipeline' });
  return app;
}

test('the deal pipeline seeds default stages once and creates tenant-scoped deals', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const s = randomUUID();
  const ids = {
    org: `pipe-org-${s}`, other: `pipe-other-${s}`, bg: `pipe-bg-${s}`, custom: `pipe-custom-${s}`,
    gone: `pipe-gone-${s}`,
    client: `pipe-client-${s}`, otherClient: `pipe-oclient-${s}`,
    user: `pipe-user-${s}`, otherUser: `pipe-ouser-${s}`,
  };
  let app;
  let otherApp;
  try {
    await raw.organization.createMany({ data: [
      { id: ids.org, name: 'Pipeline', slug: `pipe-${s}` },
      { id: ids.other, name: 'Other', slug: `pipe-other-${s}` },
      { id: ids.bg, name: 'Background', slug: `pipe-bg-${s}` },
      { id: ids.custom, name: 'Custom', slug: `pipe-custom-${s}` },
    ] });
    await raw.client.createMany({ data: [
      { id: ids.client, name: 'Pipeline client', organizationId: ids.org },
      { id: ids.otherClient, name: 'Other client', organizationId: ids.other },
      { id: ids.gone, name: 'Deleted client', organizationId: ids.org },
    ] });
    await raw.user.createMany({ data: [
      { id: ids.user, email: `${ids.user}@example.com`, name: 'u', password: 'x', role: 'ADMIN', organizationId: ids.org },
      { id: ids.otherUser, email: `${ids.otherUser}@example.com`, name: 'o', password: 'x', role: 'ADMIN', organizationId: ids.other },
    ] });

    app = await buildApp(raw, ids.org, ids.user);
    otherApp = await buildApp(raw, ids.other, ids.otherUser);

    // Concurrent first reads: the advisory lock lets exactly one seed.
    const scoped = createScopedPrisma(raw, ids.org);
    const seeded = await Promise.all(Array.from({ length: 5 }, () => ensureDefaultStages(scoped, ids.org)));
    assert.equal(seeded.filter(Boolean).length, 1, 'exactly one concurrent call creates the defaults');

    const first = await app.inject({ method: 'GET', url: '/api/pipeline' });
    assert.equal(first.statusCode, 200, first.body);
    const stages = first.json();
    assert.deepEqual(stages.map((stage) => stage.name), DEFAULT_PIPELINE_STAGES.map((stage) => stage.name));
    assert.ok(stages.every((stage) => Array.isArray(stage.deals) && stage.deals.length === 0));
    assert.equal(await raw.pipelineStage.count({ where: { organizationId: ids.org } }), DEFAULT_PIPELINE_STAGES.length);

    // Re-reading never re-seeds; neither does an org that removed a default.
    await app.inject({ method: 'GET', url: '/api/pipeline' });
    assert.equal(await raw.pipelineStage.count({ where: { organizationId: ids.org } }), DEFAULT_PIPELINE_STAGES.length);

    // Create a deal with the model's field names.
    const created = await app.inject({
      method: 'POST',
      url: '/api/pipeline/deals',
      payload: { title: 'Website redesign', value: 12000, clientId: ids.client, stageId: stages[0].id },
    });
    assert.equal(created.statusCode, 201, created.body);
    const deal = created.json();
    assert.equal(deal.title, 'Website redesign');
    assert.equal(deal.value, 12000);
    assert.equal(deal.client.id, ids.client);
    assert.equal(deal.stage.id, stages[0].id);
    assert.equal(deal.probability, DEFAULT_PIPELINE_STAGES[0].probability, 'a new deal takes its stage\'s probability');

    const explicit = await app.inject({
      method: 'POST', url: '/api/pipeline/deals',
      payload: { title: 'Explicit', clientId: ids.client, stageId: stages[0].id, probability: 40 },
    });
    assert.equal(explicit.statusCode, 201, explicit.body);
    assert.equal(explicit.json().probability, 40, 'an explicit probability wins');
    await raw.pipelineDeal.delete({ where: { id: explicit.json().id } });

    // The legacy name/amount payload and a missing client are rejected (400), not a 500.
    const legacy = await app.inject({
      method: 'POST',
      url: '/api/pipeline/deals',
      payload: { name: 'Legacy', amount: 5, clientId: ids.client, stageId: stages[0].id },
    });
    assert.equal(legacy.statusCode, 400, legacy.body);
    const noClient = await app.inject({
      method: 'POST',
      url: '/api/pipeline/deals',
      payload: { title: 'No client', stageId: stages[0].id },
    });
    assert.equal(noClient.statusCode, 400, noClient.body);

    // GET returns the deal under its stage.
    const board = (await app.inject({ method: 'GET', url: '/api/pipeline' })).json();
    assert.deepEqual(board[0].deals.map((d) => d.id), [deal.id]);
    assert.equal(board[0].deals[0].client.name, 'Pipeline client');

    // Move it to another stage.
    const moved = await app.inject({ method: 'PUT', url: `/api/pipeline/deals/${deal.id}`, payload: { stageId: stages[1].id, value: 15000 } });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.equal(moved.json().stageId, stages[1].id);
    assert.equal(moved.json().value, 15000);
    assert.equal(moved.json().probability, DEFAULT_PIPELINE_STAGES[1].probability, 'moving takes the destination stage\'s probability');

    // A soft-deleted client's deals are off the board and out of the totals.
    await raw.pipelineDeal.create({ data: { title: 'Hidden', value: 999, clientId: ids.gone, stageId: stages[1].id, probability: 100 } });
    await raw.client.update({ where: { id: ids.gone }, data: { deletedAt: new Date() } });
    const visible = (await app.inject({ method: 'GET', url: '/api/pipeline' })).json();
    assert.deepEqual(visible[1].deals.map((d) => d.id), [deal.id]);
    const analytics = (await app.inject({ method: 'GET', url: '/api/pipeline/analytics' })).json();
    assert.equal(analytics.totalDeals, 1);
    assert.equal(analytics.totalPipelineValue, 15000);
    assert.equal(analytics.wonDeals, 0);
    assert.equal(analytics.stages[1]._count.deals, 1);

    // Another tenant gets its own stages and cannot see or reach this one's.
    const otherBoard = (await otherApp.inject({ method: 'GET', url: '/api/pipeline' })).json();
    assert.equal(otherBoard.length, DEFAULT_PIPELINE_STAGES.length);
    assert.ok(otherBoard.every((stage) => !stages.some((own) => own.id === stage.id)));
    assert.ok(otherBoard.every((stage) => stage.deals.length === 0));

    const crossClient = await app.inject({
      method: 'POST', url: '/api/pipeline/deals',
      payload: { title: 'Cross client', clientId: ids.otherClient, stageId: stages[0].id },
    });
    assert.equal(crossClient.statusCode, 404, crossClient.body);
    const crossStage = await app.inject({
      method: 'POST', url: '/api/pipeline/deals',
      payload: { title: 'Cross stage', clientId: ids.client, stageId: otherBoard[0].id },
    });
    assert.equal(crossStage.statusCode, 404, crossStage.body);
    const crossMove = await otherApp.inject({ method: 'PUT', url: `/api/pipeline/deals/${deal.id}`, payload: { title: 'Hijack' } });
    assert.equal(crossMove.statusCode, 404, crossMove.body);

    // A stage that still holds deals cannot be deleted without a destination.
    const blocked = await app.inject({ method: 'DELETE', url: `/api/pipeline/stages/${stages[1].id}` });
    assert.equal(blocked.statusCode, 409, blocked.body);
    const removed = await app.inject({ method: 'DELETE', url: `/api/pipeline/stages/${stages[1].id}?moveToStageId=${stages[2].id}` });
    assert.equal(removed.statusCode, 200, removed.body);
    const relocated = await raw.pipelineDeal.findUnique({ where: { id: deal.id } });
    assert.equal(relocated.stageId, stages[2].id);
    assert.equal(relocated.probability, DEFAULT_PIPELINE_STAGES[2].probability);

    // Having removed a default stage, the org is not re-seeded.
    await app.inject({ method: 'GET', url: '/api/pipeline' });
    assert.equal(await raw.pipelineStage.count({ where: { organizationId: ids.org } }), DEFAULT_PIPELINE_STAGES.length - 1);

    // Approved-proposal automation runs without a request scope: it seeds an
    // organization's stages and picks the won stage (probability 100) ...
    const bgWon = await wonStageFor(raw, ids.bg);
    const bgStages = await raw.pipelineStage.findMany({ where: { organizationId: ids.bg } });
    assert.equal(bgStages.length, DEFAULT_PIPELINE_STAGES.length);
    assert.equal(bgStages.find((stage) => stage.id === bgWon.id).name, 'Won');
    // ... or, without one, the highest-order stage of that organization only.
    await raw.pipelineStage.createMany({ data: [
      { organizationId: ids.custom, name: 'Open', order: 0, probability: 20 },
      { organizationId: ids.custom, name: 'Signed', order: 5, probability: 90 },
    ] });
    const customWon = await wonStageFor(raw, ids.custom);
    assert.equal((await raw.pipelineStage.findUnique({ where: { id: customWon.id } })).name, 'Signed');
  } finally {
    await app?.close();
    await otherApp?.close();
    await raw.pipelineDeal.deleteMany({ where: { clientId: { in: [ids.client, ids.otherClient, ids.gone] } } });
    await raw.pipelineStage.deleteMany({ where: { organizationId: { in: [ids.org, ids.other, ids.bg, ids.custom] } } });
    await raw.user.deleteMany({ where: { id: { in: [ids.user, ids.otherUser] } } });
    await raw.client.deleteMany({ where: { id: { in: [ids.client, ids.otherClient, ids.gone] } } });
    await purgeFixtureAuditEvents(raw, { ids: [ids.org, ids.other, ids.bg, ids.custom] });
    await raw.organization.deleteMany({ where: { id: { in: [ids.org, ids.other, ids.bg, ids.custom] } } });
    await raw.$disconnect();
  }
});
