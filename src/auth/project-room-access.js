/**
 * Project realtime rooms.
 *
 * Every project has two Socket.IO rooms:
 *
 * - `project:{id}` — the internal room. Staff in the project's organization
 *   join it and receive full project/task rows, all chat (internal and
 *   client-visible), edits, reactions and call signalling.
 * - `project:{id}:client` — the client room. A client-portal session joins
 *   only this room, and only for projects of its own client record. It
 *   receives client-visible chat and whitelisted project/task fields, never
 *   internal chat, budgets, AI summaries, risks, drafts or share tokens.
 *
 * Client-portal sessions carry the agency's organizationId (their client
 * belongs to it), so organization membership must never authorize a CLIENT
 * for the internal room.
 */

import { toClientAttachmentPayload } from '../services/chat-attachment.service.js';

/** @param {string} projectId */
export function projectRoom(projectId) {
  return `project:${projectId}`;
}

/** @param {string} projectId */
export function clientProjectRoom(projectId) {
  return `project:${projectId}:client`;
}

/**
 * Decide which realtime room, if any, an authenticated socket may join for a
 * project: 'internal' for staff of the project's organization, 'client' for
 * the project's own client, otherwise null.
 *
 * @param {{ userRole?: string, organizationId?: string, clientId?: string }} principal
 * @param {{ clientId?: string | null, client?: { organizationId?: string | null } | null } | null} project
 * @returns {'internal' | 'client' | null}
 */
export function projectRoomAccess(principal, project) {
  if (!principal || !project) return null;
  if (principal.userRole === 'CLIENT') {
    return Boolean(principal.clientId) && project.clientId === principal.clientId ? 'client' : null;
  }
  return Boolean(principal.organizationId) && project.client?.organizationId === principal.organizationId
    ? 'internal'
    : null;
}

/**
 * Whether the socket may join any room of this project.
 *
 * @param {{ userRole?: string, organizationId?: string, clientId?: string }} principal
 * @param {{ clientId?: string | null, client?: { organizationId?: string | null } | null } | null} project
 * @returns {boolean}
 */
export function canJoinProjectRoom(principal, project) {
  return projectRoomAccess(principal, project) !== null;
}

/**
 * Build the `join-project` socket handler. Staff join the internal room;
 * client-portal sessions join the client room. The optional acknowledgement
 * lets a client that just (re)connected wait until the room is actually
 * joined before sending call presence or signals, which the server drops for
 * sockets that are not yet in the internal project room.
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
      const access = projectRoomAccess(socket, project);
      if (access === 'internal') socket.join(projectRoom(projectId));
      else if (access === 'client') socket.join(clientProjectRoom(projectId));
      reply(access ? { joined: true, room: access } : { joined: false });
    } catch (err) {
      logger?.error({ err, projectId }, '[socket] join-project authorization failed');
      reply({ joined: false });
    }
  };
}

/**
 * Build the `leave-project` handler: leaves whichever room of the project the
 * socket is in.
 *
 * @param {{ leave: (room: string) => void }} socket
 */
export function createLeaveProjectHandler(socket) {
  return (projectId) => {
    if (!projectId || typeof projectId !== 'string') return;
    socket.leave(projectRoom(projectId));
    socket.leave(clientProjectRoom(projectId));
  };
}

// Fields a client may see in realtime project/task broadcasts. Mirrors what
// the client portal's own project and task endpoints return; anything not
// listed (budget, aiSummary, risks, draftData, viewToken, internal notes...)
// never reaches a client socket.
export const CLIENT_PROJECT_FIELDS = Object.freeze([
  'id', 'name', 'status', 'startDate', 'endDate', 'updatedAt',
]);
export const CLIENT_TASK_FIELDS = Object.freeze([
  'id', 'projectId', 'title', 'status', 'dueDate', 'completedAt', 'updatedAt',
]);

/**
 * @param {Record<string, any> | null | undefined} row
 * @param {readonly string[]} fields
 */
function pick(row, fields) {
  const out = {};
  for (const field of fields) {
    if (row && Object.prototype.hasOwnProperty.call(row, field)) out[field] = row[field];
  }
  return out;
}

/** @param {Record<string, any>} project */
export function toClientProjectPayload(project) {
  return pick(project, CLIENT_PROJECT_FIELDS);
}

export const CLIENT_CHAT_FIELDS = Object.freeze([
  'id', 'projectId', 'content', 'type', 'visibility', 'parentId', 'authorId',
  'isEdited', 'editedAt', 'createdAt', 'updatedAt',
]);

/**
 * The client-portal shape of a CLIENT chat message: no metadata (mentions,
 * integration details), reactions, external identifiers or staff emails.
 * Returns null for anything that is not client-visible, so the files of an
 * INTERNAL message never reach a client. Attachments, when the message
 * carries them, are reduced to the client shape (id, name, MIME type, size,
 * client-portal download URL; docs/chat-media.md).
 *
 * @param {Record<string, any>} message
 * @returns {Record<string, any> | null}
 */
export function toClientChatPayload(message) {
  if (!message || message.visibility !== 'CLIENT' || message.removedAt) return null;
  const payload = pick(message, CLIENT_CHAT_FIELDS);
  if (message.author) payload.author = { id: message.author.id, name: message.author.name };
  payload.attachments = Array.isArray(message.attachments)
    ? message.attachments.map(toClientAttachmentPayload).filter(Boolean)
    : [];
  return payload;
}

/**
 * Emit a chat event: staff (internal room) always get `staffPayload`; the
 * client room gets `clientPayload` only when the message is client-visible.
 *
 * @param {{ to: (room: string) => { emit: (event: string, payload: any) => void } }} io
 * @param {{ projectId: string, visibility?: string | null }} message
 * @param {string} event
 * @param {any} staffPayload
 * @param {any} [clientPayload]
 */
export function emitChatEvent(io, message, event, staffPayload, clientPayload) {
  io.to(projectRoom(message.projectId)).emit(event, staffPayload);
  if (message.visibility === 'CLIENT' && clientPayload) {
    io.to(clientProjectRoom(message.projectId)).emit(event, clientPayload);
  }
}

/**
 * Subtasks are not part of the client portal's task board, so they are not
 * broadcast to clients at all.
 *
 * @param {Record<string, any>} task
 * @returns {Record<string, any> | null}
 */
export function toClientTaskPayload(task) {
  if (!task || task.parentId) return null;
  return pick(task, CLIENT_TASK_FIELDS);
}

// A mention notification carries the author and message ids, so it follows
// the message's visibility: client users are notified only of client-visible
// messages on their own client's project.
export function mayNotifyMention(user, visibility, project) {
  if (user.role !== 'CLIENT') return true;
  return visibility === 'CLIENT' && Boolean(user.clientId) && user.clientId === project.clientId;
}
