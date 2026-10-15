import test from 'node:test';
import assert from 'node:assert/strict';
import { expireClientAgentRuns } from '../../jobs/client-agent-run-recovery.js';
import { requestStorage } from '../../utils/request-context.js';

const at = new Date('2026-10-15T21:00:00Z');
function fixture() {
  const rows = [
    { id: 'expired', organizationId: 'org-a', status: 'RUNNING', deadlineAt: new Date(+at - 1), claimToken: 'one' },
    { id: 'boundary', organizationId: 'org-a', status: 'RUNNING', deadlineAt: at, claimToken: 'two' },
    { id: 'live', organizationId: 'org-a', status: 'RUNNING', deadlineAt: new Date(+at + 1) },
    { id: 'foreign', organizationId: 'org-b', status: 'RUNNING', deadlineAt: new Date(+at - 1) },
    ...['QUEUED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'].map(status => ({ id: status, organizationId: 'org-a', status, deadlineAt: new Date(+at - 1) })),
    { id: 'queue-expired', organizationId: 'org-a', status: 'QUEUED', createdAt: new Date(+at - 600_001) },
    { id: 'queue-boundary', organizationId: 'org-a', status: 'QUEUED', createdAt: new Date(+at - 600_000) },
    { id: 'queue-recent', organizationId: 'org-a', status: 'QUEUED', createdAt: new Date(+at - 599_999) },
    { id: 'foreign-queue', organizationId: 'org-b', status: 'QUEUED', createdAt: new Date(+at - 600_001) },
  ];
  const calls = [];
  const prisma = { clientAgentRun: { updateMany: async args => {
    calls.push(args); let count = 0;
    const field = args.where.deadlineAt ? 'deadlineAt' : 'createdAt';
    for (const row of rows) if (row.organizationId === args.where.organizationId && row.status === args.where.status
      && row[field] && +row[field] <= +args.where[field].lte) { Object.assign(row, args.data); count++; }
    return { count };
  } } };
  const expire = () => requestStorage.run({ prisma, organizationId: 'org-a' }, () => expireClientAgentRuns(prisma, 'org-a', { now: () => at }));
  return { rows, calls, prisma, expire };
}

test('expiry finalizes only tenant expired RUNNING and ten-minute QUEUED rows without requeue', async () => {
  const f = fixture(), before = structuredClone(f.rows);
  assert.deepEqual(await f.expire(), { expired: 2, queueExpired: 2 });
  assert.deepEqual(f.calls[0], { where: { organizationId: 'org-a', status: 'RUNNING', deadlineAt: { lte: at } },
    data: { status: 'UNKNOWN', errorCode: 'RUN_DEADLINE_EXCEEDED', finishedAt: at } });
  assert.equal(f.rows[0].claimToken, 'one'); assert.equal(f.rows[1].claimToken, 'two');
  assert.deepEqual(f.calls[1], { where: { organizationId: 'org-a', status: 'QUEUED', createdAt: { lte: new Date(+at - 600_000) } },
    data: { status: 'FAILED', errorCode: 'RUN_QUEUE_EXPIRED', finishedAt: at } });
  const expired = new Set(['expired', 'boundary', 'queue-expired', 'queue-boundary']);
  assert.deepEqual(f.rows.filter(row => !expired.has(row.id)), before.filter(row => !expired.has(row.id)));
  for (const id of ['queue-expired', 'queue-boundary']) {
    const row = f.rows.find(item => item.id === id);
    assert.equal(row.status, 'FAILED'); assert.equal(row.errorCode, 'RUN_QUEUE_EXPIRED');
    assert.equal(row.claimToken, undefined);
  }
  assert.deepEqual(await f.expire(), { expired: 0, queueExpired: 0 });
});

test('a queued run claimed before queue expiry mutation is not failed by its stale age', async () => {
  const f = fixture();
  const update = f.prisma.clientAgentRun.updateMany;
  f.prisma.clientAgentRun.updateMany = async args => {
    if (args.where.status === 'QUEUED') Object.assign(f.rows.find(row => row.id === 'queue-expired'), {
      status: 'RUNNING', claimToken: 'late-claim', deadlineAt: new Date(+at + 120_000),
    });
    return update(args);
  };
  assert.deepEqual(await f.expire(), { expired: 2, queueExpired: 1 });
  const claimed = f.rows.find(row => row.id === 'queue-expired');
  assert.equal(claimed.status, 'RUNNING'); assert.equal(claimed.claimToken, 'late-claim');
  assert.equal(claimed.errorCode, undefined);
});

test('missing tenant or exact scoped client mismatch denies before mutation', async () => {
  const f = fixture();
  await assert.rejects(expireClientAgentRuns(f.prisma, 'org-a'), { code: 'TENANT_CONTEXT_REQUIRED' });
  await assert.rejects(requestStorage.run({ prisma: f.prisma, organizationId: 'org-b' }, () => expireClientAgentRuns(f.prisma, 'org-a')), { code: 'TENANT_CONTEXT_REQUIRED' });
  await assert.rejects(requestStorage.run({ prisma: {}, organizationId: 'org-a' }, () => expireClientAgentRuns(f.prisma, 'org-a')), { code: 'TENANT_CONTEXT_REQUIRED' });
  assert.deepEqual(f.calls, []);
});

test('database failure propagates without retry or provider calls', async () => {
  const f = fixture(); let calls = 0;
  f.prisma.clientAgentRun.updateMany = async () => { calls++; throw Error('Database unavailable'); };
  await assert.rejects(f.expire(), /Database unavailable/); assert.equal(calls, 1);
});

test('invalid clock refuses before mutation', async () => {
  const f = fixture();
  await assert.rejects(requestStorage.run({ prisma: f.prisma, organizationId: 'org-a' },
    () => expireClientAgentRuns(f.prisma, 'org-a', { now: () => new Date('invalid') })), /valid time/);
  assert.deepEqual(f.calls, []);
});
