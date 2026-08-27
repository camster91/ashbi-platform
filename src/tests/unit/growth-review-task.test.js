import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = await import('../../services/growth-review-task.service.js').catch(() => ({}));
const schemas = await import('../../validators/schemas.js');

const input = {
  organizationId: 'org-1',
  projectId: 'cmproject123456789012345678',
  assigneeId: 'cmassignee1234567890123456',
  actorUserId: 'cmactor1234567890123456789',
  weekOf: '2026-08-24',
  action: 'Publish the reviewed packaging case study draft after approval.',
  dueDate: '2026-08-28T20:00:00.000Z',
  sourceCoverageReviewed: true,
  currenciesSeparated: true,
  missingAttributionDisclosed: true,
  externalActionState: 'PENDING',
};

function summary(days) {
  return {
    asOf: '2026-08-26T16:00:00.000Z',
    window: { days, from: '2026-01-01T00:00:00.000Z' },
    total: days === 30 ? 4 : 9,
    attribution: { sourceCaptured: days === 30 ? 3 : 7, sourceMissing: days === 30 ? 1 : 2 },
    followUp: { scheduled: 3, overdue: 1, unscheduled: 1 },
    byStatus: [{ key: 'REVIEWING', count: 2 }],
    byServiceLine: [{ key: days === 30 ? 'brand_packaging' : 'web_commerce', count: days === 30 ? 3 : 5 }],
    bySource: [{ key: days === 30 ? 'referral' : 'upwork', count: days === 30 ? 2 : 4 }],
  };
}

function createHarness(seed = {}) {
  const calls = { creates: [], summaryDays: [] };
  let existing = seed.existing ?? null;
  const prisma = {
    project: {
      findFirst: async () => Object.hasOwn(seed, 'project')
        ? seed.project
        : { id: input.projectId, organizationId: input.organizationId, name: 'Growth' },
    },
    user: {
      findFirst: async () => Object.hasOwn(seed, 'assignee')
        ? seed.assignee
        : { id: input.assigneeId, organizationId: input.organizationId, name: 'Cameron', isActive: true },
    },
    task: {
      findUnique: async () => existing,
      create: async ({ data, include }) => {
        calls.creates.push({ data, include });
        existing = {
          id: 'task-growth-1',
          ...data,
          project: { id: input.projectId, name: 'Growth' },
          assignee: { id: input.assigneeId, name: 'Cameron' },
        };
        return existing;
      },
    },
  };
  const summarize = async ({ days }) => {
    calls.summaryDays.push(days);
    return summary(days);
  };
  return { prisma, calls, summarize, getExisting: () => existing };
}

test('growth review input requires a Monday, bounded action, owner, project, and due date', () => {
  assert.equal(typeof schemas.growthReviewTaskSchema?.safeParse, 'function');
  assert.equal(schemas.growthReviewTaskSchema.safeParse({}).success, false);
  assert.equal(schemas.growthReviewTaskSchema.safeParse({
    projectId: input.projectId,
    assigneeId: input.assigneeId,
    weekOf: '2026-08-25',
    action: input.action,
    dueDate: input.dueDate,
  }).success, false);
  assert.equal(schemas.growthReviewTaskSchema.safeParse({
    projectId: input.projectId,
    assigneeId: input.assigneeId,
    weekOf: '2026-02-30',
    action: input.action,
    dueDate: input.dueDate,
  }).success, false);
  assert.equal(schemas.growthReviewTaskSchema.safeParse({
    projectId: input.projectId,
    assigneeId: input.assigneeId,
    weekOf: input.weekOf,
    action: input.action,
    dueDate: '2026-08-23T20:00:00.000Z',
  }).success, false);
  assert.equal(schemas.growthReviewTaskSchema.safeParse(input).success, false);
  const validRouteInput = { ...input };
  delete validRouteInput.organizationId;
  delete validRouteInput.actorUserId;
  assert.equal(schemas.growthReviewTaskSchema.safeParse(validRouteInput).success, true);
  assert.equal(schemas.growthReviewTaskSchema.safeParse({
    projectId: input.projectId,
    assigneeId: input.assigneeId,
    weekOf: input.weekOf,
    action: input.action,
    dueDate: '2026-08-31T00:00:00.000Z',
    sourceCoverageReviewed: true,
    currenciesSeparated: true,
    missingAttributionDisclosed: true,
    externalActionState: 'NOT_REQUIRED',
  }).success, false);
});

