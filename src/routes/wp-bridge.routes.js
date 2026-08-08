import { Readable } from 'node:stream';
import crypto from 'crypto';
import { z } from 'zod';
import env from '../config/env.js';
import { prisma } from '../config/db.js';
import { resolveTenantOrganizationIds, runTenantJob } from '../jobs/tenant-iteration.js';
import { validateBody, validateQuery } from '../validators/schemas.js';
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
  postFleetDigestToSlack,
  recordMagicLoginEvent,
  getMagicLoginLog,
  checkMagicLoginRateLimit,
  findMagicLoginSite,
  sha256TokenHash
} from '../services/wpBridge.service.js';
import {
  executeFleetOp,
  resolveTargetSites,
  listFleetOps,
  PER_SITE_TIMEOUT_MS
} from '../services/fleetOps.service.js';

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
    return listSites(request.user.id, { prismaClient: request.prisma });
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
      return reply.status(404).send({ error: 'Not found' });
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
        return reply.status(404).send({ error: 'Not found' });
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
        return reply.status(404).send({ error: 'Not found' });
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
      if (request.log && request.log.error) {
        request.log.error({ err }, '[fleet-digest] post failed');
      }
      return reply.status(502).send({ error: 'Slack post failed' });
    }
  });

  // ====================== FLEET OPS ORCHESTRATOR (Plan 7) ======================
  // Hub-side fan-out: one admin request → N concurrent plugin requests, each
  // HMAC-signed with the shared secret. Each endpoint records exactly one
  // audit row in wp_fleet_ops (regardless of success/failure breakdown) and
  // returns aggregated { opId, total, succeeded, failed, results }.
  //
  // Endpoint mapping (hub → plugin):
  //   POST /api/wp-bridge/fleet/file/patch    -> POST {siteUrl}/wp-json/ashbi/v1/file/patch
  //   POST /api/wp-bridge/fleet/command       -> POST {siteUrl}/wp-json/ashbi/v1/command
  //   POST /api/wp-bridge/fleet/option/set    -> POST {siteUrl}/wp-json/ashbi/v1/option/set
  //
  // All three share a common shape:
  //   Body: { ...pluginFields, targetSites: string[] | null, targetAll?: boolean, dryRun?: boolean }
  //     - targetAll=true OR targetSites=[url,...] selects sites; both empty -> 400.
  //     - dryRun (file/patch only) reports what WOULD be sent without POSTing.

  // Inline Zod schemas for the fleet-ops endpoints. Schemas live here (next
  // to the routes that use them) instead of in src/validators/ so this
  // task stays within its constrained scope (prisma/, src/routes/,
  // src/services/, src/lib/, src/tests/unit/).
  const targetSitesField = z.array(z.string().min(1).max(2048)).nullable().optional();
  const targetAllField = z.boolean().optional();

  const fleetFilePatchSchema = z.object({
    filePath: z.string().min(1).max(2048),
    find: z.string().min(1).max(65535),
    replace: z.string().max(65535),
    targetSites: targetSitesField,
    targetAll: targetAllField,
    dryRun: z.boolean().optional()
  }).superRefine((data, ctx) => {
    if (data.targetAll !== true && (!Array.isArray(data.targetSites) || data.targetSites.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either targetAll=true or a non-empty targetSites[] is required'
      });
    }
  });

  const fleetCommandSchema = z.object({
    cmd: z.string().min(1).max(65535),
    targetSites: targetSitesField,
    targetAll: targetAllField
  }).superRefine((data, ctx) => {
    if (data.targetAll !== true && (!Array.isArray(data.targetSites) || data.targetSites.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either targetAll=true or a non-empty targetSites[] is required'
      });
    }
  });

  const fleetOptionSetSchema = z.object({
    name: z.string().min(1).max(255),
    // value can be any JSON-serialisable scalar/object/array. We use
    // z.unknown() to keep the schema permissive; the route handler rejects
    // explicit `undefined` (which JSON.stringify drops silently).
    value: z.unknown(),
    targetSites: targetSitesField,
    targetAll: targetAllField
  }).superRefine((data, ctx) => {
    if (data.targetAll !== true && (!Array.isArray(data.targetSites) || data.targetSites.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either targetAll=true or a non-empty targetSites[] is required'
      });
    }
  });

  const fleetMagicLoginSchema = z.object({
    user_id: z.coerce.number().int().positive(),
    targetSites: targetSitesField,
    targetAll: targetAllField
  }).superRefine((data, ctx) => {
    if (data.targetAll !== true && (!Array.isArray(data.targetSites) || data.targetSites.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either targetAll=true or a non-empty targetSites[] is required'
      });
    }
  });

  const fleetOpsListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(500).optional().default(50),
    op_type: z.enum(['file_patch', 'command', 'option_set', 'magic_login']).optional()
  });

  function ensureAdminSecretConfigured(reply) {
    if (!env.wpBridgeSecret) {
      reply.status(503).send({
        error: 'WP_BRIDGE_SECRET is not configured on the hub',
        code: 'WP_BRIDGE_SECRET_MISSING'
      });
      return false;
    }
    return true;
  }

  // POST /api/wp-bridge/fleet/file/patch
  // Body: { filePath, find, replace, targetSites | targetAll, dryRun? }
  fastify.post('/fleet/file/patch', {
    onRequest: [fastify.authenticate, fastify.adminOnly],
    preHandler: validateBody(fleetFilePatchSchema)
  }, async (request, reply) => {
    if (!ensureAdminSecretConfigured(reply)) return;
    const { filePath, find, replace, targetSites, targetAll, dryRun } = request.body;
    let sites;
    try {
      sites = await resolveTargetSites({ targetAll, targetSites });
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[fleet/file/patch] resolveTargetSites failed');
      }
      return reply.status(500).send({ error: 'Failed to resolve target sites' });
    }
    if (sites.length === 0) {
      return reply.status(404).send({ error: 'No matching sites found' });
    }
    try {
      const result = await executeFleetOp({
        opType: 'file_patch',
        payload: { filePath, find, replace },
        targetSites: sites,
        endpoint: 'file/patch',
        createdBy: request.user.id,
        dryRun: !!dryRun,
        timeoutMs: PER_SITE_TIMEOUT_MS
      });
      return result;
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[fleet/file/patch] fan-out failed');
      }
      return reply.status(500).send({ error: 'Fleet operation failed' });
    }
  });

  // POST /api/wp-bridge/fleet/command
  // Body: { cmd, targetSites | targetAll }
  fastify.post('/fleet/command', {
    onRequest: [fastify.authenticate, fastify.adminOnly],
    preHandler: validateBody(fleetCommandSchema)
  }, async (request, reply) => {
    if (!ensureAdminSecretConfigured(reply)) return;
    const { cmd, targetSites, targetAll } = request.body;
    let sites;
    try {
      sites = await resolveTargetSites({ targetAll, targetSites });
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[fleet/command] resolveTargetSites failed');
      }
      return reply.status(500).send({ error: 'Failed to resolve target sites' });
    }
    if (sites.length === 0) {
      return reply.status(404).send({ error: 'No matching sites found' });
    }
    try {
      const result = await executeFleetOp({
        opType: 'command',
        payload: { cmd },
        targetSites: sites,
        endpoint: 'command',
        createdBy: request.user.id,
        timeoutMs: PER_SITE_TIMEOUT_MS
      });
      return result;
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[fleet/command] fan-out failed');
      }
      return reply.status(500).send({ error: 'Fleet operation failed' });
    }
  });

  // POST /api/wp-bridge/fleet/option/set
  // Body: { name, value, targetSites | targetAll }
  fastify.post('/fleet/option/set', {
    onRequest: [fastify.authenticate, fastify.adminOnly],
    preHandler: validateBody(fleetOptionSetSchema)
  }, async (request, reply) => {
    if (!ensureAdminSecretConfigured(reply)) return;
    const { name, value, targetSites, targetAll } = request.body;
    // value can be any JSON-serialisable type (string|number|boolean|object|array|null);
    // we just check that it's not undefined (which JSON.stringify drops silently).
    if (value === undefined) {
      return reply.status(400).send({ error: 'value is required (cannot be undefined)' });
    }
    let sites;
    try {
      sites = await resolveTargetSites({ targetAll, targetSites });
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[fleet/option/set] resolveTargetSites failed');
      }
      return reply.status(500).send({ error: 'Failed to resolve target sites' });
    }
    if (sites.length === 0) {
      return reply.status(404).send({ error: 'No matching sites found' });
    }
    try {
      const result = await executeFleetOp({
        opType: 'option_set',
        payload: { name, value },
        targetSites: sites,
        endpoint: 'option/set',
        createdBy: request.user.id,
        timeoutMs: PER_SITE_TIMEOUT_MS
      });
      return result;
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[fleet/option/set] fan-out failed');
      }
      return reply.status(500).send({ error: 'Fleet operation failed' });
    }
  });

  // POST /api/wp-bridge/fleet/magic-login
  // Body: { user_id, targetSites | targetAll }
  // Per-site plugin endpoint: POST {siteUrl}/wp-json/ashbi/v1/magic-login with
  // { user_id } body (HMAC-signed by fanOutOneSite, same wire format as
  // file/patch / command / option/set). Plugin is expected to return a JSON
  // payload with `url` (the magic-login URL).
  //
  // Response shape differs from the other fleet ops: each result is
  //   { siteUrl, url? } on success, { siteUrl, error? } on failure
  // so the UI can show a copy-to-clipboard link per site without the generic
  // httpStatus / elapsedMs envelope.
  fastify.post('/fleet/magic-login', {
    onRequest: [fastify.authenticate, fastify.adminOnly],
    preHandler: validateBody(fleetMagicLoginSchema)
  }, async (request, reply) => {
    if (!ensureAdminSecretConfigured(reply)) return;
    const { user_id: userId, targetSites, targetAll } = request.body;
    let sites;
    try {
      sites = await resolveTargetSites({ targetAll, targetSites });
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[fleet/magic-login] resolveTargetSites failed');
      }
      return reply.status(500).send({ error: 'Failed to resolve target sites' });
    }
    if (sites.length === 0) {
      return reply.status(404).send({ error: 'No matching sites found' });
    }
    try {
      const raw = await executeFleetOp({
        opType: 'magic_login',
        // Only forward user_id to the plugin (hub-side routing metadata is
        // stripped by buildPerSiteRequest).
        payload: { user_id: userId },
        targetSites: sites,
        endpoint: 'magic-login',
        createdBy: request.user.id,
        timeoutMs: PER_SITE_TIMEOUT_MS
      });
      await Promise.all(raw.results.map(async (result) => {
        const site = sites.find((candidate) => candidate.url === result.siteUrl);
        const pluginBody = result.output && result.output.body;
        const issued = result.status === 'ok' && pluginBody && typeof pluginBody.url === 'string';
        let tokenHash = issued && typeof pluginBody.hash === 'string' ? pluginBody.hash : null;
        if (!tokenHash && issued) {
          try {
            const token = new URL(pluginBody.url).searchParams.get('ashbi_sso');
            if (token) tokenHash = sha256TokenHash(token);
          } catch { /* malformed plugin URL is captured as a rejected event below */ }
        }
        await recordMagicLoginEvent({
          siteId: site?.id || null,
          siteUrl: result.siteUrl,
          userId,
          hubUserId: request.user.id,
          ip: request.ip || '0.0.0.0',
          status: issued ? 'issued' : 'rejected',
          reason: issued ? null : (result.error || 'plugin_response_invalid'),
          tokenHash
        });
      }));
      return {
        opId: raw.opId,
        total: raw.total,
        succeeded: raw.succeeded,
        failed: raw.failed,
        results: raw.results.map(reshapeMagicLoginResult)
      };
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[fleet/magic-login] fan-out failed');
      }
      return reply.status(500).send({ error: 'Fleet operation failed' });
    }
  });

  // GET /api/wp-bridge/fleet/ops?limit=50&op_type=file_patch
  // Returns recent fleet ops with target/success/failure counts. Used by the
  // WPSites "Fleet Ops history" tab.
  fastify.get('/fleet/ops', {
    onRequest: [fastify.authenticate, fastify.adminOnly],
    preHandler: validateQuery(fleetOpsListQuerySchema)
  }, async (request, reply) => {
    const { limit, op_type: opType } = request.query;
    try {
      const ops = await listFleetOps({ limit, opType });
      return { ops };
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[fleet/ops] list failed');
      }
      return reply.status(500).send({ error: 'Failed to list fleet ops' });
    }
  });

  // ==========================================================================
  // Magic-login ManageWP-grade endpoints (Plan 11 / PR-F).
  // The plugin owns the token lifecycle; the hub owns the audit feed, the
  // per-fleet rate-limit guard, and the proxy into /magic-login/revoke on
  // each site. Both endpoints below require admin-level JWT (the same gate
  // as the rest of /api/wp-bridge/* after PR-D removed the blanket exemption).
  // ==========================================================================

  // GET /api/wp-bridge/magic-login/log?siteId=...&limit=100
  // Returns the last `limit` magic-login audit rows for a site (or fleet-wide
  // when siteId is omitted). Drives the WPSites "Recent Logins" tab.
  fastify.get('/magic-login/log', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request, reply) => {
    const { siteId, siteUrl, status, limit } = request.query || {};

    if (status && !['issued', 'consumed', 'revoked', 'rejected'].includes(status)) {
      return reply.status(400).send({ error: 'status must be one of issued|consumed|revoked|rejected' });
    }
    if (siteId && typeof siteId !== 'string') {
      return reply.status(400).send({ error: 'siteId must be a string' });
    }
    const cap = Math.min(Math.max(1, parseInt(limit, 10) || 100), 500);

    try {
      const entries = await getMagicLoginLog({
        siteId: siteId || null,
        siteUrl: siteUrl || null,
        status: status || null,
        limit: cap
      });
      return { entries, count: entries.length, limit: cap };
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[magic-login/log] list failed');
      }
      return reply.status(500).send({ error: 'Failed to read magic-login log' });
    }
  });

  // POST /api/wp-bridge/magic-login/revoke
  // Body: { siteId, hash }  OR  { siteUrl, hash }       ← preferred (hub UI)
  //     OR  { siteId, token }  OR  { siteUrl, token }    ← legacy (raw token)
  //
  // The hub's "Recent Logins" tab never had the raw token (we only persist
  // its sha256 hash on the hub side), so the preferred wire shape is
  // `{ hash }`. The plugin-side revoke endpoint accepts both shapes —
  // when it sees `hash`, it uses it directly as the active-transient key
  // (no double-hashing); when it sees `token`, it hashes first.
  //
  // The fan-out forwards whatever the hub-side audit row records (`hash`
  // if the caller passed a hash, otherwise the sha256 of the raw token),
  // so plugin-side and hub-side audit rows always reference the same hash.
  fastify.post('/magic-login/revoke', {
    onRequest: [fastify.authenticate, fastify.adminOnly],
    preHandler: validateBody(z.object({
      siteId: z.string().min(1).optional(),
      siteUrl: z.string().url().optional(),
      hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      token: z.string().min(8).optional()
    }).refine((d) => Boolean(d.siteId) || Boolean(d.siteUrl), {
      message: 'siteId or siteUrl is required'
    }).refine((d) => Boolean(d.hash) !== Boolean(d.token), {
      message: 'pass either hash OR token, not both (and not neither)'
    }))
  }, async (request, reply) => {
    if (!ensureAdminSecretConfigured(reply)) return;
    const { siteId, siteUrl, hash, token } = request.body;

    // Compute the canonical hash that BOTH the plugin-side audit row and
    // the hub-side audit row will reference. Plugin receives `hash` directly
    // (no double-hash) when the caller supplied a hash; receives `token` as
    // a raw token (plugin hashes it) when the caller supplied a token.
    const callerHash = hash || sha256TokenHash(token);
    const pluginPayloadField = hash ? 'hash' : 'token';
    const pluginPayloadValue = hash || token;

    let site;
    try {
      site = await findMagicLoginSite({ siteId, siteUrl });
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[magic-login/revoke] resolve failed');
      }
      return reply.status(500).send({ error: 'Failed to resolve site' });
    }
    if (!site) return reply.status(404).send({ error: 'Site not found' });

    // Per-fleet rate limit (5/hr default). Revocations are lightweight but
    // we still cap the volume so an admin hot-keying the kill-switch
    // doesn't drown the plugin endpoint.
    const rl = await checkMagicLoginRateLimit({ siteId: site.id });
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfterSeconds));
      return reply.status(429).send({
        error: 'Magic-login rate limit exceeded',
        retryAfterSeconds: rl.retryAfterSeconds
      });
    }

    try {
      const raw = await executeFleetOp({
        opType: 'magic_login_revoke',
        payload: { [pluginPayloadField]: pluginPayloadValue },
        targetSites: [site],
        endpoint: 'magic-login/revoke',
        createdBy: request.user.id,
        timeoutMs: PER_SITE_TIMEOUT_MS
      });
      const result = raw.results && raw.results[0];
      const pluginResponse = result && result.output && result.output.body;
      const ok = result && result.status === 'ok';

      await recordMagicLoginEvent({
        siteId: site.id,
        siteUrl: site.url,
        hubUserId: request.user.id,
        ip: request.ip || '0.0.0.0',
        status: 'revoked',
        reason: 'manual_revoke',
        tokenHash: callerHash
      });

      return {
        ok,
        siteUrl: site.url,
        pluginResponse: pluginResponse || null,
        hash: callerHash
      };
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error({ err }, '[magic-login/revoke] fan-out failed');
      }
      return reply.status(500).send({ error: 'Revoke failed' });
    }
  });
}

