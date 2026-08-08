// Brand Settings routes — get, update, logo upload

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { validateBody, brandSettingsSchema } from '../validators/schemas.js';
import { validateUpload } from '../utils/upload-policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function brandRoutes(fastify) {

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
    const validation = validateUpload({ filename: data.filename, mimetype: data.mimetype, buffer });
    if (!validation.valid || !['.png', '.jpg', '.jpeg', '.webp'].includes(validation.ext)) {
      return reply.status(400).send({ error: validation.error || 'Brand logos must be PNG, JPEG, or WebP' });
    }

    // Save to uploads/brand/
    const uploadsDir = path.join(__dirname, '../../uploads/brand');
    await fs.mkdir(uploadsDir, { recursive: true });

    const filename = `logo-${randomUUID()}${validation.ext}`;
    const filePath = path.join(uploadsDir, filename);

    // Write file
    await fs.writeFile(filePath, buffer);

    const logoUrl = `/uploads/brand/${filename}`;

    // Update brand settings
    let settings = await fastify.prisma.brandSettings.findFirst();
    if (!settings) {
      settings = await fastify.prisma.brandSettings.create({ data: {} });
    }

    // Delete old logo file if it exists
    if (settings.logoUrl) {
      const oldPath = path.join(__dirname, '../..', settings.logoUrl);
      try { await fs.unlink(oldPath); } catch { /* ignore */ }
    }

    const updated = await fastify.prisma.brandSettings.update({
      where: { id: settings.id },
      data: { logoUrl },
    });

    return updated;
  });
}
