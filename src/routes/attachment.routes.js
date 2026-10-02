// File Attachment routes

import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { attachmentClientVisibilitySchema, fileUpload, validateBody } from '../validators/schemas.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { canChangeAttachmentVisibility } from '../services/attachment-visibility.service.js';
import { sendStoredFile } from '../utils/send-file.js';
import { writeUploadThenPersist } from '../utils/stored-upload.js';
import { recordRejectedUpload, sha256Hex } from '../services/upload-integrity.service.js';
import { ATTACHMENT_UNDER_REVIEW, isAttachmentUnderReview, isForeignKeyViolation } from '../services/media-review.service.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

const ENTITY_MODELS = Object.freeze({ PROJECT: 'project', TASK: 'task', NOTE: 'note', CHAT: 'chatMessage' });

async function entityExistsForTenant(prisma, entityType, entityId) {
  const model = ENTITY_MODELS[entityType];
  return model ? Boolean(await prisma[model].findFirst({ where: { id: entityId }, select: { id: true } })) : false;
}

// Ensure upload directory exists
async function ensureUploadDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    // Directory exists
  }
}

export default async function attachmentRoutes(fastify) {
  await ensureUploadDir();

  // Get attachments for an entity
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { entityType, entityId } = request.query;

    if (!entityType || !entityId) {
      return [];
    }
    if (!await entityExistsForTenant(request.prisma, entityType, entityId)) {
      return reply.status(404).send({ error: 'Entity not found' });
    }

    const attachments = await request.prisma.attachment.findMany({
      where: { entityType, entityId },
      include: {
        // The role tells the Files panel which files the client uploaded.
        uploadedBy: { select: { id: true, name: true, role: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    if (entityType !== 'PROJECT' || attachments.length === 0) return attachments;

    // A file in a review shared with the client is in the portal's Documents
    // whatever clientVisible says (CLIENT_VISIBLE_ATTACHMENT_WHERE), so the
    // Files panel shows it as visible through the review.
    const viaReview = new Set((await request.prisma.reviewSession.findMany({
      where: { attachmentId: { in: attachments.map((row) => row.id) }, sharedWithClient: true },
      select: { attachmentId: true },
    })).map((row) => row.attachmentId));
    return attachments.map((row) => ({ ...row, sharedViaReview: viaReview.has(row.id) }));
  });

  // Upload attachment
  fastify.post('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const { entityType, entityId } = data.fields;

    if (!entityType?.value || !entityId?.value) {
      return reply.status(400).send({ error: 'entityType and entityId are required' });
    }

    if (!await entityExistsForTenant(request.prisma, entityType.value, entityId.value)) {
      return reply.status(404).send({ error: 'Entity not found' });
    }

    const buffer = await data.toBuffer();
    const validation = fileUpload.validate(data.filename, data.mimetype, buffer);
    if (!validation.valid) {
      await recordRejectedUpload(request.prisma, request, {
        surface: 'attachments', validation, filename: data.filename, mimeType: data.mimetype, size: buffer.length,
        projectId: entityType.value === 'PROJECT' ? entityId.value : null,
      });
      return reply.status(400).send({ error: validation.error });
    }
    const filename = `${randomUUID()}${validation.ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // A failed row write removes the file just written (no orphan file).
    const attachment = await writeUploadThenPersist(filepath, buffer, () => request.prisma.attachment.create({
      data: {
        filename,
        originalName: data.filename,
        mimeType: validation.mimetype,
        size: buffer.length,
        path: `/uploads/${filename}`,
        // Hashed from the buffer just written (never re-read from disk).
        checksumSha256: sha256Hex(buffer),
        entityType: entityType.value,
        entityId: entityId.value,
        uploadedById: request.user.id,
        organizationId: request.user.organizationId,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } }
      }
    }));

    // Log activity if project-related
    if (entityType.value === 'PROJECT' || entityType.value === 'TASK') {
      const projectId = entityType.value === 'PROJECT'
        ? entityId.value
        : (await request.prisma.task.findUnique({ where: { id: entityId.value } }))?.projectId;

      if (projectId) {
        await request.prisma.activity.create({
          data: {
            type: 'FILE_UPLOADED',
            action: 'uploaded',
            entityType: 'ATTACHMENT',
            entityId: attachment.id,
            entityName: data.filename,
            projectId,
            userId: request.user.id
          }
        });
      }
    }

    return reply.status(201).send(attachment);
  });

  // Share a project file with the client portal (or stop sharing it). Files
  // are internal by default (Attachment.clientVisible); only PROJECT files
  // appear in the portal's Documents. Like delete: the uploader or an admin.
  fastify.patch('/:id/client-visibility', {
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(attachmentClientVisibilitySchema)],
  }, async (request, reply) => {
    const { id } = request.params;
    const { clientVisible } = request.body;

    const existing = await request.prisma.attachment.findFirst({
      where: { id, entityType: 'PROJECT' },
      select: { id: true, entityId: true, uploadedById: true, clientVisible: true },
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Attachment not found' });
    }
    if (!canChangeAttachmentVisibility(request.user, existing)) {
      return reply.status(403).send({ error: 'Only the uploader or an admin can change who sees this file' });
    }

    const updated = await request.prisma.attachment.update({
      where: { id },
      data: { clientVisible },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    if (existing.clientVisible !== clientVisible) {
      await recordRequestAuditEvent(request.prisma, request, {
        action: 'attachment.client_visibility_changed',
        entityId: id,
        metadata: { projectId: existing.entityId, fromVisible: existing.clientVisible, toVisible: clientVisible },
      });
    }
    return updated;
  });

  // Delete attachment
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await request.prisma.attachment.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Attachment not found' });
    }

    // Only uploader or admin can delete
    if (existing.uploadedById !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot delete this attachment' });
    }

    // A file under media review is approval evidence (docs/media-review.md).
    if (await isAttachmentUnderReview(request.prisma, id)) {
      return reply.status(409).send(ATTACHMENT_UNDER_REVIEW);
    }

    // Remove the row first: if a review started in the meantime, the
    // RESTRICT foreign key refuses and the file stays on disk.
    try {
      await request.prisma.attachment.delete({ where: { id } });
    } catch (err) {
      if (isForeignKeyViolation(err)) return reply.status(409).send(ATTACHMENT_UNDER_REVIEW);
      throw err;
    }

    // Delete file from disk
    try {
      const filepath = path.join(process.cwd(), existing.path);
      await fs.unlink(filepath);
    } catch (err) {
      // File may not exist
    }

    return { success: true };
  });

  // Serve uploaded files (auth required — files are keyed by UUID but must not
  // be world-readable to anyone who guesses/leaks a filename).
  fastify.get('/uploads/:filename', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const safeName = path.basename(request.params.filename);
    if (!safeName || safeName !== request.params.filename || safeName.includes('..')) {
      return reply.status(400).send({ error: 'Invalid filename' });
    }
    const filepath = path.join(UPLOAD_DIR, safeName);

    try {
      const attachment = await request.prisma.attachment.findFirst({
        where: { filename: safeName }
      });
      if (!attachment) {
        return reply.status(404).send({ error: 'File not found' });
      }

      const media = attachment.mimeType.startsWith('video/') || attachment.mimeType.startsWith('audio/');
      // Header-safe name for any filename, and byte ranges for media so the
      // staff review player can seek.
      const sent = await sendStoredFile(request, reply, {
        filepath,
        mimeType: attachment.mimeType,
        fileName: attachment.originalName,
        disposition: media ? 'inline' : 'attachment',
        allowRanges: media,
      });
      if (sent === null) return reply.status(404).send({ error: 'File not found' });
      return sent;
    } catch (err) {
      return reply.status(404).send({ error: 'File not found' });
    }
  });
}