// Reshape a generic fan-out result into the magic-login response shape:
//   ok  + body.url present -> { siteUrl, url }
//   ok  + body.url missing -> { siteUrl, error: '...' }
//   err                     -> { siteUrl, error }
// Exported for tests + used by the magic-login route handler.
export function reshapeMagicLoginResult(r) {
  if (!r) return { siteUrl: '', error: 'empty result' };
  if (r.status === 'ok') {
    const body = r.output && r.output.body;
    if (body && typeof body === 'object' && typeof body.url === 'string' && body.url.length > 0) {
      return { siteUrl: r.siteUrl, url: body.url };
    }
    return { siteUrl: r.siteUrl, error: 'plugin response missing url field' };
  }
  return { siteUrl: r.siteUrl, error: r.error || 'unknown error' };
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
      if (logger && logger.warn) {
        logger.warn('[fleet-digest] SLACK_WEBHOOK_URL not configured; skipping scheduled digest');
      }
      return { skipped: true, reason: 'SLACK_WEBHOOK_URL not configured' };
    }
    const organizationIds = await resolveTenantOrganizationIds(prisma);
    const results = [];
    for (const organizationId of organizationIds) {
      const fleet = await runTenantJob(prisma, organizationId, () => getFleetStatus());
      const slackStatus = await postFleetDigestToSlack({ webhookUrl, fleet });
      results.push({ organizationId, slackStatus, totalSites: fleet.totalSites });
      if (logger && logger.info) {
        logger.info(`[fleet-digest] tenant digest posted to Slack (organization=${organizationId}, status=${slackStatus}, healthy=${fleet.healthy}/${fleet.totalSites})`);
      }
    }
    return { ok: true, organizations: results };
  } catch (err) {
    if (logger && logger.error) {
      logger.error({ err }, '[fleet-digest] scheduled run failed');
    }
    return { ok: false, error: 'Operation failed' };
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
