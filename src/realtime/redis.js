// Redis connections for realtime fan-out: the Socket.IO Redis adapter on API
// instances and the Redis emitter used by the BullMQ worker.
//
// Realtime shares REDIS_URL with the job queue; there is no separate toggle.
// It is on when REDIS_URL is set and NODE_ENV is not `test`. Without it (a
// dev machine with no Redis, unit tests) the API keeps Socket.IO's in-memory
// adapter and the emitter is a no-op. Deployed environments already fail
// fast without REDIS_URL (src/config/redis.js).

import IORedis from 'ioredis';
import { redisConnectionArgs, resolveRedisUrl } from '../config/redis.js';

// Same shape as the support-view pub/sub connections (PUBSUB_REDIS_OPTIONS in
// src/jobs/queue.js): commands queue until Redis is reachable and SUBSCRIBEs
// are replayed after a reconnect, so an outage delays realtime events instead
// of dropping the adapter's subscriptions.
export const REALTIME_REDIS_OPTIONS = Object.freeze({ maxRetriesPerRequest: null, enableOfflineQueue: true });

function createRealtimeConnection(rawUrl) {
  const redis = new IORedis(...redisConnectionArgs(rawUrl, REALTIME_REDIS_OPTIONS));
  // An unhandled 'error' event would crash the process; the readiness check
  // reports Redis outages.
  redis.on('error', () => {});
  return redis;
}

/**
 * Source of realtime Redis connections: `duplicate()` opens a new reconnecting
 * connection (callers own and close it). Null in tests and when REDIS_URL is
 * unset outside deployed environments.
 * @param {{ env?: Record<string, string | undefined>, createConnection?: (url: string) => any }} [options]
 * @returns {{ duplicate: () => any } | null}
 */
export function realtimeRedisSource({ env = process.env, createConnection = createRealtimeConnection } = {}) {
  if (env.NODE_ENV === 'test') return null;
  const rawUrl = typeof env.REDIS_URL === 'string' ? env.REDIS_URL.trim() : '';
  if (!rawUrl) {
    // Throws in staging/production; elsewhere realtime stays in-process.
    resolveRedisUrl(rawUrl);
    return null;
  }
  return { duplicate: () => createConnection(rawUrl) };
}
