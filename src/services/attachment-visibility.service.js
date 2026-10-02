// Which project files the client sees (Attachment.clientVisible, PR #516).
// The bulk path behind PATCH /api/projects/:id/attachments/client-visibility:
// one action shares (or stops sharing) many files, under the same per-file
// rule as PATCH /api/attachments/:id/client-visibility.

import { PROJECT_ATTACHMENT_VISIBILITY_MAX } from '../validators/schemas.js';
import { recordRequestAuditEvent } from './audit-event.service.js';

/**
 * The uploader or an admin may change who sees a file (the single route's rule).
 * @param {{ id?: string, role?: string } | undefined} user
 * @param {{ uploadedById?: string | null }} attachment
 */
export function canChangeAttachmentVisibility(user, attachment) {
  return user?.role === 'ADMIN' || (Boolean(user?.id) && attachment.uploadedById === user.id);
}

/**
 * Set clientVisible on a project's PROJECT files, or on the listed ones.
 *
 * `db` is the tenant-scoped request.prisma, so a project or file of another
 * organization reads as missing. A listed id that is not a PROJECT file of
 * this project is skipped as `not_found`; a file the caller may not change is
 * skipped as `not_permitted`; a file already at the requested value counts as
 * unchanged. A bulk hide never hides a file the client uploaded (skipped as
 * `client_upload`); the single-file route can still hide one. Only rows whose value actually flips are written (a
 * compare-and-set, so a concurrent toggle is never audited twice), and each
 * one is audited as `attachment.client_visibility_changed` with `bulk: true`.
 *
 * @param {any} db
 * @param {any} request
 * @param {{ projectId: string, clientVisible: boolean, attachmentIds?: string[] }} input
 * @returns {Promise<{ statusCode: number, body: any }>}
 */
export async function setProjectAttachmentsClientVisibility(db, request, { projectId, clientVisible, attachmentIds }) {
  const project = await db.project.findFirst({ where: { id: projectId }, select: { id: true } });
  if (!project) return { statusCode: 404, body: { error: 'Project not found' } };

  const ids = attachmentIds ? [...new Set(attachmentIds)] : null;
  const rows = await db.attachment.findMany({
    where: { entityType: 'PROJECT', entityId: projectId, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, uploadedById: true, clientVisible: true, uploadedBy: { select: { role: true } } },
    orderBy: { createdAt: 'desc' },
    ...(ids ? {} : { take: PROJECT_ATTACHMENT_VISIBILITY_MAX + 1 }),
  });
  if (!ids && rows.length > PROJECT_ATTACHMENT_VISIBILITY_MAX) {
    return {
      statusCode: 400,
      body: {
        error: `This project has more than ${PROJECT_ATTACHMENT_VISIBILITY_MAX} files. Choose up to ${PROJECT_ATTACHMENT_VISIBILITY_MAX} at a time.`,
        code: 'TOO_MANY_FILES',
      },
    };
  }

  /** @type {{ id: string, reason: 'not_found' | 'not_permitted' | 'client_upload' }[]} */
  const skipped = [];
  if (ids) {
    const found = new Set(rows.map((row) => row.id));
    for (const id of ids) if (!found.has(id)) skipped.push({ id, reason: 'not_found' });
  }
  let unchanged = 0;
  const toChange = [];
  for (const row of rows) {
    if (row.clientVisible === clientVisible) unchanged += 1;
    else if (!clientVisible && row.uploadedBy?.role === 'CLIENT') skipped.push({ id: row.id, reason: 'client_upload' });
    else if (!canChangeAttachmentVisibility(request.user, row)) skipped.push({ id: row.id, reason: 'not_permitted' });
    else toChange.push(row.id);
  }

  let changedIds = [];
  if (toChange.length > 0) {
    const updated = await db.attachment.updateManyAndReturn({
      where: { id: { in: toChange }, entityType: 'PROJECT', entityId: projectId, clientVisible: !clientVisible },
      data: { clientVisible },
      select: { id: true },
    });
    changedIds = updated.map((row) => row.id);
    // A file another request flipped in the meantime already has the value.
    unchanged += toChange.length - changedIds.length;
  }

  for (const id of changedIds) {
    await recordRequestAuditEvent(db, request, {
      action: 'attachment.client_visibility_changed',
      entityId: id,
      metadata: { projectId, fromVisible: !clientVisible, toVisible: clientVisible, bulk: true },
    });
  }

  return { statusCode: 200, body: { changed: changedIds.length, changedIds, unchanged, skipped } };
}
