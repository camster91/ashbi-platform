// Socket.IO handshake authentication.
import { isCurrentUserSession } from './session.js';

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
 * @param {{ verifyToken: (token: string) => any, parseCookie: (header: string) => Record<string, string>, prisma: any }} deps
 */
export function createSocketAuthMiddleware({ verifyToken, parseCookie, prisma }) {
  return async (socket, next) => {
    try {
      const cookieToken = parseCookie(socket.handshake.headers.cookie || '').token;
      const token = socket.handshake.auth?.token || cookieToken;
      if (!token) return next(new Error('Authentication required'));
      const decoded = await verifyToken(token);
      if (!(await isCurrentUserSession(prisma, decoded))) {
        return next(new Error('Invalid token'));
      }
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      socket.organizationId = decoded.organizationId;
      socket.clientId = decoded.clientId;
      return next();
    } catch {
      return next(new Error('Invalid token'));
    }
  };
}
