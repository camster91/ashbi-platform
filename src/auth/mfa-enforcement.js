// Organization-level MFA enforcement (#416 follow-up).
// Policy: docs/privileged-actions.md#organization-mfa-requirement.
//
// An organization administrator can require two-factor authentication for
// every staff member (`organizations.mfaRequired`). Sign-in is unchanged: a
// staff member who has not enrolled still signs in with their password (one
// who has enrolled completes the second factor as always). Instead, a global
// preHandler (registered in src/index.js) checks the database on every /api
// request made with a staff identity and, while the requirement applies,
// refuses everything except the routes in MFA_ENROLLMENT_ALLOWED_ROUTES with
//
//   403 { code: "MFA_ENROLLMENT_REQUIRED" }
//
// Because the check reads the database on each request (not a claim in the
// session token), it takes effect on existing sessions the moment an
// administrator turns the requirement on, is lifted the moment the person
// confirms enrollment (no new sign-in), and is lifted for everyone the moment
// it is turned off. An admin resetting someone's two-factor, or someone
// turning their own off, puts that person back under the restriction at once.
//
// Whose enrollment counts: the person who authenticated the request. During a
// support view that is the viewing admin (request.impersonation.actorUserId),
// never the viewed person, so a view cannot be used to escape the admin's own
// restriction. API keys act as their owner, so an owner who must enroll cannot
// use their keys either. Client-portal users and bots are out of scope: they
// cannot enroll in two-factor (MFA_INELIGIBLE_ROLES in src/auth/mfa.js).

import defaultLogger from '../utils/logger.js';
import { isMfaEligible, isMfaRequired } from './mfa.js';
import { normalizedPath } from './impersonation.js';
import { isUserSessionPayload } from './session.js';

export const MFA_ENROLLMENT_REQUIRED_CODE = 'MFA_ENROLLMENT_REQUIRED';
export const MFA_SELF_ENROLLMENT_REQUIRED_CODE = 'MFA_SELF_ENROLLMENT_REQUIRED';

/**
 * What a staff session that must enroll may still do: read who it is, enroll,
 * sign out, end a support view it had open, and the credential-exchange
 * endpoints that never act with the session's authority (signing in again,
 * password recovery, break-glass redemption, the client portal). Matched on
 * the method and the route pattern the router chose (HEAD counts as GET).
 */
export const MFA_ENROLLMENT_ALLOWED_ROUTES = Object.freeze([
  // Identity and sign-out
  'GET /api/auth/me',
  'POST /api/auth/logout',
  'POST /api/auth/impersonation/stop',
  // Enrollment
  'GET /api/auth/mfa',
  'POST /api/auth/mfa/enroll',
  'POST /api/auth/mfa/confirm',
  // Credential exchange (no session authority)
  'POST /api/auth/login',
  'POST /api/auth/login/mfa',
  'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password',
  'POST /api/auth/client/login',
  'POST /api/auth/client/signup',
  'POST /api/auth/break-glass/redeem',
  // Public probes
  'GET /api/live',
  'GET /api/health',
]);

const ALLOWED = new Set(MFA_ENROLLMENT_ALLOWED_ROUTES);

/**
 * Whether a request may proceed while its identity must enroll.
 * @param {string} method
 * @param {string} routeUrl the matched route pattern (request.routeOptions.url)
 */
export function isMfaEnrollmentAllowedRoute(method, routeUrl) {
  const verb = String(method || '').toUpperCase() === 'HEAD' ? 'GET' : String(method || '').toUpperCase();
  return ALLOWED.has(`${verb} ${routeUrl}`);
}

/**
 * Whether the organization requires two-factor authentication and this
 * person must still enroll: an eligible staff role, in an organization with
 * the requirement on, without two-factor enabled.
 * @param {{ role?: string, mfaEnabled?: boolean, mfaSecret?: string | null, organization?: { mfaRequired?: boolean } | null } | null} user
 */
