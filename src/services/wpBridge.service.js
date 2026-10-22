import { encrypt } from '../utils/crypto.js';
import { canonicalSiteUrl } from '../security/wp-bridge-auth.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';

export async function listSites({ prismaClient }) {
  const sites = await prismaClient.wPSite.findMany({
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  const healthy = sites.filter(s => s.status === 'ACTIVE').length;
  const warnings = sites.filter(s => s.status === 'MAINTENANCE').length;
  const errors = sites.filter(s => s.status === 'ERROR').length;
  const safeSites = sites.map(({ bridgeSecretEncrypted: _secret, ...site }) => site);

  return {
    sites: safeSites,
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
export async function registerSite(data, { prismaClient, bridgeSecret }) {
  const url = canonicalSiteUrl(data.siteUrl);
  return prismaClient.wPSite.create({
    data: {
      name: data.siteName || new URL(url).hostname,
      url,
      adminUrl: url + '/wp-admin',
      bridgeSecretEncrypted: encrypt(bridgeSecret),
      status: 'ACTIVE',
      alerts: '[]'
    }
  });
}

export async function rotateSiteSecret(siteId, { prismaClient, bridgeSecret }) {
  return prismaClient.wPSite.update({
    where: { id: siteId },
    data: { bridgeSecretEncrypted: encrypt(bridgeSecret) }
  });
}

/**
 * Update site health data (from WP plugin heartbeat)
 */
export async function updateSiteHealth(site, healthData, { prismaClient }) {
  const tenantPrisma = createScopedPrisma(prismaClient, site.organizationId);
  return tenantPrisma.wPSite.update({
    where: { id: site.id },
    data: {
      wpVersion: healthData.wordpressVersion || healthData.wpVersion || site.wpVersion,
      phpVersion: healthData.phpVersion || site.phpVersion,
      pluginCount: Array.isArray(healthData.activePlugins) ? healthData.activePlugins.length : healthData.pluginCount,
      theme: healthData.theme || site.theme,
      healthScore: healthData.healthScore ?? site.healthScore,
      status: healthData.status || site.status,
      bridgeVersion: healthData.bridgeVersion || site.bridgeVersion,
      ttfb: typeof healthData.ttfb === 'number' ? healthData.ttfb : site.ttfb,
      dbSize: healthData.dbSize !== undefined ? BigInt(healthData.dbSize) : undefined,
      diskBytes: healthData.diskBytes !== undefined ? BigInt(healthData.diskBytes) : undefined,
      diskUsagePct: typeof healthData.diskUsagePct === 'number' ? healthData.diskUsagePct : site.diskUsagePct,
      pluginUpdates: typeof healthData.pluginUpdates === 'number' ? healthData.pluginUpdates : site.pluginUpdates,
      lastCheckedAt: new Date(),
      alerts: JSON.stringify(healthData.alerts || [])
    }
  });
}
