export function isNonApiRequest(request) {
  const url = request?.raw?.url || request?.url || '';
  return !/^\/api(?:[/?]|$)/.test(url) || /^\/api\/(?:health|live)(?:[?]|$)/.test(url);
}

export const DEFAULT_API_RATE_LIMIT_MAX = 100;

/**
 * Requests per minute each client IP may make to /api. Production keeps the
 * default; API_RATE_LIMIT_MAX lets single-IP harnesses such as the full-stack
 * browser journeys (one browser + API client on 127.0.0.1) raise it.
 */
export function apiRateLimitMax(value = process.env.API_RATE_LIMIT_MAX) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_API_RATE_LIMIT_MAX;
}
