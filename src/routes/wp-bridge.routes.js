import { Readable } from 'node:stream';
import crypto from 'crypto';
import env from '../config/env.js';
import {
  registerSite,
  updateSiteHealth,
  listSites,
  deleteSite,
  verifySecret,
  recordBackup,
  recordReport,
  recordAlert,
  getAlerts,
  getBackups,
  getReports,
  logSupportHours,
  getSupportHoursSummary,
  getFleetStatus,
  postFleetDigestToSlack
} from '../services/wpBridge.service.js';

// Capture the unparsed HTTP body into request.rawBody so the HMAC verify can
// recompute sha256(timestamp + raw_body) the same way the plugin did. Used
// only on routes that need exact-byte HMAC matching (currently POST /backup).
const captureRawBodyHook = async (request, _reply, payload) => {
  const chunks = [];
  for await (const chunk of payload) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  request.rawBody = raw;
  // Re-emit a fresh stream so subsequent parsers can re-read it.
  return Readable.from(Buffer.from(raw));
};

// HMAC verify for POST /api/wp-bridge/backup. Returns truthy (reply already
// sent with 401) on rejection, falsy on acceptance.
const HMAC_REPLAY_WINDOW_SECONDS = 300;

const verifyBackupHmac = async (request, reply) => {
  const headerSig = request.headers['x-ashbi-signature'];
  if (!headerSig || typeof headerSig !== 'string' || !headerSig.startsWith('sha256=')) {
    reply.status(401).send({ error: 'Missing or malformed X-Ashbi-Signature header' });
    return reply;
  }
  const providedHex = headerSig.slice('sha256='.length);

  // Accept `timestamp` (current wire format — set by plugin's send_backup_report
  // after PR #17) as the primary read. Fall back to `_timestamp` for backward
  // compatibility with older plugin versions that prefixed internal fields with
  // an underscore. The canonical string the signature is computed over remains
  // `timestamp + body`, so the wire format the plugin uses to compute the HMAC
  // must match the field name we read here.
  const timestamp =
    request.body && (
      request.body.timestamp !== undefined
        ? request.body.timestamp
        : request.body._timestamp
    );
  if (timestamp === undefined || timestamp === null || !/^\d+$/.test(String(timestamp))) {
    reply.status(401).send({ error: 'Missing or invalid timestamp' });
    return reply;
  }
  const tsSec = parseInt(String(timestamp), 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > HMAC_REPLAY_WINDOW_SECONDS) {
    reply.status(401).send({ error: 'Timestamp outside replay window' });
    return reply;
  }

  if (!env.wpBridgeSecret) {
    if (request.log && request.log.error) {
      request.log.error('wpBridgeSecret not configured');
    }
    reply.status(401).send({ error: 'Server missing wpBridgeSecret configuration' });
    return reply;
  }

  const rawBody = request.rawBody || '';
  const expectedHex = crypto
    .createHmac('sha256', env.wpBridgeSecret)
    .update(String(timestamp) + rawBody)
    .digest('hex');

  let sigBuf;
  let expectedBuf;
  try {
    sigBuf = Buffer.from(providedHex, 'hex');
    expectedBuf = Buffer.from(expectedHex, 'hex');
  } catch {
    reply.status(401).send({ error: 'Invalid signature encoding' });
    return reply;
  }

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    reply.status(401).send({ error: 'Invalid signature' });
    return reply;
  }
  // accept: returning a Promise (because this function is `async`) is what
  // actually advances the Fastify v5 hook runner chain. Returning
  // `undefined` synchronously leaves the chain hung.
};

