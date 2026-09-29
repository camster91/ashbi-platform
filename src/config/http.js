// HTTP server limits for the Fastify factory.

/**
 * Node's `requestTimeout` bounds how long a client may take to *send* a
 * request (headers and body), which is the defence against slow-body clients
 * holding sockets open forever; Fastify disables it by default. It is
 * server-wide and does not limit handler time, so long handlers (the 90s AI
 * session deadline, exports) are unaffected, but it must fit the slowest
 * legitimate upload: 50 MB multipart bodies need ~80s at 5 Mbit/s, hence the
 * 120s default. REQUEST_TIMEOUT_MS overrides it (10s..15min).
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
export const MIN_REQUEST_TIMEOUT_MS = 10_000;
export const MAX_REQUEST_TIMEOUT_MS = 15 * 60_000;

export function requestTimeoutMs(value = process.env.REQUEST_TIMEOUT_MS) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(Math.max(parsed, MIN_REQUEST_TIMEOUT_MS), MAX_REQUEST_TIMEOUT_MS);
}
