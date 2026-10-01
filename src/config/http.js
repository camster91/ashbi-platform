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
const MALFORMED_ESCAPE = /%(?![0-9A-Fa-f]{2})/;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;
// find-my-way routes an absolute-form target (`GET http://host/api/x`) by
// dropping everything up to the first slash after the scheme; mirror it.
const ABSOLUTE_FORM = /^https?:\/\/.*?\//;

/**
 * Canonical form of a request URL, applied before routing (Fastify
 * `rewriteUrl`), so logs and the few places that still read request.url see
 * the path the router dispatches. RFC 3986 (section 6.2.2.2) makes escaped
 * unreserved characters equivalent to the characters themselves, so they are
 * decoded; reserved escapes (%2F and friends) and the query string are left
 * untouched. A path with a malformed escape is returned as sent so the router
 * rejects it (400) instead of a decode assembling a new escape from it
 * (`%6%31` -> `%61`). Security decisions do not rely on this: they use
 * `requestPath`, the route the router actually matched.
 * @param {string} url
 */
export function canonicalRequestUrl(url) {
  if (typeof url !== 'string') return url;
  const target = url.startsWith('/') ? url : url.replace(ABSOLUTE_FORM, '/');
  if (!target.includes('%')) return target;
  const queryAt = target.indexOf('?');
  const path = queryAt === -1 ? target : target.slice(0, queryAt);
  const rest = queryAt === -1 ? '' : target.slice(queryAt);
  if (MALFORMED_ESCAPE.test(path)) return target;
  const canonical = path.replace(UNRESERVED_ESCAPE, (escape, hex) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : escape.toUpperCase();
  });
  return canonical + rest;
}

/**
 * The path a security decision should look at: the route pattern the router
 * matched (`/api/clients/:id`), so no spelling of the URL can make a check
 * disagree with what is dispatched. Unmatched requests (404s) fall back to the
 * parsed origin-form pathname.
 * @param {{ routeOptions?: { url?: string }, url?: string, raw?: { url?: string } }} request
 */
export function requestPath(request) {
  const route = request?.routeOptions?.url;
  if (typeof route === 'string' && route.startsWith('/')) return route;
  const url = request?.url ?? request?.raw?.url ?? '/';
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
