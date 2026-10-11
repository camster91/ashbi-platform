import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { createMcpOAuthProvider, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT } from '../../auth/mcp-oauth-provider.js';
import mcpOAuthRoutes from '../../routes/mcp-oauth.routes.js';
import { createApiKeyAuthenticator } from '../../routes/api-key.routes.js';

const issuer = 'https://hub.ashbi.ca';
const resource = new URL(`${issuer}/api/mcp`);
const verifier = 'a'.repeat(43);
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const client = { client_id: CHATGPT_CLIENT_ID };
function fixture() {
  let time = 1791680000000;
  const records = new Map();
  const redis = {
    async get(key) { const row = records.get(key); return row && row.expires > time ? row.value : null; },
    async set(key, value, _ex, ttl) { records.set(key, { value, expires: time + ttl * 1000 }); },
    async getdel(key) { const row = records.get(key); records.delete(key); return row && row.expires > time ? row.value : null; },
  };
  const user = { id: 'user1', isActive: true, organizationId: 'org1', organization: { mfaRequired: false },
    role: 'ADMIN', email: 'qa@example.invalid', sessionVersion: 1 };
  const keys = [];
  const matches = (key, where) => Object.entries(where).every(([name, value]) => key[name] === value);
  const prisma = {
    user: { findUnique: async ({ where }) => where.id === user.id ? { ...user } : null },
    apiKey: {
      count: async ({ where }) => keys.filter(key => matches(key, where)).length,
      create: async ({ data }) => { const key = { id: `key${keys.length}`, isActive: true, revokedAt: null, ...data }; keys.push(key); return { ...key }; },
      findUnique: async ({ where }) => { const key = keys.find(key => matches(key, where)); return key ? { ...key, user } : null; },
      updateMany: async ({ where, data }) => { const found = keys.filter(key => matches(key, where)); found.forEach(key => Object.assign(key, data)); return { count: found.length }; },
    },
    $transaction: async operation => operation(prisma),
  };
  const audits = [];
  const fetched = [];
  const provider = createMcpOAuthProvider({ prisma, redis, issuer, now: () => time, audit: async (_db, event) => audits.push(event),
    fetchImpl: async url => { fetched.push(url); return { ok: true, text: async () => JSON.stringify({ client_id: CHATGPT_CLIENT_ID,
      redirect_uris: [CHATGPT_REDIRECT], token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'] }) }; } });
  async function pending(params = {}) {
    let redirect;
    await provider.authorize(client, { redirectUri: CHATGPT_REDIRECT, codeChallenge: challenge, resource, scopes: ['workspace:read'], state: 'client-state', ...params }, { redirect: value => { redirect = value; } });
    return new URL(redirect).searchParams.get('state');
  }
  async function code() {
    const ticket = await pending();
    const preview = await provider.preview(ticket, user);
    const response = await provider.consent(ticket, preview.nonce, user, true);
    const callback = new URL(response.redirect);
    assert.equal(callback.searchParams.get('iss'), issuer);
    assert.equal(callback.searchParams.get('state'), 'client-state');
    return callback.searchParams.get('code');
  }
  const exchange = code => provider.exchangeAuthorizationCode(client, code, verifier, CHATGPT_REDIRECT, resource);
  return { provider, user, keys, prisma, audits, fetched, pending, code, exchange, advance: ms => { time += ms; } };
}

test('CIMD fetch is allowlisted and cached; public method is chosen from published methods', async () => {
  const f = fixture();
  assert.equal(await f.provider.clientsStore.getClient('http://169.254.169.254/latest'), undefined);
  assert.equal((await f.provider.clientsStore.getClient(CHATGPT_CLIENT_ID)).token_endpoint_auth_method, 'none');
  await f.provider.clientsStore.getClient(CHATGPT_CLIENT_ID);
  assert.deepEqual(f.fetched, [CHATGPT_CLIENT_ID]);
});

test('authorization denies other resources, callbacks, scopes and malformed PKCE', async () => {
  const f = fixture();
  for (const params of [{ resource: new URL('https://other.invalid/api/mcp') }, { resource: undefined },
    { redirectUri: 'https://attacker.invalid/callback' }, { scopes: ['workspace:actions'] }, { codeChallenge: 'bad' }]) {
    await assert.rejects(f.pending(params));
  }
});

test('consent binds account and nonce, is single-use, and denial returns issuer identification', async () => {
  const f = fixture();
  const ticket = await f.pending();
  const preview = await f.provider.preview(ticket, f.user);
  await assert.rejects(f.provider.preview(ticket, { ...f.user, id: 'other' }));
  await assert.rejects(f.provider.consent(ticket, 'wrong', f.user, true));
  const result = await f.provider.consent(ticket, preview.nonce, f.user, false);
  const callback = new URL(result.redirect);
  assert.equal(callback.searchParams.get('error'), 'access_denied');
  assert.equal(callback.searchParams.get('iss'), issuer);
  assert.equal(callback.searchParams.get('code'), null);
  await assert.rejects(f.provider.consent(ticket, preview.nonce, f.user, true));
});

test('authorization code rejects wrong PKCE, client and callback; correct exchange works once', async () => {
  const f = fixture();
  const code = await f.code();
  await assert.rejects(f.provider.exchangeAuthorizationCode(client, code, 'b'.repeat(43), CHATGPT_REDIRECT, resource));
  await assert.rejects(f.provider.exchangeAuthorizationCode({ client_id: 'other' }, code, verifier, CHATGPT_REDIRECT, resource));
  await assert.rejects(f.provider.exchangeAuthorizationCode(client, code, verifier, 'https://other.invalid', resource));
  const token = await f.exchange(code);
  assert.equal(token.scope, 'workspace:read');
  const auth = await f.provider.verifyAccessToken(token.access_token);
  assert.equal(auth.extra.user.organizationId, 'org1');
  assert.equal(f.keys[0].name, 'ChatGPT (read-only MCP)');
  assert.notEqual(f.keys[0].key, token.access_token);
  assert.equal(f.audits[0].actorUserId, f.user.id);
  assert.equal(JSON.stringify(f.audits).includes(token.access_token), false);
  await assert.rejects(f.exchange(code));
});

test('concurrent code exchanges issue only one connection', async () => {
  const f = fixture();
  const code = await f.code();
  const results = await Promise.allSettled([f.exchange(code), f.exchange(code)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.keys.length, 1);
});

test('codes and pending consent requests expire', async () => {
  const f = fixture();
  const code = await f.code();
  f.advance(61000);
  await assert.rejects(f.exchange(code));
  const ticket = await f.pending();
  f.advance(601000);
  await assert.rejects(f.provider.preview(ticket, f.user));
});

test('refreshing consent preview cannot extend its original lifetime', async () => {
  const f = fixture();
  const ticket = await f.pending();
  f.advance(590000);
  const preview = await f.provider.preview(ticket, f.user);
  f.advance(11000);
  await assert.rejects(f.provider.preview(ticket, f.user));
  await assert.rejects(f.provider.consent(ticket, preview.nonce, f.user, true));
});

test('account deactivation, tenant changes, role changes, session revocation and MFA block tokens', async () => {
  for (const change of [{ isActive: false }, { organizationId: 'org2' }, { role: 'CLIENT' }, { sessionVersion: 2 },
    { organization: { mfaRequired: true }, mfaEnabled: false }]) {
    const f = fixture();
    const token = await f.exchange(await f.code());
    Object.assign(f.user, change);
    await assert.rejects(f.provider.verifyAccessToken(token.access_token));
    await assert.rejects(f.provider.exchangeRefreshToken(client, token.refresh_token, undefined, resource));
  }
});

test('access expires but refresh rotates it; reuse revokes the token family', async () => {
  const f = fixture();
  const initial = await f.exchange(await f.code());
  f.advance(3601000);
  await assert.rejects(f.provider.verifyAccessToken(initial.access_token));
  await assert.rejects(f.provider.exchangeRefreshToken(client, initial.refresh_token, ['workspace:actions'], resource));
  const next = await f.provider.exchangeRefreshToken(client, initial.refresh_token, ['workspace:read'], resource);
  await f.provider.verifyAccessToken(next.access_token);
  await assert.rejects(f.provider.verifyAccessToken(initial.access_token));
  await assert.rejects(f.provider.exchangeRefreshToken(client, initial.refresh_token, undefined, resource));
  await assert.rejects(f.provider.verifyAccessToken(next.access_token));
});

test('revocation through Settings prevents both access and refresh, and grants never exceed 30 days', async () => {
  const f = fixture();
  const token = await f.exchange(await f.code());
  f.keys[0].isActive = false;
  await assert.rejects(f.provider.verifyAccessToken(token.access_token));
  await assert.rejects(f.provider.exchangeRefreshToken(client, token.refresh_token, undefined, resource));
  f.keys[0].isActive = true;
  f.advance(30 * 86400 * 1000);
  await assert.rejects(f.provider.exchangeRefreshToken(client, token.refresh_token, undefined, resource));
});

test('OAuth revocation is idempotent and client-bound', async () => {
  const f = fixture();
  const token = await f.exchange(await f.code());
  await f.provider.revokeToken({ client_id: 'other' }, { token: token.refresh_token });
  await f.provider.verifyAccessToken(token.access_token);
  await f.provider.revokeToken(client, { token: token.refresh_token });
  await f.provider.revokeToken(client, { token: token.refresh_token });
  await assert.rejects(f.provider.verifyAccessToken(token.access_token));
});

test('generic API-key routes refuse MCP OAuth access tokens without touching the database', async () => {
  let queried = false;
  const guard = createApiKeyAuthenticator({ prisma: { apiKey: { findUnique: () => { queried = true; } } } });
  let status;
  const reply = { status: code => { status = code; return reply; }, send: () => {} };
  await guard({ headers: { authorization: 'Bearer ashbi_mcp_test' } }, reply);
  assert.equal(status, 401);
  assert.equal(queried, false);
});

test('SDK authorization and token exchange run through Fastify with exact discovery metadata', async () => {
  const f = fixture();
  const app = Fastify();
  app.decorate('authenticate', async request => { request.user = f.user; });
  await app.register(mcpOAuthRoutes, { provider: f.provider });
  try {
    const metadata = (await app.inject('/.well-known/oauth-authorization-server')).json();
    assert.equal(metadata.issuer, issuer);
    assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
    assert.equal(metadata.authorization_response_iss_parameter_supported, true);
    const query = new URLSearchParams({ client_id: CHATGPT_CLIENT_ID, redirect_uri: CHATGPT_REDIRECT, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', resource: resource.href, scope: 'workspace:read', state: 'original' });
    const response = await app.inject(`/oauth/authorize?${query}`);
    assert.equal(response.statusCode, 302, response.body);
    assert.equal(new URL(response.headers.location).origin, issuer);
    const code = await f.code();
    const tokenResponse = await app.inject({ method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ client_id: CHATGPT_CLIENT_ID, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CHATGPT_REDIRECT, resource: resource.href }).toString() });
    assert.equal(tokenResponse.statusCode, 200, tokenResponse.body);
    await f.provider.verifyAccessToken(tokenResponse.json().access_token);
  } finally { await app.close(); }
});
