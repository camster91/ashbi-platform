import { Readable } from 'node:stream';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { validateBody } from '../validators/schemas.js';
import { registerSite, rotateSiteSecret, updateSiteHealth, listSites } from '../services/wpBridge.service.js';
import { canonicalSiteUrl, issueSiteSecret, verifySiteRequest } from '../security/wp-bridge-auth.js';

// Capture the unparsed HTTP body into request.rawBody so the HMAC verify can
// recompute sha256(timestamp.nonce.raw_body) over the exact bytes sent by
// the plugin. Every plugin-originated write uses this hook.
const captureRawBodyHook = async (request, _reply, payload) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of payload) {
    bytes += chunk.length;
    if (bytes > 1048576) throw Object.assign(new Error('Health payload too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  request.rawBody = raw;
  // Re-emit a fresh stream so subsequent parsers can re-read it.
  return Readable.from(Buffer.from(raw));
};

export function buildVerifySiteHmac(prismaClient) {
  return async function verifySiteHmac(request, reply) {
    const result = await verifySiteRequest({
      prismaClient,
      siteUrl: request.body?.siteUrl,
      timestamp: request.headers['x-ashbi-timestamp'],
      nonce: request.headers['x-ashbi-nonce'],
      signature: request.headers['x-ashbi-signature'],
      rawBody: request.rawBody || ''
    });
    if (!result.valid) {
      return reply.status(401).send({ error: 'Invalid site signature', code: result.code });
    }
    request.wpBridgeSite = result.site;
  };
}

export default async function wpBridgeRoutes(fastify) {
  const verifySiteHmac = buildVerifySiteHmac(prisma);
  const metric = z.number().int().nonnegative().max(2147483647).optional();
  const byteCount = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();
  const healthSchema = z.object({
    siteUrl: z.string().url(),
    wordpressVersion: z.string().max(100).optional(),
    wpVersion: z.string().max(100).optional(),
    phpVersion: z.string().max(100).optional(),
    activePlugins: z.array(z.string().max(255)).max(1000).optional(),
    pluginCount: z.number().int().nonnegative().max(2147483647).optional(),
    theme: z.string().max(255).optional(),
    bridgeVersion: z.string().max(100).optional(),
    healthScore: z.number().int().min(0).max(100).optional(),
    status: z.enum(['ACTIVE', 'MAINTENANCE', 'ERROR', 'OFFLINE']).optional(),
    ttfb: metric,
    dbSize: byteCount,
    diskBytes: byteCount,
    diskUsagePct: z.number().min(0).max(100).optional(),
    pluginUpdates: z.number().int().nonnegative().max(2147483647).optional()
  });
  const provisionSiteSchema = z.object({
    siteUrl: z.string().url().max(2048).refine((value) => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    }, 'siteUrl must be an HTTPS URL without embedded credentials'),
    siteName: z.string().trim().min(1).max(255).optional()
  });
  // Convert BigInt values (dbSize, filesSize) to strings for JSON serialization
  const serializeBigInt = (obj) =>
    JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));

  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return serializeBigInt(await listSites({ prismaClient: request.prisma }));
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.adminOnly],
    preHandler: validateBody(provisionSiteSchema)
  }, async (request, reply) => {
    const { siteUrl } = request.body;
    if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
    const existing = await request.prisma.wPSite.findFirst({
      where: { url: canonicalSiteUrl(siteUrl) },
      select: { id: true }
    });
    if (existing) return reply.status(409).send({ error: 'Site is already provisioned' });
    const bridgeSecret = issueSiteSecret();
    const site = await registerSite(request.body, { prismaClient: request.prisma, bridgeSecret });
    const { bridgeSecretEncrypted: _encryptedSecret, ...safeSite } = site;
    return reply.status(201).send({ success: true, site: serializeBigInt(safeSite), bridgeSecret });
  });

  fastify.put('/', {
    config: { public: true },
    preParsing: captureRawBodyHook,
    preHandler: [verifySiteHmac, validateBody(healthSchema)]
  }, async (request, reply) => {
    const { siteUrl, timestamp: _timestamp, nonce: _nonce, ...healthData } = request.body;
    if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
    await updateSiteHealth(request.wpBridgeSite, healthData, { prismaClient: prisma });
    return { success: true };
  });

  fastify.post('/:id/rotate-secret', {
    config: { skipValidation: true },
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request) => {
    const bridgeSecret = issueSiteSecret();
    await rotateSiteSecret(request.params.id, { prismaClient: request.prisma, bridgeSecret });
    return { success: true, bridgeSecret };
  });
}
