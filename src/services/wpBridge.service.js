// WordPress Bridge service
// Migrated from ashbi-hub with proper auth and Prisma

import prisma from '../config/db.js';
import { prisma as backgroundPrisma } from '../config/db.js';
import crypto from 'crypto';
import env from '../config/env.js';
import { runTenantJob } from '../jobs/tenant-iteration.js';
import { encrypt } from '../utils/crypto.js';
import { canonicalSiteUrl } from '../security/wp-bridge-auth.js';

async function withSiteTenant(siteUrl, callback) {
  const site = await prisma.wPSite.findFirst({ where: { url: canonicalSiteUrl(siteUrl) } });
  if (!site?.organizationId) throw new Error('Site not found or not provisioned for a tenant');
  return runTenantJob(prisma, site.organizationId, (tenantPrisma) => callback(tenantPrisma, site), backgroundPrisma);
}

// ============================================================================
// Magic-login helpers (Plan 11 / PR-F).
// Owned by the hub-side keepalive of the magic-login feature: routes call
// these helpers to (a) persist every state transition to the wp_magic_login_log
// audit table, (b) read the recent-logins feed for the WPSites dashboard, and
// (c) enforce a per-fleet rate limit so a single admin hot-keying the magic
// button doesn't accidentally flood the plugin layer.
//
// The plugin-side counterpart (includes/class-ashbi-magic-login.php) keeps its
// own ring-buffered wp_options audit log for sites that aren't yet registered
// with the hub. Once a site is registered, the hub log becomes the source of
// truth for the cross-site "Recent Logins" view.
// ============================================================================

const MAGIC_LOGIN_RATE_LIMIT_DEFAULT = 5; // per site per hour
const MAGIC_LOGIN_AUDIT_MAX = 500;        // ring buffer per site in the UI feed

/**
 * Record a magic-login state transition. The function is intentionally
 * permissive about missing fields so it can be called from the issuance path,
 * the revocation path, and the audit-endpoint path with a single shape.
 *
 *   status  ∈ 'issued' | 'consumed' | 'revoked' | 'rejected'
 *   reason  ∈ 'expired_or_invalid' | 'replayed' | 'expired' | 'rate_limited'
 *             | 'ip_not_allowed' | 'manual_revoke' | NULL
 */
export async function recordMagicLoginEvent({
  siteId = null,
  siteUrl,
  userId = null,
  hubUserId = null,
  ip = '0.0.0.0',
  status,
  reason = null,
  tokenHash = null
} = {}) {
  if (!siteUrl || typeof siteUrl !== 'string') {
    throw new TypeError('recordMagicLoginEvent: siteUrl is required');
  }
  const allowed = ['issued', 'consumed', 'revoked', 'rejected'];
  if (!allowed.includes(status)) {
    throw new TypeError(`recordMagicLoginEvent: status must be one of ${allowed.join(', ')}`);
  }

  return prisma.wPMagicLoginLog.create({
    data: {
      siteId,
      siteUrl: site.url,
      userId: Number.isFinite(userId) ? userId : null,
      hubUserId: hubUserId || null,
      ip: ip || '0.0.0.0',
      status,
      reason,
      tokenHash: tokenHash || null
    }
  });
}

/**
 * Read the magic-login audit log. Filterable by siteId and/or status.
 * Returns at most `limit` rows (default 100, max 500) ordered by ts desc.
 */
export async function getMagicLoginLog({ siteId = null, siteUrl = null, status = null, limit = 100 } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 100), MAGIC_LOGIN_AUDIT_MAX);
  return prisma.wPMagicLoginLog.findMany({
    where: {
      ...(siteId ? { siteId } : {}),
      ...(siteUrl ? { siteUrl } : {}),
      ...(status ? { status } : {})
    },
    orderBy: { ts: 'desc' },
    take: cap
  });
}

/**
 * Per-fleet rate limit. Defaults to 5 issuances per site per hour from the
 * hub side. We use the wp_magic_login_log table itself as the bucket —
 * counting `status='issued'` rows in the last hour is enough for a hub-side
 * guard and avoids a second table that needs its own migration + GC.
 *
 * Returns `{ allowed, count, limit, retryAfterSeconds }`. The route layer
 * is responsible for translating `!allowed` into a 429 with the
 * Retry-After header.
 */
export async function checkMagicLoginRateLimit({ siteId, limit = MAGIC_LOGIN_RATE_LIMIT_DEFAULT, now = new Date() } = {}) {
  if (!siteId) {
    throw new TypeError('checkMagicLoginRateLimit: siteId is required');
  }
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const count = await prisma.wPMagicLoginLog.count({
    where: {
      siteId,
      status: 'issued',
      ts: { gte: hourAgo }
    }
  });
  return {
    allowed: count < limit,
    count,
    limit,
    retryAfterSeconds: 60 * 60
  };
}

