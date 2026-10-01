// @ts-check
// Dropping client-portal sockets whose access was revoked (#286).
//
// The handshake and every project room join re-resolve the portal principal
// (src/auth/socket-auth.js), but a socket that already joined its rooms would
// otherwise keep receiving chat, project, task and notification events after
// the client is paused, archived or churned, the contact removed, the user
// deactivated or the session revoked. Two mechanisms close that:
//
// - at once: each client socket joins `client:{clientId}` and
//   `client-user:{userId}`; the write paths that revoke access (client status
//   or relationship change, portal user deactivation, sign-out) call
//   `fastify.revokeClientSockets(...)`, which disconnects those rooms;
// - within one sweep interval: `startClientSocketSweep` re-resolves every
//   CLIENT socket's principal on this instance and disconnects the ones that
//   no longer resolve, which covers write paths that cannot reach `io`
//   (imports, scripts, direct database changes, session expiry).
//
// Staff sockets never join these rooms and are skipped by the sweep.

import { resolvePortalPrincipal as defaultResolvePortalPrincipal } from './portal-principal.js';

/** How often each API instance re-checks its client-portal sockets. */
export const CLIENT_SOCKET_SWEEP_MS = 30_000;

/** @param {string} clientId */
export function clientSocketRoom(clientId) {
  return `client:${clientId}`;
}

/** @param {string} userId */
export function clientUserSocketRoom(userId) {
  return `client-user:${userId}`;
}

/**
 * Rooms a client-portal socket joins at connect; none for staff.
 * @param {{ userRole?: string, userId?: string, clientId?: string }} socket
 * @returns {string[]}
 */
export function clientSocketRooms(socket) {
  if (socket?.userRole !== 'CLIENT') return [];
  return [
    ...(socket.clientId ? [clientSocketRoom(socket.clientId)] : []),
    ...(socket.userId ? [clientUserSocketRoom(socket.userId)] : []),
  ];
}

/**
 * Disconnect the client-portal sockets of a client and/or a portal user on
 * this instance (and on the others when the Socket.IO adapter is shared).
 * @param {any} io
 * @param {{ clientId?: string | null, userId?: string | null }} target
 */
export function disconnectClientSockets(io, { clientId = null, userId = null } = {}) {
  const rooms = [
    ...(clientId ? [clientSocketRoom(clientId)] : []),
    ...(userId ? [clientUserSocketRoom(userId)] : []),
  ];
  if (!io || rooms.length === 0) return;
  io.in(rooms).disconnectSockets(true);
}

/**
 * From a route: disconnect through the app's decorator (or `fastify.io` in
 * tests that register routes alone). Never throws into the request; the
 * sweep is the fallback.
 * @param {any} fastify
 * @param {{ clientId?: string | null, userId?: string | null }} target
 * @param {{ warn?: Function }} [log]
 */
export function revokeClientSocketsFrom(fastify, target, log) {
  try {
    if (typeof fastify?.revokeClientSockets === 'function') fastify.revokeClientSockets(target);
    else disconnectClientSockets(fastify?.io, target);
  } catch (err) {
    log?.warn?.({ err: { message: /** @type {any} */ (err)?.message } }, 'Client socket revocation failed; the sweep will retry');
  }
}

/**
 * Whether a client record's state revokes portal access (the same rule as
 * resolvePortalPrincipal).
 * @param {{ status?: string | null, relationshipStatus?: string | null, deletedAt?: Date | null } | null} client
 */
export function clientStateRevokesPortal(client) {
  if (!client) return true;
  if (client.deletedAt) return true;
  if (client.status && client.status !== 'ACTIVE') return true;
  return ['ARCHIVED', 'CHURNED'].includes(String(client.relationshipStatus || ''));
}

/**
 * Disconnect this instance's client-portal sockets whose principal no longer
 * resolves. One resolution per distinct session per sweep.
 * @param {Iterable<any>} sockets
 * @param {any} prisma raw client
 * @param {(prisma: any, payload: any) => Promise<any>} [resolvePortalPrincipal]
 * @returns {Promise<number>} sockets disconnected
 */
export async function sweepClientSockets(sockets, prisma, resolvePortalPrincipal = defaultResolvePortalPrincipal) {
  const candidates = [...sockets].filter((socket) => socket?.userRole === 'CLIENT');
  if (candidates.length === 0) return 0;
  /** @type {Map<string, Promise<boolean>>} */
  const verdicts = new Map();
  const allowed = (claims) => {
    if (!claims) return Promise.resolve(false);
    const key = `${claims.id}:${claims.contactId}:${claims.clientId}:${claims.sessionVersion}`;
    if (!verdicts.has(key)) {
      verdicts.set(key, Promise.resolve(resolvePortalPrincipal(prisma, claims)).then(Boolean, () => true));
    }
    return /** @type {Promise<boolean>} */ (verdicts.get(key));
  };
  let dropped = 0;
  for (const socket of candidates) {
    // Token expiry ends access too.
    const expired = Number.isFinite(socket.portalClaims?.exp) && socket.portalClaims.exp * 1000 <= Date.now();
    if (expired || !(await allowed(socket.portalClaims))) {
      socket.disconnect(true);
      dropped += 1;
    }
  }
  return dropped;
}

/**
 * Run the client-socket sweep on this instance. Returns a stop function.
 * @param {any} io
 * @param {any} prisma raw client
 * @param {{ warn: Function }} logger
 * @param {{ intervalMs?: number }} [options]
 */
export function startClientSocketSweep(io, prisma, logger, { intervalMs = CLIENT_SOCKET_SWEEP_MS } = {}) {
  const timer = setInterval(() => {
    sweepClientSockets(io.of('/').sockets.values(), prisma).catch((err) => {
      logger.warn({ err: { message: err?.message } }, 'Client socket sweep failed');
    });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
