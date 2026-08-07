import env from '../config/env.js';

export function sessionCookieMaxAge(value = env.jwtExpiresIn) {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error('JWT_EXPIRES_IN must use s, m, h, or d (for example, 7d)');
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(match[1]) * multipliers[match[2]];
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
  }, { expiresIn: env.jwtExpiresIn });
}

export async function isCurrentUserSession(prisma, payload) {
  // Non-user capability tokens (magic links and bot credentials) have their
  // own bounded lifetime and authorization contract.
  if (!payload?.id || payload.role === 'BOT') return true;
  if (!Number.isInteger(payload.sessionVersion)) return false;

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
