// Realtime across processes over a real Redis: the worker's Redis emitter
// reaches a client connected to an API instance that uses the Redis adapter,
// and two API instances share rooms. Skips when Redis is not reachable at
// REDIS_URL (default redis://localhost:6379).
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import { createAdapter } from '@socket.io/redis-adapter';
import { Emitter } from '@socket.io/redis-emitter';
import IORedis from 'ioredis';
import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';

import { attachRedisAdapter } from '../../realtime/adapter.js';
import { createRealtimeEmitter } from '../../realtime/emitter.js';
import { realtimeRedisSource } from '../../realtime/redis.js';
import { emitNotification } from '../../services/notification.service.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

async function redisReachable() {
  const probe = new IORedis(redisUrl, { lazyConnect: true, connectTimeout: 1_000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  probe.on('error', () => {});
  try {
    await probe.connect();
    return (await probe.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const skip = (await redisReachable()) ? false : `Redis is not reachable at ${redisUrl}`;

// A unique channel prefix per run, so parallel runs never see each other.
const key = `ashbi-realtime-test-${process.pid}-${Date.now()}`;
// The same source the API uses, forced on (unit/integration runs set NODE_ENV=test).
const source = () => realtimeRedisSource({ env: { NODE_ENV: 'production', REDIS_URL: redisUrl } });

async function startInstance(cleanup) {
  const server = http.createServer();
  const io = new Server(server);
  const adapter = attachRedisAdapter(io, source(), { adapterFactory: (pub, sub) => createAdapter(pub, sub, { key }) });
  assert.equal(adapter.enabled, true);
  // Stand-in for the auth middleware + connection handler in src/index.js.
  io.on('connection', (socket) => {
    const { userId, projectId } = socket.handshake.auth;
    socket.join(`user:${userId}`);
    if (projectId) socket.join(`project:${projectId}`);
  });
  server.listen(0);
  await once(server, 'listening');
  const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  cleanup.push(async () => {
    await new Promise((resolve) => io.close(resolve));
    await adapter.close();
  });
  return { io, url };
}

async function connect(url, auth, cleanup) {
  const client = connectClient(url, { transports: ['websocket'], auth, reconnection: false });
  cleanup.push(async () => { client.close(); });
  await once(client, 'connect');
  return client;
}

/** Wait until `count` adapters subscribed to this run's request channel. */
async function waitForServers(io, count) {
  const deadline = Date.now() + 5_000;
  while ((await io.of('/').adapter.serverCount()) < count) {
    if (Date.now() > deadline) throw new Error('Redis adapter did not subscribe in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function nextEvent(client, event, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No ${event} within ${timeoutMs}ms`)), timeoutMs);
    client.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

async function runCleanup(cleanup) {
  for (const step of cleanup.reverse()) await step();
}

test('a worker notification from the Redis emitter reaches a client on an API instance', { skip }, async () => {
  const cleanup = [];
  try {
    const api = await startInstance(cleanup);
    await waitForServers(api.io, 1);
    const client = await connect(api.url, { userId: 'u1' }, cleanup);
    const other = await connect(api.url, { userId: 'u2' }, cleanup);
    let leaked = false;
    other.on('notification:new', () => { leaked = true; });

    const emitter = createRealtimeEmitter({
      redis: source().duplicate(),
      createEmitter: (publishClient) => new Emitter(/** @type {any} */ (publishClient), { key }),
    });
    cleanup.push(() => emitter.close());
    assert.equal(emitter.enabled, true);

    const createdAt = new Date('2026-09-30T12:00:00.000Z');
    const row = { id: 'n1', type: 'SLA_WARNING', title: 'Response needed soon', message: 'Thread needs attention', data: { threadId: 't1' }, createdAt };
    const received = nextEvent(client, 'notification:new');
    const legacy = nextEvent(client, 'notification');
    emitNotification(emitter, 'u1', row);

    const payload = await received;
    assert.deepEqual({ ...payload, createdAt: new Date(payload.createdAt).toISOString() }, { ...row, createdAt: createdAt.toISOString() });
    assert.deepEqual(await legacy, { id: 'n1', type: 'SLA_WARNING', data: { threadId: 't1' } });
    assert.equal(leaked, false, 'only the addressed user room receives it');
  } finally {
    await runCleanup(cleanup);
  }
});

test('two API instances share rooms through the Redis adapter', { skip }, async () => {
  const cleanup = [];
  try {
    const a = await startInstance(cleanup);
    const b = await startInstance(cleanup);
    await waitForServers(a.io, 2);
    await waitForServers(b.io, 2);
    const onA = await connect(a.url, { userId: 'u1', projectId: 'p1' }, cleanup);
    const onB = await connect(b.url, { userId: 'u2', projectId: 'p1' }, cleanup);

    // A room emit on one instance reaches the room's sockets on the other.
    const fromA = nextEvent(onB, 'notification:new');
    a.io.to('user:u2').emit('notification:new', { id: 'n2' });
    assert.deepEqual(await fromA, { id: 'n2' });

    const project = [nextEvent(onA, 'chat'), nextEvent(onB, 'chat')];
    b.io.to('project:p1').emit('chat', { text: 'hi' });
    assert.deepEqual(await Promise.all(project), [{ text: 'hi' }, { text: 'hi' }]);

    // fetchSockets sees remote sockets with their rooms, and a remote socket
    // can be emitted to: what call signalling relies on across replicas.
    const remote = await b.io.in('user:u1').fetchSockets();
    assert.equal(remote.length, 1);
    assert.ok(remote[0].rooms.has('project:p1'));
    const signal = nextEvent(onA, 'call:signal');
    remote[0].emit('call:signal', { from: 'u2', signal: { type: 'offer' } });
    assert.deepEqual(await signal, { from: 'u2', signal: { type: 'offer' } });

    // disconnectSockets on one instance drops the room's sockets everywhere.
    const dropped = once(onA, 'disconnect');
    b.io.in('user:u1').disconnectSockets(true);
    await dropped;
  } finally {
    await runCleanup(cleanup);
  }
});
