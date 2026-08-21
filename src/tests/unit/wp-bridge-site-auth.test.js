import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt } from '../../utils/crypto.js';
import { signSiteRequest, verifySiteRequest } from '../../security/wp-bridge-auth.js';
import { buildVerifySiteHmac, serializeBigInt } from '../../routes/wp-bridge.routes.js';
import { registerSite, rotateSiteSecret } from '../../services/wpBridge.service.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

process.env.CREDENTIALS_KEY = 'wp-bridge-test-encryption-key';

test('site list JSON serialization converts nested BigInt metrics to strings', () => {
  const result = serializeBigInt({
    sites: [{ id: 'site-1', dbSize: 123n, diskBytes: 456n }],
    meta: { count: 1 }
  });

  assert.deepEqual(result, {
    sites: [{ id: 'site-1', dbSize: '123', diskBytes: '456' }],
    meta: { count: 1 }
  });
});

function harness({ siteUrl = 'https://a.example', organizationId = 'org-a', secret = 'site-a-secret' } = {}) {
  const nonces = new Set();
  return {
    prismaClient: {
      wPSite: {
        findFirst: async ({ where }) => where.url === siteUrl
          ? { id: 'site-a', organizationId, bridgeSecretEncrypted: encrypt(secret) }
          : null
      },
      wPBridgeNonce: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }) => {
          const key = `${data.siteId}:${data.nonceHash}`;
          if (nonces.has(key)) throw Object.assign(new Error('unique'), { code: 'P2002' });
          nonces.add(key);
          return data;
        }
      }
    },
    secret
  };
}

function request(secret, overrides = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = 'nonce_1234567890abcdef';
  const rawBody = JSON.stringify({ siteUrl: 'https://a.example', status: 'ok' });
  return {
    siteUrl: 'https://a.example', timestamp, nonce, rawBody,
    signature: `sha256=${signSiteRequest(secret, { timestamp, nonce, rawBody })}`,
    ...overrides
  };
}

test('valid per-site signed write succeeds once', async () => {
  const h = harness();
  const result = await verifySiteRequest({ prismaClient: h.prismaClient, ...request(h.secret) });
  assert.equal(result.valid, true);
  assert.equal(result.site.organizationId, 'org-a');
});

test('wrong-site credential fails', async () => {
  const h = harness();
  const result = await verifySiteRequest({ prismaClient: h.prismaClient, ...request('site-b-secret') });
  assert.deepEqual(result, { valid: false, code: 'INVALID_SIGNATURE' });
});

test('replayed nonce fails after a successful write', async () => {
  const h = harness();
  const signed = request(h.secret);
  assert.equal((await verifySiteRequest({ prismaClient: h.prismaClient, ...signed })).valid, true);
  assert.deepEqual(await verifySiteRequest({ prismaClient: h.prismaClient, ...signed }), {
    valid: false, code: 'REPLAYED_SIGNATURE'
  });
});

test('stale signatures and unknown sites fail', async () => {
  const h = harness();
  const stale = request(h.secret, { timestamp: 1 });
  assert.equal((await verifySiteRequest({ prismaClient: h.prismaClient, ...stale })).code, 'STALE_SIGNATURE');
  const unknown = request(h.secret, { siteUrl: 'https://b.example' });
  assert.equal((await verifySiteRequest({ prismaClient: h.prismaClient, ...unknown })).code, 'SITE_NOT_PROVISIONED');
});

test('two tenants accept only their own provisioned site credential', async () => {
  const tenantA = harness({ siteUrl: 'https://a.example', organizationId: 'org-a', secret: 'site-a-secret' });
  const tenantB = harness({ siteUrl: 'https://b.example', organizationId: 'org-b', secret: 'site-b-secret' });
  const requestA = request(tenantA.secret);
  const requestB = request(tenantB.secret, {
    siteUrl: 'https://b.example',
    rawBody: JSON.stringify({ siteUrl: 'https://b.example', status: 'ok' }),
    nonce: 'nonce_b_1234567890abcdef'
  });
  requestB.signature = `sha256=${signSiteRequest(tenantB.secret, requestB)}`;

  assert.equal((await verifySiteRequest({ prismaClient: tenantA.prismaClient, ...requestA })).site.organizationId, 'org-a');
  assert.equal((await verifySiteRequest({ prismaClient: tenantB.prismaClient, ...requestB })).site.organizationId, 'org-b');
  assert.equal((await verifySiteRequest({
    prismaClient: tenantB.prismaClient,
    ...requestB,
    signature: `sha256=${signSiteRequest(tenantA.secret, requestB)}`,
    nonce: 'nonce_wrong_1234567890abc'
  })).code, 'INVALID_SIGNATURE');
});

test('malformed site URLs fail closed instead of throwing', async () => {
  const h = harness();
  const malformed = request(h.secret, { siteUrl: 'not a URL' });
  assert.equal((await verifySiteRequest({ prismaClient: h.prismaClient, ...malformed })).code, 'MALFORMED_SITE_URL');
});

test('route preHandler authenticates the exact raw body and records the site', async () => {
  const h = harness();
  const signed = request(h.secret);
  const requestObject = {
    body: JSON.parse(signed.rawBody),
    rawBody: signed.rawBody,
    headers: {
      'x-ashbi-timestamp': String(signed.timestamp),
      'x-ashbi-nonce': signed.nonce,
      'x-ashbi-signature': signed.signature
    }
  };
  const reply = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.payload = payload; return this; }
  };

  await buildVerifySiteHmac(h.prismaClient)(requestObject, reply);

  assert.equal(reply.statusCode, 200);
  assert.equal(requestObject.wpBridgeSite.organizationId, 'org-a');
});

test('admin provisioning binds ownership and stores only encrypted site credentials', async () => {
  let created;
  const basePrisma = {
    wPSite: {
      create: async ({ data }) => {
        created = { id: 'site-a', ...data };
        return created;
      }
    }
  };
  const scoped = createScopedPrisma(basePrisma, 'org-a');

  await registerSite(
    { siteUrl: 'https://a.example/' },
    { prismaClient: scoped, bridgeSecret: 'one-time-site-secret' }
  );

  assert.equal(created.organizationId, 'org-a');
  assert.equal(created.url, 'https://a.example');
  assert.notEqual(created.bridgeSecretEncrypted, 'one-time-site-secret');
  assert.match(created.bridgeSecretEncrypted, /^v1:[a-zA-Z0-9._-]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
});

test('credential rotation remains tenant-scoped and replaces encrypted material', async () => {
  let updateArgs;
  const basePrisma = {
    wPSite: {
      update: async (args) => {
        updateArgs = args;
        return { id: 'site-a', ...args.data };
      }
    }
  };

  await rotateSiteSecret('site-a', {
    prismaClient: createScopedPrisma(basePrisma, 'org-a'),
    bridgeSecret: 'rotated-site-secret'
  });

  assert.deepEqual(updateArgs.where, { id: 'site-a', organizationId: 'org-a' });
  assert.notEqual(updateArgs.data.bridgeSecretEncrypted, 'rotated-site-secret');
});
