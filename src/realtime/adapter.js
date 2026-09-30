// Shared Socket.IO adapter for API replicas.
//
// With the Redis adapter every broadcast (io.to(room).emit, disconnectSockets,
// socketsJoin...) reaches the sockets of every API instance, and
// io.in(room).fetchSockets() returns remote sockets too. It also receives
// packets published by the worker's Redis emitter (src/realtime/emitter.js).

import { createAdapter } from '@socket.io/redis-adapter';

/**
 * Attach the Redis adapter when a Redis source is available; otherwise keep
 * Socket.IO's default in-memory adapter (single instance, dev, tests).
 * The adapter needs two dedicated connections: a publisher and a subscriber.
 *
 * @param {{ adapter: (factory: any) => any }} io
 * @param {{ duplicate: () => any } | null} redisSource e.g. realtimeRedisSource()
 * @param {{ adapterFactory?: (pub: any, sub: any) => any }} [options]
 * @returns {{ enabled: boolean, close: () => Promise<void> }}
 */
export function attachRedisAdapter(io, redisSource, { adapterFactory = createAdapter } = {}) {
  if (!redisSource || typeof redisSource.duplicate !== 'function') {
    return { enabled: false, close: async () => {} };
  }
  const pubClient = redisSource.duplicate();
  const subClient = redisSource.duplicate();
  io.adapter(adapterFactory(pubClient, subClient));
  return {
    enabled: true,
    // Call after io.close(): closing the server closes the adapter, which
    // unsubscribes on subClient first.
    async close() {
      await Promise.allSettled([subClient?.quit?.(), pubClient?.quit?.()]);
    },
  };
}