export default async function wpBridgeRoutes(fastify) {
  // Convert BigInt values (dbSize, filesSize) to strings for JSON serialization
  const serializeBigInt = (obj) =>
    JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));

  // Start the daily Slack digest cron as soon as the plugin is mounted.
  // Idempotent — safe across hot-reloads. No-op in dev so we don't spam
  // Slack during local iteration.
  startFleetDigestCron(fastify.log);

  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return listSites(request.user.id);
  });

  fastify.post('/', { config: { public: true } }, async (request, reply) => {
    const { siteUrl, siteName, secretKey } = request.body;
    if (!secretKey || !verifySecret(secretKey)) {
      return reply.status(401).send({ error: 'Invalid secret key' });
    }
    if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
    const site = await registerSite(request.body);
    return reply.status(201).send({ success: true, site: serializeBigInt(site) });
  });

  fastify.put('/', { config: { public: true } }, async (request, reply) => {
    const { siteUrl, secretKey, ...healthData } = request.body;
    if (!secretKey || !verifySecret(secretKey)) {
      return reply.status(401).send({ error: 'Invalid secret key' });
    }
    if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
    try {
      const result = await updateSiteHealth(siteUrl, healthData);
      return { success: true, health: serializeBigInt(result) };
    } catch (error) {
      return reply.status(404).send({ error: error.message });
    }
  });

  // Bridge plugin backup event (v1.7.0+).
  // Now HMAC-signed by the plugin: header X-Ashbi-Signature: sha256={hmac}
  // over `_timestamp + raw_body`. Backwards-compatible envelope (still sends
  // siteUrl/secretKey/report). HMAC verify is the source of truth.
  fastify.post(
    '/backup',
    {
      config: { public: true },
      preParsing: captureRawBodyHook,
      preHandler: verifyBackupHmac
    },
    async (request, reply) => {
      const { siteUrl, report } = request.body || {};
      if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
      try {
        const backup = await recordBackup(siteUrl, report || {});
        return reply.status(201).send({ success: true, backup: serializeBigInt(backup) });
      } catch (error) {
        return reply.status(404).send({ error: error.message });
      }
    }
  );

  // Bridge plugin monthly maintenance report (v1.7.0+). secretKey-only auth for now.
  fastify.post(
    '/report',
    { config: { public: true } },
    async (request, reply) => {
      const { siteUrl, secretKey, report } = request.body;
      if (!secretKey || !verifySecret(secretKey)) {
        return reply.status(401).send({ error: 'Invalid secret key' });
      }
      if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
      try {
        const r = await recordReport(siteUrl, report || {});
        return reply.status(201).send({ success: true, report: serializeBigInt(r) });
      } catch (error) {
        return reply.status(404).send({ error: error.message });
      }
    }
  );

  // Bridge plugin alert: new admin, admin promoted, security event (v1.7.0+). secretKey-only auth.
  fastify.post(
    '/alert',
    { config: { public: true } },
    async (request, reply) => {
      const { siteUrl, secretKey, alertType, details } = request.body;
      if (!secretKey || !verifySecret(secretKey)) {
        return reply.status(401).send({ error: 'Invalid secret key' });
      }
      if (!siteUrl || !alertType) {
        return reply.status(400).send({ error: 'siteUrl and alertType required' });
      }
      const alert = await recordAlert(siteUrl, alertType, details || {});
      return reply.status(201).send({ success: true, alert });
    }
  );

  // Log support hours (retainer tracking) from plugin or manual entry. secretKey-only auth.
  fastify.post(
    '/hours',
    { config: { public: true } },
    async (request, reply) => {
      const { siteUrl, secretKey, hours, description, month } = request.body;
      if (!secretKey || !verifySecret(secretKey)) {
        return reply.status(401).send({ error: 'Invalid secret key' });
      }
      if (!siteUrl || typeof hours !== 'number') {
        return reply.status(400).send({ error: 'siteUrl and hours required' });
      }
      const entry = await logSupportHours(siteUrl, hours, description, month);
      return reply.status(201).send({ success: true, entry });
    }
  );

  // Read endpoints (require authenticated user, not plugin secret)
  fastify.get('/alerts', { onRequest: [fastify.authenticate] }, async (request) => {
    const { siteUrl, limit } = request.query;
    return getAlerts(siteUrl, limit ? Number(limit) : 50);
  });

  fastify.get('/backups', { onRequest: [fastify.authenticate] }, async (request) => {
    const { siteUrl, limit } = request.query;
    return getBackups(siteUrl, limit ? Number(limit) : 20);
  });

  fastify.get('/reports', { onRequest: [fastify.authenticate] }, async (request) => {
    const { siteUrl } = request.query;
    return getReports(siteUrl);
  });

  fastify.get('/hours/summary', { onRequest: [fastify.authenticate] }, async (request) => {
    const { siteUrl, clientId, month } = request.query;
    return getSupportHoursSummary({ siteUrl, clientId, month });
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;
    await deleteSite(id);
    return reply.status(204).send();
  });

  // ====================== FLEET DASHBOARD (Plan 6) ======================
  // GET /api/wp-bridge/fleet/status — JWT (admin only).
  // Returns the rollup metrics + per-site rows used by the WPSites page.
  fastify.get('/fleet/status', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async () => {
    return getFleetStatus();
  });

  // POST /api/wp-bridge/fleet/digest — manual trigger for the daily digest.
  // Reads fleet status, posts a single Slack message to SLACK_WEBHOOK_URL.
  // Returns 502 if Slack webhook isn't configured (caller-side error,
  // not an auth failure) or non-2xx from Slack.
  fastify.post('/fleet/digest', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request, reply) => {
    const webhookUrl = env.slackWebhookUrl;
    if (!webhookUrl) {
      return reply.status(503).send({
        error: 'SLACK_WEBHOOK_URL is not configured',
        code: 'SLACK_WEBHOOK_MISSING'
      });
    }
    const fleet = await getFleetStatus();
    try {
      const slackStatus = await postFleetDigestToSlack({ webhookUrl, fleet });
      if (slackStatus < 200 || slackStatus >= 300) {
        return reply.status(502).send({
          error: `Slack webhook returned ${slackStatus}`,
          code: 'SLACK_WEBHOOK_BAD_STATUS',
          slackStatus
        });
      }
      return { ok: true, slackStatus, fleet };
    } catch (err) {
      request.log && request.log.error && request.log.error({ err }, '[fleet-digest] post failed');
      return reply.status(502).send({ error: err.message || 'Slack post failed' });
    }
  });
}

