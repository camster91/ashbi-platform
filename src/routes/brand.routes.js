// Brand Settings routes — get, update, logo upload

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

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
  fastify.put('/', { onRequest: [fastify.adminOnly] }, async (request, reply) => {
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

    // Validate file type
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    if (!allowed.includes(data.mimetype)) {
      return reply.status(400).send({ error: 'Invalid file type. Allowed: PNG, JPEG, SVG, WebP' });
    }

    // Save to uploads/brand/
    const uploadsDir = path.join(__dirname, '../../uploads/brand');
    await fs.mkdir(uploadsDir, { recursive: true });

    const ext = path.extname(data.filename) || '.png';
    const filename = `logo-${Date.now()}${ext}`;
    const filePath = path.join(uploadsDir, filename);

    // Write file
    const buffer = await data.toBuffer();
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
