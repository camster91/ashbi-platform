import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  HEALTH_HISTORY_LIMIT,
  nextHealthHistory,
  normalizeHealthHistory,
  updateAllProjectHealth,
} from '../../services/project.service.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 3_600_000);

function fakePrisma(projects) {
  const updates = [];
  let findArgs;
  return {
    updates,
    get findArgs() { return findArgs; },
    project: {
      findMany: async (args) => {
        findArgs = args;
        return projects.filter((project) => !args.where.status.notIn.includes(project.status));
      },
      update: async (args) => {
        // Prisma rejects `{ push }` on a Json? column; so does this fake.
        if (args.data.healthHistory && !Array.isArray(args.data.healthHistory)) {
          throw new Error('Json column update must be a full value');
        }
        updates.push(args);
        return args;
      },
    },
  };
}

test('health history is written as a full, capped array (not a scalar-list push)', async () => {
  const longHistory = Array.from({ length: HEALTH_HISTORY_LIMIT }, (_, index) => ({
    health: 'ON_TRACK',
    score: 100,
    timestamp: hoursAgo(1000 - index).toISOString(),
  }));
  const prisma = fakePrisma([
    { id: 'p1', status: 'DESIGN_DEV', health: 'ON_TRACK', healthScore: 100, healthHistory: null, threads: [
      { priority: 'CRITICAL', status: 'OPEN', lastActivityAt: hoursAgo(1) },
    ] },
    { id: 'p2', status: 'STARTING_UP', health: 'ON_TRACK', healthScore: 100, healthHistory: longHistory, threads: [] },
  ]);

  const updated = await updateAllProjectHealth(prisma, { now: NOW });
  assert.equal(updated, 2);
  const p1 = prisma.updates.find((u) => u.where.id === 'p1').data;
  assert.equal(p1.healthScore, 70);
  assert.equal(p1.health, 'NEEDS_ATTENTION');
  assert.deepEqual(p1.healthHistory, [{ health: 'NEEDS_ATTENTION', score: 70, timestamp: NOW.toISOString() }]);

  const p2 = prisma.updates.find((u) => u.where.id === 'p2').data;
  assert.equal(p2.healthHistory.length, HEALTH_HISTORY_LIMIT, 'capped at the limit');
  assert.equal(p2.healthHistory.at(-1).timestamp, NOW.toISOString());
  assert.equal(p2.healthHistory[0].timestamp, longHistory[1].timestamp, 'oldest point dropped');
});

test('only active projects are scored, and unchanged projects are not written', async () => {
  const recent = [{ health: 'ON_TRACK', score: 100, timestamp: hoursAgo(2).toISOString() }];
  const prisma = fakePrisma([
    { id: 'steady', status: 'DESIGN_DEV', health: 'ON_TRACK', healthScore: 100, healthHistory: recent, threads: [] },
    { id: 'launched', status: 'LAUNCHED', health: 'ON_TRACK', healthScore: 10, healthHistory: null, threads: [] },
    { id: 'cancelled', status: 'CANCELLED', health: 'ON_TRACK', healthScore: 10, healthHistory: null, threads: [] },
    { id: 'completed', status: 'COMPLETED', health: 'ON_TRACK', healthScore: 10, healthHistory: null, threads: [] },
  ]);
  const updated = await updateAllProjectHealth(prisma, { now: NOW });
  assert.equal(updated, 0);
  assert.deepEqual(prisma.findArgs.where, { status: { notIn: ['LAUNCHED', 'COMPLETED', 'CANCELLED'] } });
});

test('history appends on change or after a day, never on an unchanged hour', () => {
  const point = (health, score, at) => ({ health, score, timestamp: at.toISOString() });
  const base = [point('ON_TRACK', 100, hoursAgo(3))];
  assert.equal(nextHealthHistory(base, point('ON_TRACK', 100, NOW), { now: NOW.getTime() }), null);
  assert.equal(nextHealthHistory(base, point('ON_TRACK', 90, NOW), { now: NOW.getTime() }).length, 2);
  const dayOld = [point('ON_TRACK', 100, hoursAgo(25))];
  assert.equal(nextHealthHistory(dayOld, point('ON_TRACK', 100, NOW), { now: NOW.getTime() }).length, 2);
  assert.deepEqual(normalizeHealthHistory({ not: 'an array' }), []);
  // The legacy `{ push: point }` value the old code stored is recovered.
  assert.deepEqual(normalizeHealthHistory({ push: point('AT_RISK', 40, NOW) }), [point('AT_RISK', 40, NOW)]);
  assert.deepEqual(normalizeHealthHistory([null, { score: 1 }, point('AT_RISK', 1, NOW)]), [point('AT_RISK', 1, NOW)]);
});

test('the health-history route always returns an array and 404s unknown projects', () => {
  const routes = fs.readFileSync(new URL('../../routes/project.routes.js', import.meta.url), 'utf8');
  const handler = routes.slice(routes.indexOf("'/:id/health-history'"), routes.indexOf('// ==================== COMMUNICATIONS'));
  assert.match(handler, /normalizeHealthHistory\(project\.healthHistory\)/);
  assert.match(handler, /status\(404\)/);
  assert.doesNotMatch(handler, /prisma\.project\.update/, 'GET does not write');
  const service = fs.readFileSync(new URL('../../services/project.service.js', import.meta.url), 'utf8');
  assert.doesNotMatch(service, /healthHistory:\s*\{\s*push/);
});
