// WordPress Bridge service
// Migrated from ashbi-hub with proper auth and Prisma

import prisma from '../config/db.js';
import crypto from 'crypto';

/**
 * List all registered WP sites with health summary
 */
export async function listSites(userId) {
  const sites = await prisma.wPSite.findMany({
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  const healthy = sites.filter(s => s.status === 'ACTIVE').length;
  const warnings = sites.filter(s => s.status === 'MAINTENANCE').length;
  const errors = sites.filter(s => s.status === 'ERROR').length;

  return {
    sites,
    meta: {
      total: sites.length,
      healthy,
      warnings,
      errors
    }
  };
}

/**
 * Register a new WP site
 */
export async function registerSite(data) {
  const { siteUrl, siteName, wordpressVersion, phpVersion, activePlugins, theme, clientId, projectId } = data;

  const secretKey = crypto.randomBytes(32).toString('hex');

  return prisma.wPSite.create({
    data: {
      name: siteName || new URL(siteUrl).hostname,
      url: siteUrl,
      adminUrl: `${siteUrl}/wp-admin`,
      wpVersion: wordpressVersion,
      phpVersion,
      pluginCount: activePlugins || 0,
      theme,
      clientId: clientId || undefined,
      projectId: projectId || undefined,
      status: 'ACTIVE',
      healthScore: 100,
      alerts: '[]'
    }
  });
}

/**
 * Update site health data (from WP plugin heartbeat)
 */
export async function updateSiteHealth(siteUrl, healthData) {
  const site = await prisma.wPSite.findFirst({
    where: { url: siteUrl }
  });

  if (!site) throw new Error('Site not found');

  return prisma.wPSite.update({
    where: { id: site.id },
    data: {
      wpVersion: healthData.wordpressVersion || site.wpVersion,
      phpVersion: healthData.phpVersion || site.phpVersion,
      pluginCount: healthData.pluginCount ?? site.pluginCount,
      theme: healthData.theme || site.theme,
      healthScore: healthData.healthScore ?? site.healthScore,
      status: healthData.status || site.status,
      lastCheckedAt: new Date(),
      alerts: JSON.stringify(healthData.alerts || [])
    }
  });
}

/**
 * Delete a site
 */
export async function deleteSite(id) {
  return prisma.wPSite.delete({ where: { id } });
}

/**
 * Generate a magic login link for a WP site
 */
export async function generateMagicLogin(siteId, expiresInMinutes = 30) {
  const site = await prisma.wPSite.findUnique({ where: { id: siteId } });
  if (!site) throw new Error('Site not found');

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  return {
    url: `${site.url}/wp-login.php?magic_token=${token}`,
    token,
    expiresAt
  };
}