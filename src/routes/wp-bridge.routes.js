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
  getSupportHoursSummary
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

const verifyBackupHmac = (request, reply) => {
  const headerSig = request.headers['x-ashbi-signature'];
  if (!headerSig || typeof headerSig !== 'string' || !headerSig.startsWith('sha256=')) {
    reply.status(401).send({ error: 'Missing or malformed X-Ashbi-Signature header' });
    return reply;
  }
  const providedHex = headerSig.slice('sha256='.length);

  const timestamp = request.body && request.body._timestamp;
  if (timestamp === undefined || timestamp === null || !/^\d+$/.test(String(timestamp))) {
    reply.status(401).send({ error: 'Missing or invalid _timestamp' });
    return reply;
  }
  const tsSec = parseInt(String(timestamp), 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > HMAC_REPLAY_WINDOW_SECONDS) {
    reply.status(401).send({ error: 'Timestamp outside replay window' });
    return reply;
  }

  if (!env.wpBridgeSecret) {
    request.log && request.log.error && request.log.error('wpBridgeSecret not configured');
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
  // accept (no reply sent)
};

export default async function wpBridgeRoutes(fastify) {
  // Convert BigInt values (dbSize, filesSize) to strings for JSON serialization
  const serializeBigInt = (obj) =>
    JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));

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
}
