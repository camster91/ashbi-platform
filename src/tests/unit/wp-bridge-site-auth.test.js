import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt } from '../../utils/crypto.js';
import { signSiteRequest, verifySiteRequest } from '../../security/wp-bridge-auth.js';

process.env.CREDENTIALS_KEY = 'wp-bridge-test-encryption-key';

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
