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

const UNRESERVED_ESCAPE = /%([0-9A-Fa-f]{2})/g;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/**
 * Canonical form of a request URL, applied before routing (Fastify
 * `rewriteUrl`). The router decodes percent-escapes, but every prefix check
 * that runs on `request.url` (tenancy, session hook, rate limiting, auth
 * exemptions) reads the raw string; `/%61pi/clients` would route to
 * `/api/clients` while those checks saw a non-API path and skipped tenant
 * scoping. RFC 3986 (section 6.2.2.2) makes escaped unreserved characters
 * equivalent to the characters themselves, so decoding them here gives the
 * checks and the router the same path. Reserved escapes (%2F and friends) and
 * the query string are left untouched.
 * @param {string} url
 */
export function canonicalRequestUrl(url) {
  if (typeof url !== 'string' || !url.includes('%')) return url;
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const rest = queryAt === -1 ? '' : url.slice(queryAt);
  const canonical = path.replace(UNRESERVED_ESCAPE, (escape, hex) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : escape.toUpperCase();
  });
  return canonical + rest;
}
