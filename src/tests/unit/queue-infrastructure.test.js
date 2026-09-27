import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_QUEUES,
  closeQueueInfrastructure,
  DEFAULT_JOB_RETENTION,
  guardProducerAdd,
  PRODUCER_REDIS_OPTIONS,
  QUEUES,
  QueueUnavailableError,
  redisConnectionArgs,
  resolveRedisUrl,
  WORKER_REDIS_OPTIONS,
} from '../../jobs/queue.js';

test('every queue retains completed and failed jobs for a bounded time', () => {
  assert.equal(ALL_QUEUES.length, Object.keys(QUEUES).length, 'every named queue is created with defaults');
  assert.deepEqual(DEFAULT_JOB_RETENTION.removeOnComplete, { age: 86_400, count: 1000 });
  assert.deepEqual(DEFAULT_JOB_RETENTION.removeOnFail, { age: 14 * 86_400 });
  for (const queue of ALL_QUEUES) {
    assert.deepEqual(queue.defaultJobOptions.removeOnComplete, { age: 86_400, count: 1000 }, queue.name);
    assert.deepEqual(queue.defaultJobOptions.removeOnFail, { age: 14 * 86_400 }, queue.name);
  }
});

test('REDIS_URL forms are passed to ioredis intact (auth, ACL user, db index, TLS)', () => {
  const cases = [
    ['redis://localhost:6379', false],
    ['redis://:p%40ss%3Aword@redis.internal:6380/2', false],
    ['redis://default:secret@redis.internal:6379/0', false],
    ['rediss://user:secret@managed.example.com:25061', true],
    ['redis://redis', false],
  ];
  for (const [url, tls] of cases) {
    assert.deepEqual(resolveRedisUrl(url, { production: true }), { url, tls }, url);
  }
  const [url, options] = redisConnectionArgs('rediss://user:secret@managed.example.com:25061', { maxRetriesPerRequest: null }, { production: true });
  assert.equal(url, 'rediss://user:secret@managed.example.com:25061');
  assert.deepEqual(options, { tls: {}, maxRetriesPerRequest: null });
  const [, plain] = redisConnectionArgs('redis://redis:6379', PRODUCER_REDIS_OPTIONS, { production: true });
  assert.equal(plain.tls, undefined);
});

test('production fails fast on a missing or invalid REDIS_URL; development falls back to localhost', () => {
  for (const bad of [undefined, '', 'localhost:6379', 'http://redis:6379', 'redis://', 'not a url']) {
    assert.throws(() => resolveRedisUrl(bad, { production: true }), /REDIS_URL/, String(bad));
    assert.deepEqual(resolveRedisUrl(bad, { production: false }), { url: 'redis://localhost:6379', tls: false });
  }
});

test('producer connections fail fast; worker connections keep BullMQ blocking semantics', () => {
  assert.equal(PRODUCER_REDIS_OPTIONS.enableOfflineQueue, false);
  assert.ok(PRODUCER_REDIS_OPTIONS.connectTimeout <= 5_000);
  assert.equal(WORKER_REDIS_OPTIONS.maxRetriesPerRequest, null);
});

test('queue.add rejects immediately with a 503 error while Redis is not ready', async () => {
  let called = false;
  const add = guardProducerAdd(async () => { called = true; return { id: '1' }; }, { status: 'reconnecting' });
  const started = Date.now();
  await assert.rejects(add('job', {}), (error) => error instanceof QueueUnavailableError && error.statusCode === 503);
  assert.equal(called, false);
  assert.ok(Date.now() - started < 100);
});

test('queue.add times out instead of hanging on a stalled Redis', async () => {
  const add = guardProducerAdd(() => new Promise(() => {}), { status: 'ready' }, 20);
  await assert.rejects(add('job', {}), /timed out/);
  const ok = guardProducerAdd(async function add(name) { return { id: name, self: this }; }, { status: 'ready' }, 1000);
  const queue = { ok };
  const job = await queue.ok('j1');
  assert.equal(job.id, 'j1');
  assert.equal(job.self, queue, 'the queue instance is preserved as `this`');
});

test('closeQueueInfrastructure is idempotent', async () => {
  const first = closeQueueInfrastructure();
  assert.equal(closeQueueInfrastructure(), first);
  await first;
});