export function mustEnrollMfa(user) {
  if (!user || !isMfaEligible(user)) return false;
  if (user.organization?.mfaRequired !== true) return false;
  return !isMfaRequired(user);
}

export const MFA_POLICY_USER_SELECT = Object.freeze({
  role: true,
  isActive: true,
  mfaEnabled: true,
  mfaSecret: true,
  organizationId: true,
  organization: { select: { mfaRequired: true } },
});

/**
 * Read the requirement for a user id (one primary-key lookup with the
 * organization joined). Resolves to false for an unknown user.
 * @param {any} prisma raw client (not tenant-scoped)
 * @param {string | null | undefined} userId
 */
export async function isMfaEnrollmentRequired(prisma, userId) {
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: MFA_POLICY_USER_SELECT });
  return mustEnrollMfa(user);
}

export function sendMfaEnrollmentRequired(reply) {
  return reply.status(403).send({
    error: 'Your organization requires two-factor authentication. Set it up to continue.',
    code: MFA_ENROLLMENT_REQUIRED_CODE,
  });
}

function bearerToken(request) {
  const header = request.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * The id of the person who authenticated this request, or null.
 *
 * Route guards (`fastify.authenticate`, `adminOnly`, the API key guard) have
 * already run and set `request.user`; during a support view the actor is the
 * admin. A few /api/auth handlers verify the session themselves after this
 * hook (`POST /api/auth/register` for admins), so a verifiable session token
 * on the request counts too. Restricting on a token that later turns out to be
 * stale is harmless: the route would have refused it anyway.
 * @param {any} request
 * @param {(token: string) => any} verifySessionToken
 */
export function requestPrincipalId(request, verifySessionToken) {
  if (request.impersonation?.actorUserId) return request.impersonation.actorUserId;
  if (typeof request.user?.id === 'string' && request.user.id) return request.user.id;
  // Only /api/auth handlers verify a staff session themselves. Elsewhere a
  // route that set no request.user does not act with staff authority (public
  // portal, proposal, estimate and share links; the client portal accepts
  // only client sessions), so a staff cookie that happens to be in the
  // browser must not put those routes under the staff restriction.
  const routeUrl = request.routeOptions?.url;
  if (typeof routeUrl !== 'string' || !routeUrl.startsWith('/api/auth/')) return null;
  const token = bearerToken(request) || request.cookies?.token;
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = verifySessionToken(token);
    return isUserSessionPayload(payload) ? payload.id : null;
  } catch {
    return null;
  }
}

/**
 * Build the global preHandler. It runs after every route's own onRequest
 * guard and before the tenancy middleware.
 * @param {{ prisma: any, verifySessionToken: (token: string) => any, logger?: any }} deps
 */
export function createMfaEnforcementHook({ prisma, verifySessionToken, logger = defaultLogger }) {
  return async function mfaEnforcementHook(request, reply) {
    const path = normalizedPath(request.url);
    if (!path.startsWith('/api/')) return undefined;
    // Unmatched URLs answer 404 anyway. Matching on the router's pattern
    // (not the raw URL) means an encoded or doubled path cannot pass as an
    // allowed one.
    const routeUrl = request.routeOptions?.url;
    if (!routeUrl) return undefined;
    if (isMfaEnrollmentAllowedRoute(request.method, routeUrl) && routeUrl === path) return undefined;

    const principalId = requestPrincipalId(request, verifySessionToken);
    if (!principalId) return undefined;

    let required;
    try {
      required = await isMfaEnrollmentRequired(prisma, principalId);
    } catch (err) {
      // Fail closed: never let a lookup failure skip the requirement.
      logger.error({ err: { message: err?.message } }, 'MFA requirement lookup failed');
      return reply.status(503).send({ error: 'Unable to verify your security settings. Try again.' });
    }
    if (required) return sendMfaEnrollmentRequired(reply);
    return undefined;
  };
}
