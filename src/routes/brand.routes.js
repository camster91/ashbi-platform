// Brand Settings routes — get, update, logo upload

import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { validateBody, brandSettingsSchema, fileUpload } from '../validators/schemas.js';
import {
  DEFAULT_UPLOADS_DIR, brandLogoRelativePath, removeStoredBrandLogo, sendStoredUpload, writeUploadThenPersist,
} from '../utils/stored-upload.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ uploadsDir?: string }} [options]
 */
export default async function brandRoutes(fastify, options = {}) {
  const uploadsDir = options.uploadsDir ?? DEFAULT_UPLOADS_DIR;

  // ─── GET / — get brand settings (create default if none) ────────────────────
  fastify.get('/', { onRequest: [fastify.authenticate] }, async () => {
    let settings = await fastify.prisma.brandSettings.findFirst();

    if (!settings) {
      settings = await fastify.prisma.brandSettings.create({ data: {} });
    }

    return settings;
  });

  // ─── PUT / — update brand settings (admin only) ─────────────────────────────
  fastify.put('/', { onRequest: [fastify.adminOnly],
    preHandler: validateBody(brandSettingsSchema),
  }, async (request, reply) => {
    const {
      companyName, primaryColor, accentColor, address, phone, email,
      website, taxId, invoiceFooter, proposalFooter, contractHeader,
    } = request.body || {};

    let settings = await fastify.prisma.brandSettings.findFirst();
    if (!settings) {
      settings = await fastify.prisma.brandSettings.create({ data: {} });
    }

    const updated = await fastify.prisma.brandSettings.update({
      where: { id: settings.id },
      data: {
        ...(companyName !== undefined && { companyName }),
        ...(primaryColor !== undefined && { primaryColor }),
        ...(accentColor !== undefined && { accentColor }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(website !== undefined && { website }),
        ...(taxId !== undefined && { taxId }),
        ...(invoiceFooter !== undefined && { invoiceFooter }),
        ...(proposalFooter !== undefined && { proposalFooter }),
        ...(contractHeader !== undefined && { contractHeader }),
      },
    });

    return updated;
  });

  // ─── POST /logo — upload logo image (multipart) ─────────────────────────────
  fastify.post('/logo', { onRequest: [fastify.adminOnly] }, async (request, reply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const buffer = await data.toBuffer();
    const validation = fileUpload.validate(data.filename, data.mimetype, buffer);
    if (!validation.valid || !['.png', '.jpg', '.jpeg', '.webp'].includes(validation.ext)) {
      return reply.status(400).send({ error: validation.error || 'Brand logos must be PNG, JPEG, or WebP' });
    }

    const brandDir = path.join(uploadsDir, 'brand');
    await fs.mkdir(brandDir, { recursive: true });

    const filename = `logo-${randomUUID()}${validation.ext}`;
    const logoUrl = `/uploads/brand/${filename}`;

    // Write the file, then the row; if the row write fails the new file is
    // removed. The previous logo is removed only after the row points at the
    // new one, so a failure never leaves the settings naming a deleted file.
    let previousLogoUrl = null;
    const updated = await writeUploadThenPersist(path.join(brandDir, filename), buffer, async () => {
      let settings = await fastify.prisma.brandSettings.findFirst();
      if (!settings) {
        settings = await fastify.prisma.brandSettings.create({ data: {} });
      }
      previousLogoUrl = settings.logoUrl;
      return fastify.prisma.brandSettings.update({
        where: { id: settings.id },
        data: { logoUrl },
      });
    });

    if (previousLogoUrl && previousLogoUrl !== logoUrl) {
      await removeStoredBrandLogo(previousLogoUrl, uploadsDir);
    }

    return updated;
  });

  // ─── GET /logo — the organization's stored logo image ───────────────────────
  // Staff-only and tenant-scoped (the settings row is this organization's).
  // Only a logo stored by POST /logo is served; an external logoUrl is linked
  // directly by the client instead.
  fastify.get('/logo', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const settings = await fastify.prisma.brandSettings.findFirst({ select: { logoUrl: true } });
    const relativePath = brandLogoRelativePath(settings?.logoUrl);
    if (!relativePath) return reply.status(404).send({ error: 'Logo not found' });
    const sent = await sendStoredUpload(reply, { relativePath, uploadsDir, fileName: path.basename(relativePath) });
    if (sent === null) return reply.status(404).send({ error: 'Logo not found' });
    return sent;
  });
}
