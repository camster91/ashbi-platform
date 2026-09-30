import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { attachRedisAdapter } from '../../realtime/adapter.js';

function fakeIo() {
  const adapters = [];
  return { adapters, adapter: (factory) => { adapters.push(factory); } };
}

test('with a Redis source, the Redis adapter is attached on two dedicated connections', async () => {
  const io = fakeIo();
  const connections = [];
  const source = {
    duplicate: () => {
      const connection = { name: `c${connections.length + 1}`, quit: async () => { connection.quit = 'closed'; } };
      connections.push(connection);
      return connection;
    },
  };
  const factoryCalls = [];
  const adapterFactory = (pub, sub, opts) => { factoryCalls.push([pub.name, sub.name, opts]); return 'redis-adapter'; };

  const realtime = attachRedisAdapter(io, { ...source, key: 'ashbi-realtime:production:db0' }, { adapterFactory });

  assert.equal(realtime.enabled, true);
  assert.deepEqual(factoryCalls, [['c1', 'c2', { key: 'ashbi-realtime:production:db0' }]], 'separate publisher and subscriber, deployment channel key');
  assert.deepEqual(io.adapters, ['redis-adapter']);
  await realtime.close();
  assert.deepEqual(connections.map((c) => c.quit), ['closed', 'closed']);
});

test('without a Redis source the in-memory adapter is kept', async () => {
  const io = fakeIo();
  let created = 0;
  const realtime = attachRedisAdapter(io, null, { adapterFactory: () => { created += 1; } });
  assert.equal(realtime.enabled, false);
  assert.equal(created, 0);
  assert.deepEqual(io.adapters, []);
  await realtime.close();
});

test('the default factory is @socket.io/redis-adapter', () => {
  const io = fakeIo();
  const source = { duplicate: () => ({ psubscribe: async () => {}, subscribe: async () => {}, on() {}, quit: async () => {} }) };
  // A real createAdapter returns the adapter constructor Socket.IO calls per namespace.
  attachRedisAdapter(io, source);
  assert.equal(io.adapters.length, 1);
  assert.equal(typeof io.adapters[0], 'function');
});

test('the API wires the Redis adapter from realtimeRedisSource and closes it on shutdown', () => {
  const index = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  assert.match(index, /attachRedisAdapter\(io, realtimeRedisSource\(\)\)/);
  const onClose = index.slice(index.indexOf('realtimeAdapter = attachRedisAdapter'));
  assert.ok(onClose.indexOf('io.close(resolve)') < onClose.indexOf('realtimeAdapter.close()'), 'adapter connections close after the server');
});
