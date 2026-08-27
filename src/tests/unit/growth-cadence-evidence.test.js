import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildGrowthCadenceEvidence } from '../../services/growthCadenceEvidence.service.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function task(weekStart, index = 0) {
  const week = Date.parse(`${weekStart}T00:00:00.000Z`);
  const captured = week + 2 * DAY_MS;
  const properties = {
    source: 'ASHBI_GROWTH_REVIEW',
    weekOf: weekStart,
    action: `Complete evidenced growth action ${index}`,
    capturedAt: new Date(captured).toISOString(),
    reviewAttestations: {
      sourceCoverageReviewed: true,
      currenciesSeparated: true,
      missingAttributionDisclosed: true,
      externalActionState: index === 0 ? 'PENDING' : 'NOT_REQUIRED',
    },
    evidence: {
      thirtyDays: {
        asOf: new Date(captured).toISOString(),
        window: { days: 30, from: new Date(captured - 30 * DAY_MS).toISOString() },
        total: 4,
        sourceMissing: 1,
      },
      ninetyDays: {
        asOf: new Date(captured).toISOString(),
        window: { days: 90, from: new Date(captured - 90 * DAY_MS).toISOString() },
        total: 9,
        sourceMissing: 2,
      },
    },
  };
  return {
    id: `growth-task-${index}`,
    growthReviewKey: `growth-review:org-1:${weekStart}`,
    status: 'COMPLETED',
    assigneeId: 'owner-1',
    dueDate: new Date(week + 4 * DAY_MS + 17 * 60 * 60 * 1000),
    completedAt: new Date(week + 4 * DAY_MS + 18 * 60 * 60 * 1000),
    properties: JSON.stringify(properties),
  };
}

function fixture() {
  const first = Date.parse('2026-01-05T00:00:00.000Z');
  return Array.from({ length: 4 }, (_, index) => task(
    new Date(first + index * WEEK_MS).toISOString().slice(0, 10),
    index,
  ));
}

test('growth cadence evidence is derived from four completed consecutive attested Hub tasks', () => {
  const evidence = buildGrowthCadenceEvidence({
    organizationId: ' org-1 ',
    firstWeek: '2026-01-05',
    tasks: fixture(),
    generatedAt: new Date('2026-02-02T00:00:00.000Z'),
  });
  assert.equal(evidence.format, 'ashbi-growth-cadence-evidence');
  assert.equal(evidence.complete, true);
  assert.equal(evidence.organizationId, 'org-1');
  assert.equal(evidence.weeklyReviews.length, 4);
  assert.deepEqual(evidence.weeklyReviews.map(review => review.weekStart), [
    '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26',
  ]);
  assert.equal(evidence.baseline.sourceCoverageReviewed, true);
  assert.equal(evidence.baseline.currenciesSeparated, true);
  assert.equal(evidence.baseline.missingAttributionDisclosed, true);
  assert.equal(evidence.baseline.sourceMissing, 1);
  assert.equal(evidence.weeklyReviews[0].externalActionState, 'PENDING');
});

test('growth cadence evidence refuses incomplete, legacy, out-of-week, or gapped task evidence', () => {
  const cases = [
    tasks => { tasks[0].status = 'IN_PROGRESS'; },
    tasks => { const value = JSON.parse(tasks[0].properties); delete value.reviewAttestations; tasks[0].properties = JSON.stringify(value); },
    tasks => { tasks[0].completedAt = new Date('2026-01-12T00:00:00.000Z'); },
    tasks => { tasks.splice(1, 1); },
    tasks => { const value = JSON.parse(tasks[0].properties); delete value.evidence.thirtyDays.window; tasks[0].properties = JSON.stringify(value); },
  ];
  for (const mutate of cases) {
    const tasks = fixture();
    mutate(tasks);
    assert.throws(() => buildGrowthCadenceEvidence({
      organizationId: 'org-1', firstWeek: '2026-01-05', tasks,
      generatedAt: new Date('2026-02-02T00:00:00.000Z'),
    }));
  }
});

test('growth cadence exporter is tenant-scoped, read-only, explicit, and package-addressable', () => {
  const script = fs.readFileSync('scripts/export-growth-cadence-evidence.mjs', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(script, /process\.argv\.includes\('--confirm'\)/);
  assert.match(script, /project: \{ organizationId, deletedAt: null \}/);
  assert.match(script, /prisma\.task\.findMany/);
  assert.doesNotMatch(script, /prisma\.task\.(?:create|update|delete|upsert)/);
  assert.match(script, /fs\.openSync\(output, 'wx', 0o600\)/);
  assert.equal(packageJson.scripts['export:growth-cadence-evidence'], 'node scripts/export-growth-cadence-evidence.mjs');
});
