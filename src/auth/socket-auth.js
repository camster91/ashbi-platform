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
 * `refuseBeforeVerify(cookies)` and `refuseAfterVerify(decoded)` may return a
 * refusal message (support views, #416): the first runs before any token is
 * verified, the second only after the session is verified as current.
 *
 * @param {{ verifyToken: (token: string) => any, parseCookie: (header: string) => Record<string, string>, prisma: any,
 *   refuseBeforeVerify?: (cookies: Record<string, string | undefined>) => string | null,
 *   refuseAfterVerify?: (decoded: any) => Promise<string | null> | string | null }} deps
 */
export function createSocketAuthMiddleware({ verifyToken, parseCookie, prisma, refuseBeforeVerify = () => null, refuseAfterVerify = async () => null }) {
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
      const late = await refuseAfterVerify(decoded);
      if (late) return next(new Error(late));
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
