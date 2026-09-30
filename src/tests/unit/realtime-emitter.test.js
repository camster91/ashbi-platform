import assert from 'node:assert/strict';
import test from 'node:test';

import { closeRealtimeEmitter, createRealtimeEmitter, getRealtimeEmitter } from '../../realtime/emitter.js';
import { realtimeRedisSource } from '../../realtime/redis.js';

test('in test mode there is no realtime Redis source and the shared emitter is a no-op', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(realtimeRedisSource(), null);
  const emitter = getRealtimeEmitter();
  assert.equal(emitter.enabled, false);
  assert.equal(getRealtimeEmitter(), emitter, 'one shared emitter per process');
  assert.equal(emitter.to('user:u1').emit('notification:new', { id: 'n1' }), false);
  await closeRealtimeEmitter();
});

test('realtimeRedisSource is keyed on REDIS_URL and never connects in tests', () => {
  const opened = [];
  const createConnection = (url) => { opened.push(url); return { url }; };
  assert.equal(realtimeRedisSource({ env: { NODE_ENV: 'test', REDIS_URL: 'redis://cache:6379' }, createConnection }), null);
  assert.equal(realtimeRedisSource({ env: { NODE_ENV: 'development' }, createConnection }), null);
  assert.equal(realtimeRedisSource({ env: { NODE_ENV: 'development', REDIS_URL: '  ' }, createConnection }), null);
  const source = realtimeRedisSource({ env: { NODE_ENV: 'production', REDIS_URL: ' redis://cache:6379 ' }, createConnection });
  assert.ok(source);
  assert.deepEqual(opened, [], 'connections open lazily');
  assert.deepEqual(source.duplicate(), { url: 'redis://cache:6379' });
  source.duplicate();
  assert.equal(opened.length, 2, 'each duplicate() is a dedicated connection');
});

test('with Redis, to(room).emit is routed to the injected Redis emitter', async () => {
  const calls = [];
  const quits = [];
  const redis = { publish: async () => 1, quit: async () => { quits.push('quit'); } };
  let client;
  const emitter = createRealtimeEmitter({
    redis,
    createEmitter: (publishClient) => {
      client = publishClient;
      return { to: (room) => ({ emit: (event, payload) => { calls.push({ room, event, payload }); return true; } }) };
    },
  });
  assert.equal(emitter.enabled, true);
  assert.equal(typeof client.publish, 'function');
  assert.equal(emitter.to('user:u1').emit('notification:new', { id: 'n1' }), true);
  assert.deepEqual(calls, [{ room: 'user:u1', event: 'notification:new', payload: { id: 'n1' } }]);
  await emitter.close();
  assert.deepEqual(quits, ['quit']);
});

test('the real Redis emitter publishes a room-scoped packet and swallows publish failures', async () => {
  const published = [];
  const warnings = [];
  const redis = {
    publish: async (channel, message) => {
      published.push({ channel, message });
      if (published.length === 2) throw new Error('redis down');
      return 1;
    },
  };
  const emitter = createRealtimeEmitter({ redis, logger: { warn: (...args) => warnings.push(args) } });
  emitter.to('user:u1').emit('notification:new', { id: 'n1' });
  emitter.to('user:u1').emit('notification', { id: 'n1' });
  await new Promise((resolve) => setImmediate(resolve));
  // The adapter's channel for a single-room broadcast in the root namespace.
  assert.deepEqual(published.map((p) => p.channel), ['socket.io#/#user:u1#', 'socket.io#/#user:u1#']);
  assert.ok(Buffer.isBuffer(published[0].message));
  assert.equal(warnings.length, 1, 'a failed publish is logged, not an unhandled rejection');
});
