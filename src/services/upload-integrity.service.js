// @ts-check
// Upload integrity (#417, docs/media-review.md "Upload checksums"):
//
// - every newly stored attachment records the SHA-256 of the bytes written,
//   computed from the same in-memory buffer that is written to disk (the file
//   is never read back to hash it);
// - an upload the file policy refuses is recorded as an `upload.rejected`
//   audit event (docs/audit-events.md) with the refusal code, never the file
//   name or its content.

import { createHash } from 'node:crypto';
import path from 'node:path';
import { recordRequestAuditEvent } from './audit-event.service.js';

/** Where an upload came in; the `surface` of an `upload.rejected` event. */
export const UPLOAD_SURFACES = Object.freeze([
  'attachments',
  'chat',
  'client_portal_chat',
  'client_portal_documents',
  'expense_receipt',
]);

/**
 * Lowercase hex SHA-256 of a buffer.
 * @param {Buffer | Uint8Array} buffer
 */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Whether a value is a lowercase hex SHA-256 (the stored column format). */
export function isSha256Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Record a refused upload. Best-effort like every audit write: it never
 * throws into the request that is already answering 400.
 *
 * @param {any} prisma request-scoped (staff) or raw (client portal) client
 * @param {any} request
 * @param {{
 *   surface: string,
 *   validation: { code?: string, error?: string },
 *   filename?: string, mimeType?: string, size?: number,
 *   projectId?: string | null, organizationId?: string | null,
 *   actorType?: string, actorUserId?: string | null,
 * }} rejected
 */
export function recordRejectedUpload(prisma, request, rejected) {
  const extension = path.extname(path.basename(String(rejected.filename || ''))).toLowerCase().slice(0, 16);
  /** @type {Record<string, unknown>} */
  const event = {
    action: 'upload.rejected',
    entityId: null,
    metadata: {
      surface: rejected.surface,
      reason: rejected.validation?.code ?? 'INVALID_FILE',
      mimeType: rejected.mimeType ? String(rejected.mimeType).toLowerCase() : null,
      size: Number.isFinite(rejected.size) ? rejected.size : null,
      extension: extension || null,
      projectId: rejected.projectId ?? null,
    },
  };
  if (rejected.organizationId) event.organizationId = rejected.organizationId;
  if (rejected.actorType) event.actorType = rejected.actorType;
  if (rejected.actorUserId !== undefined) event.actorUserId = rejected.actorUserId;
  return recordRequestAuditEvent(prisma, request, /** @type {any} */ (event));
}
