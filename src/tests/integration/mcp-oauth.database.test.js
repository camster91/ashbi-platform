import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import { createMcpOAuthProvider, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT } from '../../auth/mcp-oauth-provider.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
test('MCP OAuth real stores: single-use exchange, refresh race, revocation and tenant binding', {
  skip: (!databaseUrl || !redisUrl) && 'Disposable PostgreSQL and Redis integration URLs are required', timeout: 30000,
}, async () => {
  const db = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const tracked = new Set();
  const store = {
    get: key => redis.get(key), getdel: key => redis.getdel(key),
    set: (key, ...args) => { tracked.add(key); return redis.set(key, ...args); },
  };
  const suffix = crypto.randomUUID();
  const orgIds = [`oauth-a-${suffix}`, `oauth-b-${suffix}`];
  let user;
  try {
    for (const id of orgIds) await db.organization.create({ data: { id, name: 'Disposable OAuth QA', slug: id } });
    user = await db.user.create({ data: { organizationId: orgIds[0], email: `oauth-${suffix}@example.invalid`,
      name: 'Disposable OAuth QA', role: 'ADMIN', password: crypto.randomBytes(32).toString('hex') } });
    const provider = createMcpOAuthProvider({ prisma: db, redis: store, issuer: 'https://oauth-qa.example.invalid', audit: async () => {} });
    const resource = new URL(provider.resource);
    const client = { client_id: CHATGPT_CLIENT_ID };
    const verifier = 'v'.repeat(43);
    const codeChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    async function code() {
      let target;
      await provider.authorize(client, { redirectUri: CHATGPT_REDIRECT, resource, codeChallenge, scopes: ['workspace:read'] }, { redirect: value => { target = value; } });
      const ticket = new URL(target).searchParams.get('state');
      const preview = await provider.preview(ticket, user);
      return new URL((await provider.consent(ticket, preview.nonce, user, true)).redirect).searchParams.get('code');
    }
    const authorizationCode = await code();
    const exchange = () => provider.exchangeAuthorizationCode(client, authorizationCode, verifier, CHATGPT_REDIRECT, resource);
    const exchanged = await Promise.allSettled([exchange(), exchange()]);
    assert.equal(exchanged.filter(result => result.status === 'fulfilled').length, 1);
    const token = exchanged.find(result => result.status === 'fulfilled').value;
    assert.equal(await db.apiKey.count({ where: { userId: user.id } }), 1);
    assert.equal((await provider.verifyAccessToken(token.access_token)).extra.user.organizationId, orgIds[0]);
    const refreshed = await Promise.allSettled([0, 1].map(() => provider.exchangeRefreshToken(client, token.refresh_token, ['workspace:read'], resource)));
    assert.equal(refreshed.filter(result => result.status === 'fulfilled').length, 1);
    const rotated = refreshed.find(result => result.status === 'fulfilled').value;
    await assert.rejects(provider.verifyAccessToken(token.access_token));
    await db.user.update({ where: { id: user.id }, data: { organizationId: orgIds[1] } });
    await assert.rejects(provider.verifyAccessToken(rotated.access_token));
    await db.user.update({ where: { id: user.id }, data: { organizationId: orgIds[0] } });
    await provider.revokeToken(client, { token: rotated.refresh_token });
    await assert.rejects(provider.verifyAccessToken(rotated.access_token));
    await assert.rejects(provider.exchangeRefreshToken(client, rotated.refresh_token, ['workspace:read'], resource));
  } finally {
    if (tracked.size) await redis.del(...tracked);
    if (user) {
      await db.apiKey.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await redis.quit();
    await db.$disconnect();
  }
});
