// Per-account throttles for credential endpoints (security audit M4).
//
// The routes also carry a per-IP route limit (`config.rateLimit`). This adds a
// second limit keyed by the normalised email in the request body, so a spray
// from many addresses against one account is bounded too. It uses the app's
// @fastify/rate-limit plugin and its store (`fastify.createRateLimit`), and
// runs as a preHandler, after body validation, because the key comes from the
// body. The response is the same whether or not the account exists.

export const ACCOUNT_THROTTLE_MESSAGE = 'Too many attempts for this account. Try again later.';

/** Lower-case, trimmed email, or null. */
export function normalizeEmailKey(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email ? email.slice(0, 320) : null;
}

/**
 * @param {any} fastify
 * @param {{ name: string, max: number, timeWindow: string | number, field?: string }} options
 * @returns {(request: any, reply: any) => Promise<any>}
 */
export function accountThrottle(fastify, { name, max, timeWindow, field = 'email' }) {
  if (typeof fastify.createRateLimit !== 'function') {
    // Only bare test harnesses build routes without the rate-limit plugin;
    // the application always registers it (src/index.js).
    return async () => undefined;
  }
  const check = fastify.createRateLimit({
    max,
    timeWindow,
    // The global limiter skips non-API paths; an account throttle never does.
    allowList: () => false,
    keyGenerator: (request) => `account:${name}:${normalizeEmailKey(request.body?.[field]) ?? `ip:${request.ip}`}`,
  });
  return async function accountThrottleHandler(request, reply) {
    const result = await check(request);
    if (result.isAllowed || !result.isExceeded) return undefined;
    reply.header('retry-after', result.ttlInSeconds);
    return reply.status(429).send({ error: ACCOUNT_THROTTLE_MESSAGE, code: 'ACCOUNT_THROTTLED' });
  };
}
