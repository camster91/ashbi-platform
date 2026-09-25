export function isNonApiRequest(request) {
  const url = request?.raw?.url || request?.url || '';
  return !/^\/api(?:[/?]|$)/.test(url) || /^\/api\/(?:health|live)(?:[?]|$)/.test(url);
}

export const DEFAULT_API_RATE_LIMIT_MAX = 100;
export const API_RATE_LIMIT_OVERRIDE_CEILING = 5000;

/**
 * Requests per minute each client IP may make to /api. API_RATE_LIMIT_MAX lets
 * single-IP harnesses such as the full-stack browser journeys (one browser +
 * API client on 127.0.0.1) raise it. Production always uses the default, and
 * an override is clamped so a typo cannot effectively disable the limiter.
 */
export function apiRateLimitMax(value = process.env.API_RATE_LIMIT_MAX, nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv === 'production') return DEFAULT_API_RATE_LIMIT_MAX;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_API_RATE_LIMIT_MAX;
  return Math.min(parsed, API_RATE_LIMIT_OVERRIDE_CEILING);
}
