// @ts-check
// The client-portal principal behind a `client_session` (or magic-link)
// payload, re-read from the database: an active CLIENT user, a contact of the
// same client with the same email, and a client that is not deleted, paused,
// archived or churned, all in one organization, with a current
// sessionVersion. Anything else is null, so pausing or archiving the client,
// removing the contact or deactivating the user revokes access on the next
// portal request (clientAuth in src/routes/client-portal.routes.js) and the
// next Socket.IO handshake or room join (src/auth/socket-auth.js).

/**
 * @param {any} prisma raw Prisma client (the portal is tenancy-exempt)
 * @param {any} payload verified token claims
 */
export async function resolvePortalPrincipal(prisma, payload) {
  if (!payload?.id || !payload?.contactId || !payload?.clientId || payload.role !== 'CLIENT') return null;

  const [user, contact, client] = await Promise.all([
    prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, name: true, role: true, clientId: true, organizationId: true, isActive: true, sessionVersion: true },
    }),
    prisma.contact.findFirst({
      where: { id: payload.contactId, clientId: payload.clientId },
      select: { id: true, email: true, name: true, clientId: true },
    }),
    prisma.client.findFirst({
      where: {
        id: payload.clientId,
        deletedAt: null,
        status: 'ACTIVE',
        relationshipStatus: { notIn: ['ARCHIVED', 'CHURNED'] },
      },
      select: { id: true, organizationId: true, name: true },
    }),
  ]);

  if (!user?.isActive || user.role !== 'CLIENT' || user.clientId !== payload.clientId) return null;
  if (!contact || !client || user.organizationId !== client.organizationId) return null;
  if (user.email.toLowerCase() !== contact.email.toLowerCase()) return null;
  if (payload.organizationId && payload.organizationId !== client.organizationId) return null;
  if (!Number.isInteger(payload.sessionVersion) || payload.sessionVersion !== user.sessionVersion) return null;

  return { user, contact, client };
}
