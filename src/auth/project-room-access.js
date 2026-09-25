/**
 * Decide whether an authenticated socket may join a project's realtime room.
 *
 * Project rooms carry task, project, chat and call events. Staff may join any
 * project in their own organization. Client-portal sessions also carry the
 * agency's organizationId (their client belongs to it), so organization
 * membership must never authorize a CLIENT: a client may join only the
 * projects of its own client record.
 *
 * @param {{ userRole?: string, organizationId?: string, clientId?: string }} principal
 * @param {{ clientId?: string | null, client?: { organizationId?: string | null } | null } | null} project
 * @returns {boolean}
 */
export function canJoinProjectRoom(principal, project) {
  if (!principal || !project) return false;
  if (principal.userRole === 'CLIENT') {
    return Boolean(principal.clientId) && project.clientId === principal.clientId;
  }
  return Boolean(principal.organizationId) && project.client?.organizationId === principal.organizationId;
}
