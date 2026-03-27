// File Attachment routes

import { prisma } from '../index.js';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

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
  }, async (request) => {
    const { entityType, entityId } = request.query;

    if (!entityType || !entityId) {
      return [];
    }

    const attachments = await prisma.attachment.findMany({
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

    // Generate unique filename
    const ext = path.extname(data.filename);
    const filename = `${randomUUID()}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Save file
    const buffer = await data.toBuffer();
    await fs.writeFile(filepath, buffer);

    const attachment = await prisma.attachment.create({
      data: {
        filename,
        originalName: data.filename,
        mimeType: data.mimetype,
        size: buffer.length,
        path: `/uploads/${filename}`,
        entityType: entityType.value,
        entityId: entityId.value,
        uploadedById: request.user.id
      },
      include: {
        uploadedBy: { select: { id: true, name: true } }
      }
    });

    // Log activity if project-related
    if (entityType.value === 'PROJECT' || entityType.value === 'TASK') {
      const projectId = entityType.value === 'PROJECT'
        ? entityId.value
        : (await prisma.task.findUnique({ where: { id: entityId.value } }))?.projectId;

      if (projectId) {
        await prisma.activity.create({
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

    const existing = await prisma.attachment.findUnique({ where: { id } });

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

    await prisma.attachment.delete({ where: { id } });

    return { success: true };
  });

  // Serve uploaded files
  fastify.get('/uploads/:filename', async (request, reply) => {
    const { filename } = request.params;
    const filepath = path.join(UPLOAD_DIR, filename);

    try {
      const stat = await fs.stat(filepath);
      const file = await fs.readFile(filepath);

      // Get mime type from attachment record
      const attachment = await prisma.attachment.findFirst({
        where: { filename }
      });

      reply.header('Content-Type', attachment?.mimeType || 'application/octet-stream');
      reply.header('Content-Length', stat.size);

      return reply.send(file);
    } catch (err) {
      return reply.status(404).send({ error: 'File not found' });
    }
  });
}