test('weekly review creates one owned Hub task with 30-day and 90-day evidence', async () => {
  assert.equal(typeof service.createWeeklyGrowthReviewTask, 'function');
  const { prisma, calls, summarize } = createHarness();

  const result = await service.createWeeklyGrowthReviewTask({
    prisma,
    summarize,
    now: new Date('2026-08-26T16:00:00.000Z'),
    ...input,
  });

  assert.equal(result.idempotent, false);
  assert.deepEqual(calls.summaryDays, [30, 90]);
  assert.equal(calls.creates.length, 1);
  const created = calls.creates[0].data;
  assert.equal(created.projectId, input.projectId);
  assert.equal(created.assigneeId, input.assigneeId);
  assert.equal(created.status, 'PENDING');
  assert.equal(created.category, 'THIS_WEEK');
  assert.equal(created.priority, 'HIGH');
  assert.equal(created.growthReviewKey, 'growth-review:org-1:2026-08-24');
  assert.match(created.description, /30-day evidence/i);
  assert.match(created.description, /90-day evidence/i);
  assert.match(created.description, /missing attribution/i);
  assert.match(created.description, /overdue follow-up/i);
  assert.match(created.description, /Internal task only/i);
  const properties = JSON.parse(created.properties);
  assert.equal(properties.source, 'ASHBI_GROWTH_REVIEW');
  assert.equal(properties.weekOf, input.weekOf);
  assert.equal(properties.action, input.action);
  assert.equal(properties.evidence.thirtyDays.total, 4);
  assert.equal(properties.evidence.ninetyDays.total, 9);
  assert.deepEqual(properties.reviewAttestations, {
    sourceCoverageReviewed: true,
    currenciesSeparated: true,
    missingAttributionDisclosed: true,
    externalActionState: 'PENDING',
  });
  assert.equal(properties.evidence.thirtyDays.window.days, 30);
});

test('an exact replay returns the existing weekly task without another write', async () => {
  const firstHarness = createHarness();
  const first = await service.createWeeklyGrowthReviewTask({
    prisma: firstHarness.prisma,
    summarize: firstHarness.summarize,
    now: new Date('2026-08-26T16:00:00.000Z'),
    ...input,
  });
  const replayHarness = createHarness({ existing: first.task });

  const replay = await service.createWeeklyGrowthReviewTask({
    prisma: replayHarness.prisma,
    summarize: replayHarness.summarize,
    now: new Date('2026-08-26T18:00:00.000Z'),
    ...input,
  });

  assert.equal(replay.idempotent, true);
  assert.equal(replay.task.id, first.task.id);
  assert.equal(replayHarness.calls.creates.length, 0);
  assert.deepEqual(replayHarness.calls.summaryDays, []);
});

test('a different action for the same week conflicts instead of replacing evidence', async () => {
  const firstHarness = createHarness();
  const first = await service.createWeeklyGrowthReviewTask({
    prisma: firstHarness.prisma,
    summarize: firstHarness.summarize,
    now: new Date('2026-08-26T16:00:00.000Z'),
    ...input,
  });
  const conflictHarness = createHarness({ existing: first.task });

  await assert.rejects(
    service.createWeeklyGrowthReviewTask({
      prisma: conflictHarness.prisma,
      summarize: conflictHarness.summarize,
      now: new Date('2026-08-26T18:00:00.000Z'),
      ...input,
      action: 'Run a different prospecting experiment this week.',
    }),
    (error) => error.code === 'GROWTH_REVIEW_CONFLICT' && error.statusCode === 409,
  );
  assert.equal(conflictHarness.calls.creates.length, 0);
});

test('growth review refuses unowned projects and inactive or unowned assignees', async () => {
  for (const seed of [
    { project: null },
    { assignee: null },
    { assignee: { id: input.assigneeId, organizationId: input.organizationId, isActive: false } },
  ]) {
    const harness = createHarness(seed);
    await assert.rejects(
      service.createWeeklyGrowthReviewTask({
        prisma: harness.prisma,
        summarize: harness.summarize,
        now: new Date('2026-08-26T16:00:00.000Z'),
        ...input,
      }),
      (error) => ['GROWTH_PROJECT_NOT_FOUND', 'GROWTH_OWNER_NOT_FOUND'].includes(error.code),
    );
    assert.equal(harness.calls.creates.length, 0);
  }
});

test('database and route boundaries make the weekly handoff replay safe and staff-only', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
  const migration = fs.readFileSync('prisma/migrations/20260827015000_growth_review_task_key/migration.sql', 'utf8');
  const routes = fs.readFileSync('src/routes/client-acquisition.routes.js', 'utf8');

  const taskModel = schema.match(/model Task \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(taskModel, /growthReviewKey\s+String\?\s+@unique/);
  assert.match(migration, /ADD COLUMN\s+"growthReviewKey" TEXT/);
  assert.match(migration, /CREATE UNIQUE INDEX "tasks_growthReviewKey_key"/);
  assert.match(routes, /post\('\/leads\/growth-review-task'/);
  assert.match(routes, /staffOnly, validateBody\(growthReviewTaskSchema\)/);
  assert.match(routes, /createWeeklyGrowthReviewTask/);
});

test('operating documentation distinguishes code presence from completed weekly reviews', () => {
  const cadence = fs.readFileSync('docs/strategy/growth-operating-cadence.md', 'utf8');
  const status = fs.readFileSync('docs/product-status.md', 'utf8');

  assert.match(cadence, /Weekly growth action/);
  assert.match(cadence, /one task per organization and Monday-starting week/i);
  assert.match(cadence, /exact replay reuses/i);
  assert.match(cadence, /does not prove that a weekly review occurred/i);
  assert.match(status, /weekly growth-review task handoff is code-present locally/i);
  assert.match(status, /four consecutive cadence reviews.*pending/i);
});