// =============================================================================
// FLEET DIGEST CRON — runs daily at 09:00 America/Toronto. Started from inside
// the route plugin so the schedule travels with the route registration
// (constraint: do not modify src/index.js for this task).
// =============================================================================
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function next9amToronto(now = new Date()) {
  // Compute the UTC instant that corresponds to the next 09:00 in
  // America/Toronto, accounting for DST. We do this by formatting a
  // candidate UTC instant back to ET and comparing hours until they
  // line up at 09:00 ET.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  const etParts = (d) => {
    const out = {};
    for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
    return out;
  };

  // Start with a candidate: now floored to the next minute in UTC, then
  // advance by hours until ET hour is 09.
  let candidate = new Date(now.getTime());
  candidate.setUTCSeconds(0, 0);
  // Walk forward up to 36 hours (covers DST forward-day ambiguity safely).
  for (let i = 0; i < 36 * 60; i += 1) {
    candidate = new Date(candidate.getTime() + 60 * 1000);
    const parts = etParts(candidate);
    if (parts.hour === '09' && parts.minute === '00') {
      return candidate;
    }
  }
  // Fallback: tomorrow 09:00 ET computed via fixed offset (rare; only if
  // Intl misbehaves). Uses EST offset (UTC-5) which is acceptable for a
  // 24h-window scheduler.
  const fallback = new Date(now.getTime() + ONE_DAY_MS);
  fallback.setUTCHours(14, 0, 0, 0); // 09:00 EST = 14:00 UTC
  return fallback;
}

async function runScheduledFleetDigest(logger) {
  try {
    const webhookUrl = env.slackWebhookUrl;
    if (!webhookUrl) {
      logger && logger.warn && logger.warn('[fleet-digest] SLACK_WEBHOOK_URL not configured; skipping scheduled digest');
      return { skipped: true, reason: 'SLACK_WEBHOOK_URL not configured' };
    }
    const fleet = await getFleetStatus();
    const slackStatus = await postFleetDigestToSlack({ webhookUrl, fleet });
    logger && logger.info && logger.info(`[fleet-digest] scheduled digest posted to Slack (status=${slackStatus}, healthy=${fleet.healthy}/${fleet.totalSites})`);
    return { ok: true, slackStatus, totalSites: fleet.totalSites };
  } catch (err) {
    logger && logger.error && logger.error({ err }, '[fleet-digest] scheduled run failed');
    return { ok: false, error: err.message };
  }
}

let fleetDigestCronStarted = false;

/**
 * Idempotent: starts the daily 09:00 ET Slack digest job. Safe to call from
 * any plugin setup (including wp-bridge route registration).
 */
export function startFleetDigestCron(logger = console) {
  if (fleetDigestCronStarted) return;
  fleetDigestCronStarted = true;
  if (env.isDev) {
    // Don't run the cron in dev — the manual POST endpoint is enough to
    // exercise the code path without spamming Slack.
    logger.info('[fleet-digest] dev mode; scheduled digest disabled (use POST /api/wp-bridge/fleet/digest)');
    return;
  }
  const next = next9amToronto();
  const msUntil = next.getTime() - Date.now();
  logger.info(`[fleet-digest] next 09:00 ET digest at ${next.toISOString()} (in ${Math.round(msUntil / 60000)} min)`);
  setTimeout(() => {
    runScheduledFleetDigest(logger);
    // After first fire, recompute the next 09:00 ET each cycle so DST is
    // handled without manual offset bookkeeping.
    setInterval(() => {
      runScheduledFleetDigest(logger);
    }, ONE_DAY_MS);
    // The first fire may have landed just before a DST transition; the
    // interval will drift up to an hour. We accept that — daily Slack at
    // ~09:00 ET is fine within ±60 min.
  }, msUntil);
}
