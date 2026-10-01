// Brand Settings routes — get, update, logo upload

import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { validateBody, brandSettingsSchema, fileUpload } from '../validators/schemas.js';
import {
  DEFAULT_UPLOADS_DIR, brandLogoRelativePath, removeStoredBrandLogo, sendStoredUpload, writeUploadThenPersist,
} from '../utils/stored-upload.js';
import { findBrandSettings, getOrCreateBrandSettings } from '../services/brand-settings.service.js';

const LOGO_REPLACE_ATTEMPTS = 3;

/**
 * Point the settings row at a new logo with a compare-and-set on the previous
 * value, so two concurrent uploads cannot both believe they replaced the same
 * old logo (one would otherwise leave its file orphaned). On a lost race the
 * row is re-read and the swap retried; the previous value returned is exactly
 * the one this request replaced.
 * @param {any} prisma
 * @param {{ id: string, logoUrl: string | null }} settings
 * @param {string} logoUrl
 */
export async function replaceLogoUrl(prisma, settings, logoUrl) {
  let current = settings;
  for (let attempt = 0; attempt < LOGO_REPLACE_ATTEMPTS; attempt += 1) {
    const previousLogoUrl = current.logoUrl;
    const { count } = await prisma.brandSettings.updateMany({
      where: { id: current.id, logoUrl: previousLogoUrl },
      data: { logoUrl },
    });
    if (count === 1) return { updated: { ...current, logoUrl }, previousLogoUrl };
    current = await prisma.brandSettings.findFirst({ where: { id: current.id } });
    if (!current) break;
  }
  throw Object.assign(new Error('The brand logo was changed by another request; try again'), { statusCode: 409 });
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ uploadsDir?: string }} [options]
 */
export default async function brandRoutes(fastify, options = {}) {
  const uploadsDir = options.uploadsDir ?? DEFAULT_UPLOADS_DIR;

  // ─── GET / — get brand settings (create default if none) ────────────────────
  // Every read and write below is scoped to the caller's organization.
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request) => {
    return getOrCreateBrandSettings(request.prisma, request.user.organizationId);
  });

  // ─── PUT / — update brand settings (admin only) ─────────────────────────────
  fastify.put('/', { onRequest: [fastify.adminOnly],
    preHandler: validateBody(brandSettingsSchema),
  }, async (request, reply) => {
    const {
      companyName, primaryColor, accentColor, address, phone, email,
      website, taxId, invoiceFooter, proposalFooter, contractHeader,
    } = request.body || {};

    const organizationId = request.user.organizationId;
    const settings = await getOrCreateBrandSettings(request.prisma, organizationId);

    const updated = await request.prisma.brandSettings.update({
      where: { id: settings.id, organizationId },
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
    const { updated, previousLogoUrl } = await writeUploadThenPersist(path.join(brandDir, filename), buffer, async () => {
      // The caller's organization's row (created if missing).
      const settings = await getOrCreateBrandSettings(request.prisma, request.user.organizationId);
      return replaceLogoUrl(request.prisma, settings, logoUrl);
    });

    // Only the logo this request's update replaced is removed, so concurrent
    // uploads never delete a logo another request still points at.
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
    const settings = await findBrandSettings(request.prisma, request.user.organizationId);
    const relativePath = brandLogoRelativePath(settings?.logoUrl);
    if (!relativePath) return reply.status(404).send({ error: 'Logo not found' });
    const sent = await sendStoredUpload(reply, { relativePath, uploadsDir, fileName: path.basename(relativePath) });
    if (sent === null) return reply.status(404).send({ error: 'Logo not found' });
    return sent;
  });
}
