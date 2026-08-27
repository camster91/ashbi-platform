import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { summarizeLeadAcquisition } from '../../services/lead-acquisition-summary.service.js';

test('lead acquisition summary separates source evidence and follow-up gaps', async () => {
  const calls = [];
  const transaction = {
    lead: {
      count: async ({ where } = {}) => {
        calls.push(where ?? null);
        if (!where) return 12;
        if (where.source === null) return 3;
        if (where.nextActionDueAt?.lt) return 2;
        if (where.OR) return 1;
        return 5;
      },
      groupBy: async ({ by }) => {
        if (by[0] === 'status') return [{ status: 'NEW', _count: { _all: 4 } }, { status: 'QUALIFIED', _count: { _all: 3 } }];
        if (by[0] === 'serviceLine') return [{ serviceLine: 'brand_packaging', _count: { _all: 7 } }];
        return [{ source: null, _count: { _all: 3 } }, { source: 'linkedin', _count: { _all: 4 } }];
      },
    },
  };
  const now = new Date('2026-08-27T01:00:00.000Z');
  const result = await summarizeLeadAcquisition({
    prisma: { $transaction: async (operation) => operation(transaction) },
    now,
  });

  assert.deepEqual(result, {
    asOf: now.toISOString(),
    total: 12,
    attribution: { sourceCaptured: 9, sourceMissing: 3 },
    followUp: { scheduled: 5, overdue: 2, unscheduled: 1 },
    byStatus: [{ key: 'NEW', count: 4 }, { key: 'QUALIFIED', count: 3 }],
    byServiceLine: [{ key: 'brand_packaging', count: 7 }],
    bySource: [{ key: 'linkedin', count: 4 }, { key: 'UNATTRIBUTED', count: 3 }],
  });
  assert.equal(calls.some((where) => where?.status?.in?.includes('CONVERTED')), false);
});

test('staff acquisition summary is routed before the lead id route', () => {
  const routes = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'client-acquisition.routes.js'), 'utf8');
  const summary = routes.indexOf("fastify.get('/leads/summary'");
  const detail = routes.indexOf("fastify.get('/leads/:id'");
  assert.ok(summary > -1);
  assert.ok(detail > summary);
  assert.match(routes, /summarizeLeadAcquisition\(\{ prisma: request\.prisma/);
});
