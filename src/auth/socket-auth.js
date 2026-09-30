// Socket.IO handshake authentication.
import { isCurrentUserSession } from './session.js';
import { resolvePortalPrincipal as defaultResolvePortalPrincipal } from './portal-principal.js';

/**
 * Build the `io.use` middleware. Accepts an explicit auth payload for
 * native/non-browser clients or the same httpOnly cookie used by browser
 * sessions. Never accepts query-string tokens: WebSocket upgrade URLs are
 * routinely logged by proxies.
 *
 * Only a current staff or client-portal session is accepted
 * (isCurrentUserSession): magic links, OAuth state, bot tokens and any other
 * token signed with the session key are refused.
 *
 * A client-portal session must also still resolve to an active portal
 * principal (src/auth/portal-principal.js): a client that was paused,
 * archived or churned, or a contact that was removed, cannot open a socket
 * (and `authorizeClientSocket` re-checks on every project room join).
 *
 * `refuseBeforeVerify(cookies)` and `refuseAfterVerify(decoded)` may return a
 * refusal message (support views, #416): the first runs before any token is
 * verified, the second only after the session is verified as current.
 *
 * @param {{ verifyToken: (token: string) => any, parseCookie: (header: string) => Record<string, string>, prisma: any,
 *   refuseBeforeVerify?: (cookies: Record<string, string | undefined>) => string | null,
 *   refuseAfterVerify?: (decoded: any) => Promise<string | null> | string | null,
 *   resolvePortalPrincipal?: (prisma: any, payload: any) => Promise<any> }} deps
 */
export function createSocketAuthMiddleware({
  verifyToken, parseCookie, prisma, refuseBeforeVerify = () => null, refuseAfterVerify = async () => null,
  resolvePortalPrincipal = defaultResolvePortalPrincipal,
}) {
  return async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie || '');
      const early = refuseBeforeVerify(cookies);
      if (early) return next(new Error(early));
      const token = socket.handshake.auth?.token || cookies.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = await verifyToken(token);
      if (!(await isCurrentUserSession(prisma, decoded))) {
        return next(new Error('Invalid token'));
      }
      let principal = null;
      if (decoded.role === 'CLIENT') {
        principal = await resolvePortalPrincipal(prisma, decoded);
        if (!principal) return next(new Error('Session expired or revoked'));
      }
      const late = await refuseAfterVerify(decoded);
      if (late) return next(new Error(late));
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      socket.organizationId = principal ? principal.client.organizationId : decoded.organizationId;
      socket.clientId = principal ? principal.client.id : decoded.clientId;
      // Kept for authorizeClientSocket's re-check on room joins.
      if (principal) socket.portalClaims = decoded;
      return next();
    } catch {
      return next(new Error('Invalid token'));
    }
  };
}

/**
 * Re-check a client-portal socket before it joins a room: the principal is
 * resolved again, so a client paused or archived (or a contact removed) after
 * the handshake cannot join a project room. Staff sockets always pass here.
 *
 * @param {any} prisma
 * @param {{ userRole?: string, portalClaims?: any }} socket
 * @param {(prisma: any, payload: any) => Promise<any>} [resolvePortalPrincipal]
 */
export async function authorizeClientSocket(prisma, socket, resolvePortalPrincipal = defaultResolvePortalPrincipal) {
  if (socket.userRole !== 'CLIENT') return true;
  if (!socket.portalClaims) return false;
  try {
    return Boolean(await resolvePortalPrincipal(prisma, socket.portalClaims));
  } catch {
    return false;
  }
}

/**
 * Wrap a socket event handler `(arg, ack)` so a client-portal socket that is
 * no longer authorized gets a negative acknowledgement and is disconnected.
 *
 * @param {any} prisma
 * @param {any} socket
 * @param {(arg: any, ack?: Function) => any} handler
 */
export function withClientReauthorization(prisma, socket, handler) {
  return async (arg, ack) => {
    if (!(await authorizeClientSocket(prisma, socket))) {
      if (typeof ack === 'function') ack({ joined: false });
      socket.disconnect?.(true);
      return;
    }
    await handler(arg, ack);
  };
}
