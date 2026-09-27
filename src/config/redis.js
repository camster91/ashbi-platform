// Shared REDIS_URL handling for BullMQ producers/workers and the Redis-backed
// API rate-limit store.

import env from './env.js';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

/**
 * Resolve REDIS_URL for ioredis. ioredis parses redis:// and rediss:// URLs
 * itself (ACL username/password, percent-encoded credentials, a /db index),
 * so a valid URL is passed through unchanged; rediss:// also gets an explicit
 * TLS block.
 *
 * Production fails fast when REDIS_URL is missing or unparseable instead of
 * silently falling back to localhost (a queue that "works" against the wrong
 * Redis loses every job). Other environments fall back to local Redis.
 */
export function resolveRedisUrl(rawUrl = process.env.REDIS_URL, { production = env.isProduction } = {}) {
  const value = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  let parsed = null;
  try {
    parsed = value ? new URL(value) : null;
  } catch {
    parsed = null;
  }
  if (parsed && /^rediss?:$/.test(parsed.protocol) && parsed.hostname) {
    return { url: value, tls: parsed.protocol === 'rediss:' };
  }
  if (production) {
    throw new Error(value
      ? 'REDIS_URL must be a redis:// or rediss:// URL with a host'
      : 'REDIS_URL is required in production');
  }
  return { url: DEFAULT_REDIS_URL, tls: false };
}

/** Constructor arguments for `new IORedis(...)`. */
export function redisConnectionArgs(rawUrl, overrides = {}, options = {}) {
  const { url, tls } = resolveRedisUrl(rawUrl, options);
  return [url, { ...(tls ? { tls: {} } : {}), ...overrides }];
}
