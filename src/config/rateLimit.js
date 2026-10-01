import IORedis from 'ioredis';

import { redisConnectionArgs } from './redis.js';
import { isUserSessionPayload } from '../auth/session.js';
import { requestPath } from './http.js';

export function isNonApiRequest(request) {
  // The matched route (falling back to the parsed path for 404s), so an
  // encoded or absolute-form spelling cannot skip the limiter.
  const path = requestPath(request);
  return !/^\/api(?:[/?]|$)/.test(path) || /^\/api\/(?:health|live)(?:[?]|$)/.test(path);
}

export const DEFAULT_API_RATE_LIMIT_MAX = 100;
export const API_RATE_LIMIT_OVERRIDE_CEILING = 5000;

/**
 * Requests per minute each client IP may make to /api. API_RATE_LIMIT_MAX lets
 * single-IP harnesses such as the full-stack browser journeys (one browser +
 * API client on 127.0.0.1) raise it. Only development and test honour it;
 * staging, production and unknown environments always use the default, and
 * an override is clamped so a typo cannot effectively disable the limiter.
 */
export function apiRateLimitMax(value = process.env.API_RATE_LIMIT_MAX, nodeEnv = process.env.NODE_ENV) {
  if (!['development', 'test'].includes(nodeEnv || 'development')) return DEFAULT_API_RATE_LIMIT_MAX;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_API_RATE_LIMIT_MAX;
  return Math.min(parsed, API_RATE_LIMIT_OVERRIDE_CEILING);
}

export const DEFAULT_API_USER_RATE_LIMIT_MAX = 600;

/**
 * Requests per minute each signed-in principal (staff user or portal contact)
 * may make to /api. Authenticated traffic is keyed by the verified session,
 * not the IP, so an office behind one NAT address does not share a bucket and
 * the SPA's parallel fetches fit comfortably. API_USER_RATE_LIMIT_MAX adjusts
 * it in every environment, clamped to [DEFAULT_API_RATE_LIMIT_MAX, ceiling].
 */
export function apiUserRateLimitMax(value = process.env.API_USER_RATE_LIMIT_MAX) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_API_USER_RATE_LIMIT_MAX;
  return Math.min(Math.max(parsed, DEFAULT_API_RATE_LIMIT_MAX), API_RATE_LIMIT_OVERRIDE_CEILING);
}

function sessionToken(request) {
  const header = request.headers?.authorization;
  if (typeof header === 'string' && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
  return request.cookies?.token;
}

/**
 * The verified principal behind a request, or null for anonymous traffic.
 * Prefers `request.user` set by the global JWT hook; routes that hook skips
 * (/api/auth/*, /api/portal/*) are verified here with the same secret. Only
 * the signature and expiry are checked: this picks a rate-limit bucket and
 * grants nothing.
 */
export async function rateLimitPrincipal(request) {
  let payload = request.user;
  if (!(payload?.id ?? payload?.contactId)) {
    const token = sessionToken(request);
    if (!token || typeof request.server?.jwt?.verify !== 'function') return null;
    try {
      payload = await request.server.jwt.verify(token);
    } catch {
      return null;
    }
  }
  // Bot credentials are shared automation, not a person: they keep the
  // per-IP bucket and limit instead of one shared high-limit user bucket.
  if (payload?.role === 'BOT') return null;
  // Only a typed user session earns the user bucket: magic links, OAuth state
  // and pre-typ sessions are signed with the same secret but are not sessions
  // (src/auth/session.js).
  if (!isUserSessionPayload(payload)) return null;
  return String(payload.id);
}

/** Global limiter key: `user:<id>` for verified sessions, `ip:<addr>` otherwise. */
export async function apiRateLimitKey(request) {
  const principal = await rateLimitPrincipal(request);
  return principal ? `user:${principal}` : `ip:${request.ip}`;
}

export function createApiRateLimitMax({ ipMax = apiRateLimitMax(), userMax = apiUserRateLimitMax() } = {}) {
  // A signed-in user never gets less than an anonymous IP.
  const effectiveUserMax = Math.max(userMax, ipMax);
  return (_request, key) => (String(key).startsWith('user:') ? effectiveUserMax : ipMax);
}

/**
 * Redis connection for the shared limiter store, or null (tests, or no
 * REDIS_URL in development) to use the in-memory store. Deployed
 * environments (staging, production) always use Redis. Fail-fast options:
 * a Redis outage must not stall requests; the limiter skips on error.
 */
export function createRateLimitRedis({ nodeEnv = process.env.NODE_ENV, redisUrl = process.env.REDIS_URL } = {}) {
  if (nodeEnv === 'test') return null;
  const deployed = nodeEnv === 'staging' || nodeEnv === 'production';
  if (!redisUrl && !deployed) return null;
  const redis = new IORedis(...redisConnectionArgs(redisUrl, {
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 1_000,
  }, { production: deployed }));
  redis.on('error', () => {});
  return redis;
}
