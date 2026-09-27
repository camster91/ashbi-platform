import env from '../config/env.js';

export function sessionCookieMaxAge(value = env.jwtExpiresIn) {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error('JWT_EXPIRES_IN must use s, m, h, or d (for example, 7d)');
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(match[1]) * multipliers[match[2]];
}

/**
 * Shared cookie attributes for login setCookie and logout clearCookie.
 * Accepts a boolean `isProduction` (legacy form) or `{ isProduction, includeMaxAge }`.
 */
export function sessionCookieOptions(options = {}) {
  const { isProduction = env.isProduction, includeMaxAge = false } =
    typeof options === 'boolean' ? { isProduction: options } : options;
  const cookie = {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
  };
  if (includeMaxAge) {
    cookie.maxAge = sessionCookieMaxAge();
  }
  return cookie;
}

// Every token signed with the session key carries an explicit `typ`, and only
// the two user-session types below are accepted as a session. Anything else
// signed with JWT_SECRET (a client-portal magic link, a legacy bot token, an
// older OAuth state) is refused by every session verifier: the HTTP hook,
// `fastify.authenticate` / `adminOnly`, Socket.IO and the client portal.
// Sessions issued before `typ` existed are refused too, so their holders
// sign in again once (see docs/privileged-actions.md, "Session token types").
export const SESSION_TOKEN_TYPE = 'session';
export const CLIENT_SESSION_TOKEN_TYPE = 'client_session';
export const USER_SESSION_TOKEN_TYPES = Object.freeze([SESSION_TOKEN_TYPE, CLIENT_SESSION_TOKEN_TYPE]);

/** The session token type for an account: portal clients get their own. */
export function sessionTokenTypeFor(role) {
  return role === 'CLIENT' ? CLIENT_SESSION_TOKEN_TYPE : SESSION_TOKEN_TYPE;
}

export function signUserSession(jwt, user, extraClaims = {}) {
  return jwt.sign({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.clientId,
    organizationId: user.organizationId,
    sessionVersion: user.sessionVersion,
    ...extraClaims,
    // Last, so no caller-supplied claim can relabel the token.
    typ: sessionTokenTypeFor(user.role),
  }, { expiresIn: env.jwtExpiresIn });
}

/**
 * Whether a verified JWT payload has the shape of a user session: a session
 * `typ` that matches the role, a user id and an integer sessionVersion.
 * Signature and expiry are checked by the caller (jwtVerify / jwt.verify).
 * @param {any} payload
 * @param {{ types?: readonly string[] }} [options] accepted session types
 */
export function isUserSessionPayload(payload, { types = USER_SESSION_TOKEN_TYPES } = {}) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.typ !== 'string' || !types.includes(payload.typ)) return false;
  if (payload.typ !== sessionTokenTypeFor(payload.role)) return false;
  if (typeof payload.id !== 'string' || !payload.id) return false;
  return Number.isInteger(payload.sessionVersion);
}

/**
 * Whether a verified JWT payload is a user session that is still current:
 * well-formed (isUserSessionPayload), for an active account, and not revoked
 * (its sessionVersion matches the account's). Every other token type is
 * refused here, whatever key signed it.
 */
export async function isCurrentUserSession(prisma, payload, options = {}) {
  if (!isUserSessionPayload(payload, options)) return false;

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { isActive: true, sessionVersion: true },
  });

  return Boolean(user?.isActive && user.sessionVersion === payload.sessionVersion);
}

export async function revokeUserSessions(prisma, userId) {
  return prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}
