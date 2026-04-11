// Snippet Library service
// Migrated from ashbi-hub raw SQL to Prisma

import { prisma } from '../index.js';

/**
 * Get snippets with optional filters
 */
export async function getSnippets(filters = {}) {
  const { language, category, tag } = filters;

  const where = {};
  if (language) where.language = language;
  if (category) where.category = category;
  if (tag) where.tags = { has: tag };

  return prisma.snippet.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } }
    }
  });
}

/**
 * Get a single snippet
 */
export async function getSnippet(id) {
  return prisma.snippet.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } }
    }
  });
}

/**
 * Create a snippet
 */
export async function createSnippet(data) {
  const { title, description, code, language, category, tags, createdById } = data;

  return prisma.snippet.create({
    data: {
      title,
      description,
      code,
      language: language || 'javascript',
      category: category || 'general',
      tags: tags || [],
      createdById: createdById || undefined
    },
    include: {
      createdBy: { select: { id: true, name: true } }
    }
  });
}

/**
 * Update a snippet
 */
export async function updateSnippet(id, data) {
  const updateData = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.code !== undefined) updateData.code = data.code;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.tags !== undefined) updateData.tags = data.tags;
  if (data.isFavorite !== undefined) updateData.isFavorite = data.isFavorite;

  return prisma.snippet.update({
    where: { id },
    data: updateData,
    include: {
      createdBy: { select: { id: true, name: true } }
    }
  });
}

/**
 * Delete a snippet
 */
export async function deleteSnippet(id) {
  return prisma.snippet.delete({ where: { id } });
}

/**
 * Search snippets using Prisma contains filter
 * (Full-text search via tsvector requires $queryRaw if needed later)
 */
export async function searchSnippets(query, limit = 20) {
  return prisma.snippet.findMany({
    where: {
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { code: { contains: query, mode: 'insensitive' } }
      ]
    },
    orderBy: { useCount: 'desc' },
    take: limit,
    include: {
      createdBy: { select: { id: true, name: true } }
    }
  });
}

/**
 * Get popular snippets
 */
export async function getPopularSnippets(limit = 10) {
  return prisma.snippet.findMany({
    orderBy: { useCount: 'desc' },
    take: limit,
    include: {
      createdBy: { select: { id: true, name: true } }
    }
  });
}

/**
 * Increment snippet usage count
 */
export async function incrementUsage(id) {
  return prisma.snippet.update({
    where: { id },
    data: { useCount: { increment: 1 } }
  });
}