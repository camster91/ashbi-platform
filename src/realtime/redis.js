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

const CHANNEL_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Pub/Sub channel prefix shared by the adapter and the emitter. Redis Pub/Sub
 * ignores the logical database, so two deployments on one Redis server (e.g.
 * staging on /1 and production on /0) would otherwise receive each other's
 * broadcasts. The default key carries NODE_ENV and the REDIS_URL db index;
 * REALTIME_CHANNEL_KEY overrides it (two deployments with the same NODE_ENV
 * on the same Redis database must each set a distinct value).
 * @param {Record<string, string | undefined>} env
 * @param {string} rawUrl
 * @returns {string}
 */
export function realtimeChannelKey(env, rawUrl) {
  const override = typeof env.REALTIME_CHANNEL_KEY === 'string' ? env.REALTIME_CHANNEL_KEY.trim() : '';
  if (override) {
    if (!CHANNEL_KEY_PATTERN.test(override)) {
      throw new Error('REALTIME_CHANNEL_KEY must be 1-64 characters of letters, digits, ".", "_", ":" or "-"');
    }
    return `ashbi-realtime:${override}`;
  }
  let db = '0';
  try {
    const index = new URL(rawUrl).pathname.replace(/^\//, '');
    if (/^\d+$/.test(index)) db = String(Number(index));
  } catch {
    // resolveRedisUrl already rejects an unparseable URL in deployed environments.
  }
  return `ashbi-realtime:${env.NODE_ENV || 'development'}:db${db}`;
}

/**
 * Source of realtime Redis connections: `duplicate()` opens a new reconnecting
 * connection (callers own and close it); `key` is the Pub/Sub channel prefix
 * (see realtimeChannelKey). Null in tests and when REDIS_URL is unset outside
 * deployed environments.
 * @param {{ env?: Record<string, string | undefined>, createConnection?: (url: string) => any }} [options]
 * @returns {{ duplicate: () => any, key: string } | null}
 */
export function realtimeRedisSource({ env = process.env, createConnection = createRealtimeConnection } = {}) {
  if (env.NODE_ENV === 'test') return null;
  const rawUrl = typeof env.REDIS_URL === 'string' ? env.REDIS_URL.trim() : '';
  if (!rawUrl) {
    // Throws in staging/production; elsewhere realtime stays in-process.
    resolveRedisUrl(rawUrl);
    return null;
  }
  const key = realtimeChannelKey(env, rawUrl);
  return { duplicate: () => createConnection(rawUrl), key };
}
