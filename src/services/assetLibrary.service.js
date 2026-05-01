// Asset Library service
// Migrated from ashbi-hub raw SQL to Prisma

import prisma from '../config/db.js';

/**
 * Get assets for a client with optional filters
 */
export async function getAssets(clientId, filters = {}) {
  const { type, category } = filters;

  const where = { clientId };
  if (type) where.type = type;
  if (category) where.tags = { has: category };

  return prisma.asset.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Get a single asset
 */
export async function getAsset(id) {
  return prisma.asset.findUnique({ where: { id } });
}

/**
 * Create a new asset
 */
export async function createAsset(data) {
  const { name, type, url, thumbnailUrl, size, mimeType, altText, tags, clientId, folderId, isGlobal } = data;

  return prisma.asset.create({
    data: {
      name,
      type: type || 'IMAGE',
      url,
      thumbnailUrl,
      size,
      mimeType,
      altText,
      tags: tags || [],
      clientId: clientId || undefined,
      folderId,
      isGlobal: isGlobal || false
    }
  });
}

/**
 * Update an asset
 */
export async function updateAsset(id, data) {
  const updateData = {};
  const allowedFields = ['name', 'type', 'url', 'thumbnailUrl', 'size', 'mimeType', 'altText', 'tags', 'folderId', 'isGlobal'];
  for (const field of allowedFields) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }

  return prisma.asset.update({
    where: { id },
    data: updateData
  });
}

/**
 * Delete an asset
 */
export async function deleteAsset(id) {
  return prisma.asset.delete({ where: { id } });
}

/**
 * Search assets by name or alt text
 */
export async function searchAssets(query, limit = 20) {
  return prisma.asset.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { altText: { contains: query, mode: 'insensitive' } }
      ]
    },
    take: limit,
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Get brand settings (singleton)
 */
export async function getBrandSettings() {
  let settings = await prisma.brandSettings.findFirst();
  if (!settings) {
    settings = await prisma.brandSettings.create({ data: {} });
  }
  return settings;
}

/**
 * Update brand settings
 */
export async function updateBrandSettings(data) {
  const current = await prisma.brandSettings.findFirst();
  if (!current) {
    return prisma.brandSettings.create({ data: data });
  }

  const allowedFields = ['companyName', 'logoUrl', 'primaryColor', 'accentColor', 'address', 'phone', 'email', 'website', 'taxId', 'invoiceFooter', 'proposalFooter', 'contractHeader'];
  const updateData = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }

  return prisma.brandSettings.update({
    where: { id: current.id },
    data: updateData
  });
}