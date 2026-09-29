// Session resolution for HTTP requests, shared by the /api hook and the
// `fastify.authenticate` / `fastify.adminOnly` guards (src/index.js).
//
// A token that verifies but is not a current session (an untyped session
// issued before token types existed, a revoked or deactivated account, a
// magic link or any other non-session token) makes the request anonymous; it
// never blocks a public route. When that token came from the `token` cookie,
// the cookie is cleared on the response, so a browser holding a stale cookie
// recovers on its next request instead of being locked out until the cookie
// expires.

import { isCurrentUserSession, sessionCookieOptions } from './session.js';

export const SESSION_COOKIE = 'token';

/** Whether the token @fastify/jwt verifies for this request is the cookie (no Authorization header). */
export function sessionTokenFromCookie(request) {
  return !request.headers?.authorization && typeof request.cookies?.[SESSION_COOKIE] === 'string' && request.cookies[SESSION_COOKIE] !== '';
}

/** Clear the session cookie when it is what made the request's session invalid. */
export function clearStaleSessionCookie(request, reply) {
  if (sessionTokenFromCookie(request)) {
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  }
}

/**
 * @returns {Promise<'none' | 'current' | 'stale' | 'error'>}
 *   none: no token; current: request.user is a current session; stale: a
 *   token was presented but is not a current session (request.user is
 *   cleared); error: the session store could not be reached.
 */
export async function resolveRequestSession(request, prisma) {
  const hasToken = Boolean(request.headers?.authorization) || sessionTokenFromCookie(request);
  if (!hasToken) return 'none';
  try {
    await request.jwtVerify();
  } catch {
    request.user = null;
    return 'stale';
  }
  try {
    if (await isCurrentUserSession(prisma, request.user)) return 'current';
  } catch {
    request.user = null;
    return 'error';
  }
  request.user = null;
  return 'stale';
}
