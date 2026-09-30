// Realtime emitter for processes that have no Socket.IO server (the BullMQ
// worker, and any service that runs in it).
//
// Backed by @socket.io/redis-emitter: `to(room).emit(...)` publishes the
// packet to Redis, and every API instance's Redis adapter
// (src/realtime/adapter.js) delivers it to its local sockets in that room.
// Without Redis (unit tests, a dev machine with no REDIS_URL) it is a no-op,
// and the web app's notification poll still picks the rows up.

import { Emitter } from '@socket.io/redis-emitter';
import { realtimeRedisSource } from './redis.js';
import defaultLogger from '../utils/logger.js';

const NOOP_OPERATOR = Object.freeze({ emit: () => false });

/**
 * @typedef {{ to: (room: string) => { emit: (event: string, ...args: any[]) => any } }} RoomEmitter
 * @typedef {RoomEmitter & { enabled: boolean, close: () => Promise<void> }} RealtimeEmitter
 */

/**
 * @param {{
 *   redis?: any,
 *   key?: string,
 *   createEmitter?: (client: { publish: Function }, opts: { key?: string }) => RoomEmitter,
 *   logger?: { warn: Function },
 * }} [options]
 * @returns {RealtimeEmitter}
 */
export function createRealtimeEmitter({
  redis = null,
  key,
  createEmitter = (client, opts) => new Emitter(/** @type {any} */ (client), opts),
  logger = defaultLogger,
} = {}) {
  if (!redis) {
    return { enabled: false, to: () => NOOP_OPERATOR, close: async () => {} };
  }
  // The Redis emitter fires publish() and drops the returned promise; catch a
  // rejection here so a Redis hiccup can never become an unhandled rejection.
  // Realtime delivery is best effort: the row is already persisted.
  const client = {
    publish(channel, message) {
      return Promise.resolve()
        .then(() => redis.publish(channel, message))
        .catch((err) => logger.warn({ err: { message: err?.message } }, 'Realtime publish failed'));
    },
  };
  // Must match the API adapter's key (realtimeRedisSource().key).
  const emitter = createEmitter(client, key ? { key } : {});
  return {
    enabled: true,
    to: (room) => emitter.to(room),
    async close() {
      await Promise.allSettled([redis.quit?.()]);
    },
  };
}

/** @type {RealtimeEmitter | null} */
let shared = null;

/**
 * The process-wide emitter; its Redis connection is opened on first use.
 * @returns {RealtimeEmitter}
 */
export function getRealtimeEmitter() {
  if (!shared) {
    const source = realtimeRedisSource();
    shared = createRealtimeEmitter({ redis: source ? source.duplicate() : null, key: source?.key });
  }
  return shared;
}

/** Close the shared emitter's connection (tests and shutdown). */
export async function closeRealtimeEmitter() {
  const current = shared;
  shared = null;
  await current?.close();
}
