// WordPress Bridge service
// Migrated from ashbi-hub with proper auth and Prisma

import prisma from '../config/db.js';
import crypto from 'crypto';
import env from '../config/env.js';

/**
 * Verify shared secret using constant-time compare. Returns true if valid.
 */
function verifySecret(secretKey) {
  if (!secretKey || !env.wpBridgeSecret) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(String(secretKey)),
      Buffer.from(String(env.wpBridgeSecret))
    );
  } catch {
    return false;
  }
}

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
  const { siteUrl, siteName, wordpressVersion, phpVersion, activePlugins, theme, clientId, projectId, bridgeVersion, ttfb, dbSize, diskBytes, diskUsagePct, pluginUpdates } = data;

  return prisma.wPSite.create({
    data: {
      name: siteName || new URL(siteUrl).hostname,
      url: siteUrl,
      adminUrl: `${siteUrl}/wp-admin`,
      wpVersion: wordpressVersion,
      phpVersion,
      pluginCount: Array.isArray(activePlugins) ? activePlugins.length : (activePlugins || 0),
      theme,
      bridgeVersion: bridgeVersion || null,
      ttfb: typeof ttfb === 'number' ? ttfb : null,
      dbSize: dbSize ? BigInt(dbSize) : null,
      diskBytes: diskBytes ? BigInt(diskBytes) : null,
      diskUsagePct: typeof diskUsagePct === 'number' ? diskUsagePct : null,
      pluginUpdates: typeof pluginUpdates === 'number' ? pluginUpdates : 0,
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
      wpVersion: healthData.wordpressVersion || healthData.wpVersion || site.wpVersion,
      phpVersion: healthData.phpVersion || site.phpVersion,
      pluginCount: healthData.pluginCount ?? site.pluginCount,
      theme: healthData.theme || site.theme,
      healthScore: healthData.healthScore ?? site.healthScore,
      status: healthData.status || site.status,
      bridgeVersion: healthData.bridgeVersion || site.bridgeVersion,
      ttfb: typeof healthData.ttfb === 'number' ? healthData.ttfb : site.ttfb,
      dbSize: healthData.dbSize ? BigInt(healthData.dbSize) : site.dbSize,
      diskBytes: healthData.diskBytes ? BigInt(healthData.diskBytes) : site.diskBytes,
      diskUsagePct: typeof healthData.diskUsagePct === 'number' ? healthData.diskUsagePct : site.diskUsagePct,
      pluginUpdates: typeof healthData.pluginUpdates === 'number' ? healthData.pluginUpdates : site.pluginUpdates,
      lastCheckedAt: new Date(),
      alerts: JSON.stringify(healthData.alerts || [])
    }
  });
}

/**
 * Record a backup event from the bridge plugin (v1.7.0+)
 */
export async function recordBackup(siteUrl, report) {
  const site = await prisma.wPSite.findFirst({ where: { url: siteUrl } });
  if (!site) throw new Error('Site not found');

  // The plugin now sends 'manifest' as the parsed object (with dbSize/filesSize),
  // and also as top-level 'dbSize'/'filesSize'. Prefer top-level, fall back to manifest.
  const manifestObj = (report.manifest && typeof report.manifest === 'object') ? report.manifest : null;
  const dbSizeRaw    = report.dbSize ?? manifestObj?.dbSize ?? null;
  const filesSizeRaw = report.filesSize ?? manifestObj?.filesSize ?? null;

  // Serialize the manifest object for storage; store filename if it's a string
  const manifestJson = manifestObj
    ? JSON.stringify(manifestObj)
    : (typeof report.manifest === 'string' ? report.manifest : null);

  return prisma.wPBackup.create({
    data: {
      siteId: site.id,
      siteUrl,
      timestamp: report.timestamp ? new Date(report.timestamp) : new Date(),
      dbSuccess: !!report.dbSuccess,
      filesSuccess: !!report.filesSuccess,
      dbFile: report.dbFile || null,
      filesFile: report.filesFile || null,
      manifest: manifestJson,
      dbSize: dbSizeRaw ? BigInt(dbSizeRaw) : null,
      filesSize: filesSizeRaw ? BigInt(filesSizeRaw) : null
    }
  });
}

/**
 * Upsert a monthly maintenance report (v1.7.0+)
 */
export async function recordReport(siteUrl, report) {
  const site = await prisma.wPSite.findFirst({ where: { url: siteUrl } });
  if (!site) throw new Error('Site not found');

  const month = report.month || new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return prisma.wPReport.upsert({
    where: { siteId_month: { siteId: site.id, month } },
    create: {
      siteId: site.id,
      siteUrl,
      month,
      uptime: JSON.stringify(report.uptime || {}),
      updates: JSON.stringify(report.updates || {}),
      cleanup: JSON.stringify(report.cleanup || {}),
      hours: JSON.stringify(report.hours || {}),
      ssl: JSON.stringify(report.ssl || {}),
      payload: JSON.stringify(report)
    },
    update: {
      uptime: JSON.stringify(report.uptime || {}),
      updates: JSON.stringify(report.updates || {}),
      cleanup: JSON.stringify(report.cleanup || {}),
      hours: JSON.stringify(report.hours || {}),
      ssl: JSON.stringify(report.ssl || {}),
      payload: JSON.stringify(report)
    }
  });
}

/**
 * Log a site alert (v1.7.0+)
 */
export async function recordAlert(siteUrl, alertType, details) {
  const site = await prisma.wPSite.findFirst({ where: { url: siteUrl } });
  return prisma.wPAlert.create({
    data: {
      siteId: site?.id || null,
      siteUrl,
      alertType,
      details: JSON.stringify(details || {})
    }
  });
}

/**
 * Get recent alerts for a site
 */
export async function getAlerts(siteUrl, limit = 50) {
  return prisma.wPAlert.findMany({
    where: { siteUrl },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
}

/**
 * Get recent backups for a site
 */
export async function getBackups(siteUrl, limit = 20) {
  return prisma.wPBackup.findMany({
    where: { siteUrl },
    orderBy: { timestamp: 'desc' },
    take: limit
  });
}

/**
 * Get reports for a site
 */
export async function getReports(siteUrl) {
  return prisma.wPReport.findMany({
    where: { siteUrl },
    orderBy: { createdAt: 'desc' },
    take: 12
  });
}

/**
 * Log support hours for retainer tracking
 */
export async function logSupportHours(siteUrl, hours, description, month) {
  const site = await prisma.wPSite.findFirst({ where: { url: siteUrl } });
  return prisma.supportHourEntry.create({
    data: {
      siteUrl,
      clientId: site?.clientId || null,
      projectId: site?.projectId || null,
      month: month || new Date().toISOString().slice(0, 7),
      hours: Number(hours) || 0,
      description: description || null,
      source: 'plugin'
    }
  });
}

/**
 * Aggregate support hours for a client or site in a given month
 */
export async function getSupportHoursSummary({ siteUrl, clientId, month }) {
  const where = {};
  if (siteUrl) where.siteUrl = siteUrl;
  if (clientId) where.clientId = clientId;
  if (month) where.month = month;

  const entries = await prisma.supportHourEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });

  const total = entries.reduce((sum, e) => sum + e.hours, 0);
  return { total, count: entries.length, entries };
}

export { verifySecret };

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