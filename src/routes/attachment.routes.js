// File Attachment routes

import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { fileUpload } from '../validators/schemas.js';

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
  fastify.get('/attachments', {
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
        uploadedBy: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return attachments;
  });

  // Upload attachment
  fastify.post('/attachments', {
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
    if (!validation.valid) return reply.status(400).send({ error: validation.error });
    const filename = `${randomUUID()}${validation.ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    await fs.writeFile(filepath, buffer);

    const attachment = await request.prisma.attachment.create({
      data: {
        filename,
        originalName: data.filename,
        mimeType: validation.mimetype,
        size: buffer.length,
        path: `/uploads/${filename}`,
        entityType: entityType.value,
        entityId: entityId.value,
        uploadedById: request.user.id,
        organizationId: request.user.organizationId,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } }
      }
    });

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

  // Delete attachment
  fastify.delete('/attachments/:id', {
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

    // Delete file from disk
    try {
      const filepath = path.join(process.cwd(), existing.path);
      await fs.unlink(filepath);
    } catch (err) {
      // File may not exist
    }

    await request.prisma.attachment.delete({ where: { id } });

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

      const stat = await fs.stat(filepath);
      const file = await fs.readFile(filepath);

      reply.header('Content-Type', attachment.mimeType || 'application/octet-stream');
      reply.header('Content-Length', stat.size);
      reply.header('Content-Disposition', `attachment; filename="${path.basename(attachment.originalName).replace(/["\\\r\n]/g, '_')}"`);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Security-Policy', "default-src 'none'; sandbox");

      return reply.send(file);
    } catch (err) {
      return reply.status(404).send({ error: 'File not found' });
    }
  });
}
