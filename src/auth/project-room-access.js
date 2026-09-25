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

/**
 * Build the `join-project` socket handler. The optional acknowledgement lets a
 * client that just (re)connected wait until the room is actually joined before
 * sending call presence or signals, which the server drops for sockets that
 * are not yet in the project room.
 *
 * @param {{ userRole?: string, organizationId?: string, clientId?: string, join: (room: string) => void }} socket
 * @param {{ findProject: (projectId: string) => Promise<any>, logger?: { error: Function } }} deps
 */
export function createJoinProjectHandler(socket, { findProject, logger }) {
  return async (projectId, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!projectId || typeof projectId !== 'string') return reply({ joined: false });
    try {
      const project = await findProject(projectId);
      const joined = canJoinProjectRoom(socket, project);
      if (joined) socket.join(`project:${projectId}`);
      reply({ joined });
    } catch (err) {
      logger?.error({ err, projectId }, '[socket] join-project authorization failed');
      reply({ joined: false });
    }
  };
}