/**
 * Look up a WPSite by id OR canonical URL. Used by the magic-login revoke
 * route which accepts either siteId or siteUrl.
 */
export async function findMagicLoginSite({ siteId = null, siteUrl = null } = {}) {
  if (siteId) {
    return prisma.wPSite.findUnique({ where: { id: siteId } });
  }
  if (siteUrl) {
    return prisma.wPSite.findFirst({ where: { url: siteUrl } });
  }
  return null;
}

/**
 * Hash a raw magic-login token with sha256. Used by the revoke route to
 * record the same tokenHash that the plugin emits, so the hub log + plugin
 * log can be cross-referenced.
 */
export function sha256TokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}


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
export async function listSites(userId, { prismaClient = prisma } = {}) {
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
export async function registerSite(data, { prismaClient = prisma, bridgeSecret } = {}) {
  const { siteUrl, siteName, wordpressVersion, phpVersion, activePlugins, theme, clientId, projectId, bridgeVersion, ttfb, dbSize, diskBytes, diskUsagePct, pluginUpdates } = data;
  const normalizedSiteUrl = canonicalSiteUrl(siteUrl);

  return prismaClient.wPSite.create({
    data: {
      name: siteName || new URL(normalizedSiteUrl).hostname,
      url: normalizedSiteUrl,
      adminUrl: `${normalizedSiteUrl}/wp-admin`,
      bridgeSecretEncrypted: encrypt(bridgeSecret),
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

export async function rotateSiteSecret(siteId, { prismaClient = prisma, bridgeSecret } = {}) {
  return prismaClient.wPSite.update({
    where: { id: siteId },
    data: { bridgeSecretEncrypted: encrypt(bridgeSecret) }
  });
}

/**
 * Update site health data (from WP plugin heartbeat)
 */
export async function updateSiteHealth(siteUrl, healthData) {
  return withSiteTenant(siteUrl, (tenantPrisma, site) => tenantPrisma.wPSite.update({
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
  }));
}

/**
 * Record a backup event from the bridge plugin (v1.7.0+)
 */
export async function recordBackup(siteUrl, report) {
  return withSiteTenant(siteUrl, (tenantPrisma, site) => {
  // The plugin now sends 'manifest' as the parsed object (with dbSize/filesSize),
  // and also as top-level 'dbSize'/'filesSize'. Prefer top-level, fall back to manifest.
  const manifestObj = (report.manifest && typeof report.manifest === 'object') ? report.manifest : null;
  const dbSizeRaw    = report.dbSize ?? manifestObj?.dbSize ?? null;
  const filesSizeRaw = report.filesSize ?? manifestObj?.filesSize ?? null;

  // Serialize the manifest object for storage; store filename if it's a string
  const manifestJson = manifestObj
    ? JSON.stringify(manifestObj)
    : (typeof report.manifest === 'string' ? report.manifest : null);

  return tenantPrisma.wPBackup.create({
    data: {
      siteId: site.id,
      siteUrl: site.url,
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
  });
}

/**
 * Upsert a monthly maintenance report (v1.7.0+)
 */
export async function recordReport(siteUrl, report) {
  return withSiteTenant(siteUrl, (tenantPrisma, site) => {
  const month = report.month || new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return tenantPrisma.wPReport.upsert({
    where: { siteId_month: { siteId: site.id, month } },
    create: {
      siteId: site.id,
      siteUrl: site.url,
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
  });
}

/**
 * Log a site alert (v1.7.0+)
 */
export async function recordAlert(siteUrl, alertType, details) {
  return withSiteTenant(siteUrl, (tenantPrisma, site) => tenantPrisma.wPAlert.create({
    data: {
      siteId: site.id,
      siteUrl: site.url,
      alertType,
      details: JSON.stringify(details || {})
    }
  }));
}

/**
 * Get recent alerts for a site
 */
export async function getAlerts(siteUrl, limit = 50) {
  return withSiteTenant(siteUrl, (tenantPrisma, site) => tenantPrisma.wPAlert.findMany({
    where: { siteUrl: site.url },
    orderBy: { createdAt: 'desc' },
    take: limit
  }));
}

/**
 * Get recent backups for a site
 */
export async function getBackups(siteUrl, limit = 20) {
  return withSiteTenant(siteUrl, (tenantPrisma, site) => tenantPrisma.wPBackup.findMany({
    where: { siteUrl: site.url },
    orderBy: { timestamp: 'desc' },
    take: limit
  }));
}

/**
 * Get reports for a site
 */
export async function getReports(siteUrl) {
  return withSiteTenant(siteUrl, (tenantPrisma, site) => tenantPrisma.wPReport.findMany({
    where: { siteUrl: site.url },
    orderBy: { createdAt: 'desc' },
    take: 12
  }));
}

/**
 * Log support hours for retainer tracking
 */
export async function logSupportHours(siteUrl, hours, description, month) {
  return withSiteTenant(siteUrl, (tenantPrisma, site) => tenantPrisma.supportHourEntry.create({
    data: {
      siteUrl: site.url,
      clientId: site.clientId || null,
      projectId: site.projectId || null,
      month: month || new Date().toISOString().slice(0, 7),
      hours: Number(hours) || 0,
      description: description || null,
      source: 'plugin'
    }
  }));
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

// =============================================================================
// FLEET DASHBOARD AGGREGATION (Plan 6)
// =============================================================================

/**
 * Internal: parse the JSON-encoded `ssl` column from a WPReport row.
 * Returns { status, days } or null if the column is missing/malformed.
 */
function parseSslColumn(sslJson) {
  if (!sslJson || typeof sslJson !== 'string') return null;
  try {
    const parsed = JSON.parse(sslJson);
    if (parsed && typeof parsed === 'object') {
      return {
        status: typeof parsed.status === 'string' ? parsed.status : null,
        days: typeof parsed.days === 'number' ? parsed.days : null
      };
    }
  } catch {
    /* malformed JSON — fall through */
  }
  return null;
}

/**
 * Internal: compute "latest report" per siteUrl from a flat list of reports.
 * Returns Map<siteUrl, WPReport> where the entry is the most-recent report
 * for that site (by createdAt).
 */
function indexLatestReportsBySite(reports) {
  const map = new Map();
  for (const r of reports) {
    const existing = map.get(r.siteUrl);
    if (!existing || new Date(r.createdAt) > new Date(existing.createdAt)) {
      map.set(r.siteUrl, r);
    }
  }
  return map;
}

/**
 * Aggregate fleet-wide health metrics for the dashboard rollup card.
 *
 * Pure function — takes pre-fetched data so it can be unit-tested without
 * a Prisma client. The route layer calls this with the three Prisma
 * findMany results.
 *
 * Returns:
 *   totalSites, healthy, unreachable, silent, sslExpiringSoon,
 *   pendingUpdates, brokenLinks, sites[]
 *
 * Each site in `sites[]` carries:
 *   id, siteUrl, name, lastPingAt, lastPingStatus, sslDaysRemaining,
 *   pendingUpdates, brokenLinks
 */
export function aggregateFleetStatusPure({ sites = [], reports = [], alerts = [], now = new Date() } = {}) {
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // Note: `reports` and `alerts` should already be pre-filtered to the
  // 7-day window by the caller (cheap index range scan). We re-check the
  // timestamp here defensively so a caller that forgets the filter still
  // gets a correct count.
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recentReports = reports.filter((r) => new Date(r.createdAt) >= sevenDaysAgo);
  const latestBySite = indexLatestReportsBySite(recentReports);

  const recentBrokenAlerts = alerts.filter(
    (a) => a.alertType === 'broken_links' && new Date(a.createdAt) >= sevenDaysAgo
  );
  const brokenLinksPerSite = new Map();
  for (const a of recentBrokenAlerts) {
    brokenLinksPerSite.set(a.siteUrl, (brokenLinksPerSite.get(a.siteUrl) || 0) + 1);
  }

  // Per-site rows
  const rows = sites.map((s) => {
    const lastPingAt = s.lastCheckedAt ? new Date(s.lastCheckedAt) : null;
    const pingedRecently = lastPingAt && lastPingAt > twentyFourHoursAgo;
    const lastReport = latestBySite.get(s.url);
    const ssl = lastReport ? parseSslColumn(lastReport.ssl) : null;
    const sslDaysRemaining = ssl && ssl.days !== null ? ssl.days : null;
    const brokenLinks = brokenLinksPerSite.get(s.url) || 0;

    return {
      id: s.id,
      siteUrl: s.url,
      name: s.name,
      status: s.status,
      lastPingAt: lastPingAt ? lastPingAt.toISOString() : null,
      lastPingStatus: pingedRecently ? (s.status === 'ACTIVE' ? 'ok' : 'unreachable') : 'silent',
      sslDaysRemaining,
      pendingUpdates: typeof s.pluginUpdates === 'number' ? s.pluginUpdates : 0,
      brokenLinks
    };
  });

  // Fleet-level counters
  let healthy = 0;
  let unreachable = 0;
  let silent = 0;
  let pendingUpdates = 0;
  for (const s of rows) {
    pendingUpdates += s.pendingUpdates;
    if (s.lastPingStatus === 'ok') healthy += 1;
    else if (s.lastPingStatus === 'unreachable') unreachable += 1;
    else silent += 1;
  }

  const sslExpiringSoon = rows.filter(
    (s) => s.sslDaysRemaining !== null && s.sslDaysRemaining <= 14 && s.sslDaysRemaining >= 0
  ).length;

  return {
    totalSites: sites.length,
    healthy,
    unreachable,
    silent,
    sslExpiringSoon,
    pendingUpdates,
    brokenLinks: recentBrokenAlerts.length,
    sites: rows
  };
}

/**
 * Aggregate fleet-wide health metrics for the dashboard rollup card.
 * Thin DB-bound wrapper around `aggregateFleetStatusPure`.
 */
export async function getFleetStatus({ now = new Date() } = {}) {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [allSites, recentReports, recentAlerts] = await Promise.all([
    prisma.wPSite.findMany({
      select: {
        id: true,
        url: true,
        name: true,
        status: true,
        lastCheckedAt: true,
        pluginUpdates: true,
        healthScore: true
      }
    }),
    prisma.wPReport.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      select: { siteUrl: true, ssl: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.wPAlert.findMany({
      where: {
        alertType: 'broken_links',
        createdAt: { gte: sevenDaysAgo }
      },
      select: { siteUrl: true, alertType: true, createdAt: true }
    })
  ]);

  return aggregateFleetStatusPure({
    sites: allSites,
    reports: recentReports,
    alerts: recentAlerts,
    now
  });
}

/**
 * Format a fleet status snapshot as a Slack block-kit message.
 *
 * - Always: 4 summary section blocks (healthy / unreachable / SSL / broken).
 * - Divider + per-site breakdown if totalSites < 10, otherwise top-5 only
 *   (most at-risk first: silent, then unreachable, then SSL-expiring).
 */
export function buildFleetSlackMessage(fleet) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*WP Bridge fleet — daily digest*\n${fleet.healthy}/${fleet.totalSites} sites healthy (last 24h)`
      }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Unreachable*\n${fleet.unreachable}` },
        { type: 'mrkdwn', text: `*SSL expiring ≤14d*\n${fleet.sslExpiringSoon}` }
      ]
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Pending plugin updates*\n${fleet.pendingUpdates}` },
        { type: 'mrkdwn', text: `*Broken links (7d)*\n${fleet.brokenLinks}` }
      ]
    },
    { type: 'divider' }
  ];

  // Rank sites: silent first, then unreachable, then SSL-expiring, then pending-updates.
  const ranked = [...fleet.sites].sort((a, b) => {
    const risk = (s) =>
      (s.lastPingStatus === 'silent' ? 4 : 0) +
      (s.lastPingStatus === 'unreachable' ? 3 : 0) +
      (s.sslDaysRemaining !== null && s.sslDaysRemaining <= 14 ? 2 : 0) +
      (s.pendingUpdates > 0 ? 1 : 0);
    return risk(b) - risk(a);
  });

  const limit = fleet.totalSites < 10 ? ranked.length : 5;
  const slice = ranked.slice(0, limit);

  if (slice.length > 0) {
    const lines = slice.map((s) => {
      const sslTxt = s.sslDaysRemaining !== null ? `${s.sslDaysRemaining}d SSL` : 'no SSL data';
      const updTxt = s.pendingUpdates > 0 ? `${s.pendingUpdates} updates` : 'up to date';
      return `• *${s.name || s.siteUrl}* — ${s.lastPingStatus} · ${sslTxt} · ${updTxt}`;
    });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: fleet.totalSites < 10
          ? `*Per-site breakdown (${slice.length})*\n${lines.join('\n')}`
          : `*Top ${slice.length} at-risk sites*\n${lines.join('\n')}`
      }
    });
  }

  return { blocks };
}

/**
 * POST the fleet digest to the configured Slack webhook. Returns the fetch
 * status (status code) or throws on transport error. Network-level failures
 * propagate so the caller can log; Slack application errors (non-2xx) return
 * the status code so the caller can decide whether to retry.
 */
export async function postFleetDigestToSlack({ webhookUrl, fleet, fetchImpl = globalThis.fetch } = {}) {
  if (!webhookUrl) {
    const err = new Error('SLACK_WEBHOOK_URL is not configured');
    err.code = 'SLACK_WEBHOOK_MISSING';
    throw err;
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this runtime');
  }
  const payload = buildFleetSlackMessage(fleet);
  const res = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.status;
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
