// Per-account throttles for credential endpoints (security audit M4, review S2).
//
// The routes also carry a per-IP route limit (`config.rateLimit`). This adds
// two budgets that count only FAILED attempts (a successful sign-in never
// consumes them, like the step-up password budget in mfa.routes.js):
//
//   - per account + IP: the tight budget. An attacker hammering one account
//     from their own address is stopped quickly, while the real user signing
//     in from another address is unaffected.
//   - per account (email only): a much higher backstop, so a distributed
//     spray across many addresses is still bounded.
//
// Residual risk (docs/privileged-actions.md, "Credential throttles"): an
// attacker with many addresses can still exhaust the per-account backstop and
// lock the account for one window; the backstop is set high so that takes a
// large, noisy attack.
//
// Both use the app's @fastify/rate-limit plugin and its store
// (`fastify.createRateLimit`). The guard reads without incrementing and runs
// as a preHandler, after body validation, because the key comes from the
// body. The response is the same whether or not the account exists.

export const ACCOUNT_THROTTLE_MESSAGE = 'Too many attempts for this account. Try again later.';

/** Lower-case, trimmed email, or null. */
export function normalizeEmailKey(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email ? email.slice(0, 320) : null;
}

const noop = async () => undefined;

/**
 * @param {any} fastify
 * @param {{ name: string, perAccountAndIp: { max: number, timeWindow: string | number }, perAccount: { max: number, timeWindow: string | number }, field?: string }} options
 * `countAll` counts every answered request instead of failures only (for
 * endpoints with no failure signal, such as magic-link requests, where each
 * request sends an email).
 * @returns {{ guard: (request: any, reply: any) => Promise<any>, recordFailure: (request: any) => Promise<void>, onSend: (request: any, reply: any, payload: any) => Promise<any> }}
 */
export function accountThrottle(fastify, { name, perAccountAndIp, perAccount, field = 'email', countAll = false }) {
  if (typeof fastify.createRateLimit !== 'function') {
    // Only bare test harnesses build routes without the rate-limit plugin;
    // the application always registers it (src/index.js).
    return { guard: noop, recordFailure: noop, onSend: async (_request, _reply, payload) => payload };
  }
  const accountKey = (request) => normalizeEmailKey(request.body?.[field]) ?? `ip:${request.ip}`;
  const common = { allowList: () => false }; // the global limiter skips non-API paths; these never do
  const pairLimiter = fastify.createRateLimit({
    ...common, ...perAccountAndIp,
    keyGenerator: (request) => `account-ip:${name}:${accountKey(request)}:${request.ip}`,
  });
  const accountLimiter = fastify.createRateLimit({
    ...common, ...perAccount,
    keyGenerator: (request) => `account:${name}:${accountKey(request)}`,
  });

  async function guard(request, reply) {
    for (const limiter of [pairLimiter, accountLimiter]) {
      const result = await limiter(request, { increment: false });
      if (!result.isAllowed && result.remaining <= 0) {
        reply.header('retry-after', result.ttlInSeconds);
        return reply.status(429).send({ error: ACCOUNT_THROTTLE_MESSAGE, code: 'ACCOUNT_THROTTLED' });
      }
    }
    return undefined;
  }

  async function recordFailure(request) {
    try {
      await pairLimiter(request);
      await accountLimiter(request);
    } catch (err) {
      request.log?.warn({ errorName: err?.name }, 'Credential throttle store unavailable');
    }
  }

  // Route onSend hook: a rejected credential attempt (400/401/403/404)
  // consumes budget; successes, throttled (429) and server errors do not.
  async function onSend(request, reply, payload) {
    const status = reply.statusCode;
    const counted = countAll ? status < 500 && status !== 429 : [400, 401, 403, 404].includes(status);
    if (counted && request.body && typeof request.body === 'object') await recordFailure(request);
    return payload;
  }

  return { guard, recordFailure, onSend };
}
