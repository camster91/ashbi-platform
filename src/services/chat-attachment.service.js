// @ts-check
// Chat media (docs/chat-media.md): files and recordings inside chat messages.
//
// Upload first, send second. A composer uploads each file as a *pending* chat
// attachment (entityType CHAT_PENDING, entityId = the project) owned by the
// uploader. Sending the message claims the listed pending files in the same
// transaction that creates the message (entityType CHAT, entityId = the
// message), so a message never points at a file that failed to upload and a
// file is never attached to a message its uploader did not send. Files that
// are never sent are purged after PENDING_CHAT_UPLOAD_TTL_MS by the scheduled
// maintenance worker (src/jobs/chat-upload-cleanup.js).
//
// Visibility. Staff see every chat file of their organization's projects. A
// client-portal user sees a chat file only when it is attached to a
// CLIENT-visible, not-deleted message of a project of their own client; the
// client shape (toClientAttachmentPayload) carries no storage filename,
// uploader or organization, and its URL is the client-portal download route,
// which re-checks all of that server side.

import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateUploadedFile } from '../security/file-upload-policy.js';
import { isQuarantined } from './media-review.service.js';

export const CHAT_ATTACHMENT_ENTITY = 'CHAT';
export const CHAT_PENDING_ENTITY = 'CHAT_PENDING';
export const MAX_CHAT_ATTACHMENTS = 10;
export const PENDING_CHAT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
// Unsent uploads one person may hold per project at a time (a message sends
// at most MAX_CHAT_ATTACHMENTS). Bounds disk use by abandoned drafts between
// purges.
export const MAX_PENDING_CHAT_UPLOADS_PER_UPLOADER = 30;

export const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

/** Staff download route for a stored upload. */
export function staffAttachmentUrl(filename) {
  return `/api/attachments/uploads/${encodeURIComponent(filename)}`;
}

/** Client-portal download route for a chat attachment. */
export function clientChatAttachmentUrl(id) {
  return `/api/client-portal/chat-attachments/${encodeURIComponent(id)}`;
}

export class ChatAttachmentError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} code
   */
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'ChatAttachmentError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Reply for a ChatAttachmentError (its messages are fixed and caller-safe);
 * anything else is rethrown to the sanitised error handler.
 * @param {any} reply
 * @param {unknown} err
 */
export function sendChatAttachmentError(reply, err) {
  if (err instanceof ChatAttachmentError) {
    return reply.status(err.statusCode).send({ error: err.message, code: err.code });
  }
  throw err;
}

/**
 * Validate a multipart file (extension + MIME + magic bytes, 50 MB) and write
 * it under a random name. Returns the stored-file fields of an Attachment row,
 * or `{ error }` when the file is refused.
 *
 * @param {{ filename: string, mimetype: string, toBuffer: () => Promise<Buffer> }} file
 * @param {{ uploadDir?: string }} [options]
 */
export async function storeValidatedUpload(file, { uploadDir = UPLOAD_DIR } = {}) {
  const buffer = await file.toBuffer();
  const validation = validateUploadedFile(file.filename, file.mimetype, buffer);
  if (!validation.valid) return { error: validation.error };
  await fs.mkdir(uploadDir, { recursive: true });
  const filename = `${randomUUID()}${validation.ext}`;
  await fs.writeFile(path.join(uploadDir, filename), buffer);
  return {
    stored: {
      filename,
      originalName: path.basename(file.filename),
      mimeType: validation.mimetype,
      size: buffer.length,
      path: `/uploads/${filename}`,
    },
  };
}

/**
 * Remove a stored upload from disk; a missing file is not an error.
 * @param {string} storedPath e.g. `/uploads/<uuid>.png`
 */
export async function unlinkStoredUpload(storedPath) {
  if (!storedPath || !storedPath.startsWith('/uploads/')) return;
  try {
    await fs.unlink(path.join(process.cwd(), storedPath));
  } catch (err) {
    if (/** @type {any} */ (err)?.code !== 'ENOENT') throw err;
  }
}

/**
 * Normalise the attachment ids a message create request lists: unique, at most
 * MAX_CHAT_ATTACHMENTS.
 * @param {unknown} ids
 * @returns {string[]}
 */
export function normaliseAttachmentIds(ids) {
  if (!Array.isArray(ids)) return [];
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  if (unique.length > MAX_CHAT_ATTACHMENTS) {
    throw new ChatAttachmentError(`A message can carry at most ${MAX_CHAT_ATTACHMENTS} attachments`, 400, 'TOO_MANY_ATTACHMENTS');
  }
  return unique;
}

/**
 * Claim pending uploads for a message. Must run inside the transaction that
 * created the message: when any listed id is not a pending upload of this
 * uploader for this project (already sent, someone else's, another project's,
 * purged), it throws and the whole send rolls back.
 *
 * @param {any} tx transaction client
 * @param {{ attachmentIds: string[], projectId: string, uploadedById: string, messageId: string }} claim
 */
export async function claimPendingChatAttachments(tx, { attachmentIds, projectId, uploadedById, messageId }) {
  if (attachmentIds.length === 0) return 0;
  const result = await tx.attachment.updateMany({
    where: {
      id: { in: attachmentIds },
      entityType: CHAT_PENDING_ENTITY,
      entityId: projectId,
      uploadedById,
    },
    data: { entityType: CHAT_ATTACHMENT_ENTITY, entityId: messageId },
  });
  if (result.count !== attachmentIds.length) {
    throw new ChatAttachmentError(
      'One or more attachments are no longer available to send. Remove them and upload again.',
      409,
      'ATTACHMENT_NOT_PENDING',
    );
  }
  return result.count;
}

