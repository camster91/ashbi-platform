// Asset Library service
// Migrated from ashbi-hub raw SQL to Prisma

import prisma from '../config/db.js';
import { getOrCreateBrandSettings } from './brand-settings.service.js';

// Asset.tags is a JSON string column. The library's category is kept in it as
// a "category:<name>" tag and the description in altText, so the Add asset
// form persists without a schema change; serializeAsset() exposes both as
// fields again.
const CATEGORY_TAG_PREFIX = 'category:';

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.filter((tag) => typeof tag === 'string');
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * @param {string[] | undefined} tags
 * @param {string | null | undefined} category
 */
export function encodeAssetTags(tags, category) {
  const plain = (tags || []).filter((tag) => !tag.startsWith(CATEGORY_TAG_PREFIX));
  return JSON.stringify(category ? [`${CATEGORY_TAG_PREFIX}${category}`, ...plain] : plain);
}

/**
 * The API shape of an asset row: tags as an array, plus category and
 * description.
 * @param {any} asset
 */
export function serializeAsset(asset) {
  if (!asset) return asset;
  const all = parseTags(asset.tags);
  const categoryTag = all.find((tag) => tag.startsWith(CATEGORY_TAG_PREFIX));
  return {
    ...asset,
    tags: all.filter((tag) => tag !== categoryTag),
    category: categoryTag ? categoryTag.slice(CATEGORY_TAG_PREFIX.length) : null,
    description: asset.altText ?? null,
  };
}

/**
 * Get assets for a client with optional filters
 */
export async function getAssets(clientId, filters = {}) {
  const { type, category } = filters;

  const where = { clientId };
  if (type) where.type = type;
  if (category) where.tags = { contains: JSON.stringify(`${CATEGORY_TAG_PREFIX}${category}`) };

  const assets = await prisma.asset.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });
  return assets.map(serializeAsset);
}

/**
 * Get a single asset
 */
export async function getAsset(id) {
  return serializeAsset(await prisma.asset.findUnique({ where: { id } }));
}

/**
 * Create a new asset. The caller has already checked the client belongs to
 * the organization.
 */
export async function createAsset(data) {
  const { name, type, url, thumbnailUrl, size, mimeType, altText, description, category, tags, clientId, folderId, isGlobal } = data;

  const asset = await prisma.asset.create({
    data: {
      name,
      type: type || 'IMAGE',
      url,
      thumbnailUrl,
      size,
      mimeType,
      altText: description || altText || null,
      tags: encodeAssetTags(tags, category),
      clientId: clientId || undefined,
      folderId,
      isGlobal: isGlobal || false
    }
  });
  return serializeAsset(asset);
}

/**
 * Update an asset
 */
export async function updateAsset(id, data) {
  const updateData = {};
  const allowedFields = ['name', 'type', 'url', 'thumbnailUrl', 'size', 'mimeType', 'altText', 'folderId', 'isGlobal'];
  for (const field of allowedFields) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }
  if (data.description !== undefined) updateData.altText = data.description || null;
  if (data.tags !== undefined || data.category !== undefined) {
    const current = serializeAsset(await prisma.asset.findUnique({ where: { id }, select: { tags: true } }));
    updateData.tags = encodeAssetTags(
      data.tags !== undefined ? data.tags : current?.tags,
      data.category !== undefined ? data.category : current?.category,
    );
  }

  return serializeAsset(await prisma.asset.update({
    where: { id },
    data: updateData
  }));
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
  const assets = await prisma.asset.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { altText: { contains: query, mode: 'insensitive' } }
      ]
    },
    take: limit,
    orderBy: { createdAt: 'desc' }
  });
  return assets.map(serializeAsset);
}

/**
 * Get the organization's brand settings (created with defaults if missing).
 * @param {string} organizationId
 */
export async function getBrandSettings(organizationId) {
  return getOrCreateBrandSettings(prisma, organizationId);
}

/**
 * Update the organization's brand settings.
 * @param {string} organizationId
 * @param {Record<string, unknown>} data
 */
export async function updateBrandSettings(organizationId, data) {
  const current = await getOrCreateBrandSettings(prisma, organizationId);

  const allowedFields = ['companyName', 'logoUrl', 'primaryColor', 'accentColor', 'address', 'phone', 'email', 'website', 'taxId', 'invoiceFooter', 'proposalFooter', 'contractHeader'];
  const updateData = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }

  return prisma.brandSettings.update({
    where: { id: current.id, organizationId },
    data: updateData
  });
}