const ATTACHMENT_SELECT = Object.freeze({
  id: true,
  entityId: true,
  filename: true,
  originalName: true,
  mimeType: true,
  size: true,
  path: true,
  uploadedById: true,
  createdAt: true,
});

/**
 * One query for the files of many messages (legacy upload-after files and
 * claimed uploads alike: both are entityType CHAT keyed by message id).
 *
 * @param {any} prisma
 * @param {string[]} messageIds
 * @returns {Promise<Map<string, any[]>>}
 */
export async function loadChatAttachments(prisma, messageIds) {
  const byMessage = new Map();
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (ids.length === 0) return byMessage;
  const rows = await prisma.attachment.findMany({
    where: { entityType: CHAT_ATTACHMENT_ENTITY, entityId: { in: ids } },
    select: ATTACHMENT_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  for (const row of rows) {
    if (!byMessage.has(row.entityId)) byMessage.set(row.entityId, []);
    byMessage.get(row.entityId).push(row);
  }
  return byMessage;
}

/**
 * Staff shape of a chat attachment.
 * @param {Record<string, any>} attachment
 */
export function toStaffAttachmentPayload(attachment) {
  return {
    id: attachment.id,
    filename: attachment.filename,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    uploadedById: attachment.uploadedById,
    createdAt: attachment.createdAt,
    quarantined: isQuarantined(attachment),
    url: staffAttachmentUrl(attachment.filename),
  };
}

export const CLIENT_ATTACHMENT_FIELDS = Object.freeze(['id', 'name', 'mimeType', 'size', 'url']);

/**
 * Client-portal shape: id, display name, MIME type, size and the client-portal
 * download URL only. Quarantined files are withheld.
 * @param {Record<string, any>} attachment
 * @returns {Record<string, any> | null}
 */
export function toClientAttachmentPayload(attachment) {
  if (!attachment || isQuarantined(attachment)) return null;
  return {
    id: attachment.id,
    name: attachment.originalName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: clientChatAttachmentUrl(attachment.id),
  };
}

/**
 * Attach `attachments` (raw rows) to each message and its replies.
 * @param {any[]} messages
 * @param {Map<string, any[]>} byMessage
 */
export function withAttachments(messages, byMessage) {
  return messages.map((message) => ({
    ...message,
    attachments: byMessage.get(message.id) ?? [],
    ...(Array.isArray(message.replies) ? { replies: withAttachments(message.replies, byMessage) } : {}),
  }));
}

/**
 * Every message id in a page, replies included.
 * @param {any[]} messages
 * @returns {string[]}
 */
export function messageIdsOf(messages) {
  return messages.flatMap((message) => [message.id, ...(Array.isArray(message.replies) ? messageIdsOf(message.replies) : [])]);
}

/**
 * Whether a client-portal user may read this chat attachment: it must be a
 * sent (CHAT) attachment, not quarantined, of the client's organization, on a
 * CLIENT-visible message that is not deleted, in a project of the client's
 * own client record. Anything else resolves to null (the route answers 404,
 * so a client cannot probe whether an id exists).
 *
 * @param {any} prisma
 * @param {{ attachmentId: string, clientId: string, organizationId: string }} principal
 */
export async function findClientReadableChatAttachment(prisma, { attachmentId, clientId, organizationId }) {
  if (!attachmentId || !clientId) return null;
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.entityType !== CHAT_ATTACHMENT_ENTITY || isQuarantined(attachment)) return null;
  if (organizationId && attachment.organizationId !== organizationId) return null;
  const message = await prisma.chatMessage.findFirst({
    where: {
      id: attachment.entityId,
      visibility: 'CLIENT',
      removedAt: null,
      project: { clientId },
    },
    select: { id: true },
  });
  return message ? attachment : null;
}

/**
 * Delete pending chat uploads older than the TTL: the row first, then the
 * file. A row that cannot be deleted (for example a media-review foreign key)
 * is kept and counted as failed; the next run retries it.
 *
 * @param {any} prisma an unscoped client (maintenance job)
 * @param {{ now?: Date, ttlMs?: number, unlink?: (storedPath: string) => Promise<void>, batchSize?: number }} [options]
 */
export async function purgeStalePendingChatUploads(prisma, {
  now = new Date(),
  ttlMs = PENDING_CHAT_UPLOAD_TTL_MS,
  unlink = unlinkStoredUpload,
  batchSize = 500,
} = {}) {
  const cutoff = new Date(now.getTime() - ttlMs);
  const stale = await prisma.attachment.findMany({
    where: { entityType: CHAT_PENDING_ENTITY, createdAt: { lt: cutoff } },
    select: { id: true, path: true },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });
  let purged = 0;
  let failed = 0;
  for (const row of stale) {
    try {
      // Only still-pending rows: a message send that claimed the file between
      // the read and this delete keeps it.
      const deleted = await prisma.attachment.deleteMany({ where: { id: row.id, entityType: CHAT_PENDING_ENTITY } });
      if (deleted.count === 1) {
        await unlink(row.path);
        purged++;
      }
    } catch (err) {
      failed++;
      console.error(`[chat-upload-cleanup] Keeping pending upload ${row.id} for retry:`, /** @type {any} */ (err)?.message);
    }
  }
  return { examined: stale.length, purged, failed, cutoff: cutoff.toISOString() };
}
