import crypto from 'node:crypto';
import { InvalidClientError, InvalidGrantError, InvalidScopeError, InvalidRequestError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { mustEnrollMfa } from './mfa-enforcement.js';
import { safeEqual } from '../utils/crypto.js';
import { recordAuditEvent } from '../services/audit-event.service.js';

export const CHATGPT_CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
export const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const MCP_OAUTH_PREFIX = 'ashbi_mcp_';
export const MCP_OAUTH_SCOPES = Object.freeze(['workspace:read']);
const ACCESS_SECONDS = 3600;
const GRANT_SECONDS = 30 * 86400;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');

// Redis holds bounded authorization state and hashed refresh-token references.
// Existing API-key rows hold only access-token hashes and provide owner revocation.
export function createMcpOAuthProvider({ prisma, redis, issuer, fetchImpl = fetch, now = Date.now, audit = recordAuditEvent }) {
  const base = new URL(issuer);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('MCP OAuth issuer must be an HTTPS origin');
  const origin = base.origin;
  const resource = `${origin}/api/mcp`;
  const prefix = 'ashbi:mcp-oauth:v1:';
  const read = async key => { const value = await redis.get(prefix + key); return value ? JSON.parse(value) : null; };
  const take = async key => { const value = await redis.getdel(prefix + key); return value ? JSON.parse(value) : null; };
  const save = (key, value, ttl) => redis.set(prefix + key, JSON.stringify(value), 'EX', Math.max(1, Math.floor(ttl)));
  let cachedClient;
  let cachedAt = 0;

  async function getClient(id) {
    // An exact allowlist prevents CIMD from becoming an SSRF fetcher.
    if (id !== CHATGPT_CLIENT_ID) return undefined;
    if (cachedClient && now() - cachedAt < 300000) return cachedClient;
    const response = await fetchImpl(CHATGPT_CLIENT_ID, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new InvalidClientError('ChatGPT client metadata is unavailable');
    const text = await response.text();
    if (text.length > 16384) throw new InvalidClientError('Invalid client metadata');
    const data = JSON.parse(text);
    if (data.client_id !== id || !data.redirect_uris?.includes(CHATGPT_REDIRECT)
      || !(data.token_endpoint_auth_methods_supported ?? [data.token_endpoint_auth_method]).includes('none')) throw new InvalidClientError('Unsupported ChatGPT client metadata');
    // Choose the supported public-client method; PKCE remains mandatory.
    cachedClient = { client_id: id, client_name: 'ChatGPT', redirect_uris: [CHATGPT_REDIRECT],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] };
    cachedAt = now();
    return cachedClient;
  }

  function checkResource(value) {
    if (value?.href !== resource) throw new InvalidRequestError('Resource must match this MCP endpoint');
  }

  async function owner(grant) {
    const user = await prisma.user.findUnique({ where: { id: grant.userId }, include: { organization: true } });
    if (!user?.isActive || !['ADMIN', 'TEAM'].includes(user.role) || !user.organizationId
      || user.organizationId !== grant.organizationId || user.sessionVersion !== grant.sessionVersion || mustEnrollMfa(user)) throw new InvalidGrantError('Account access has changed; reconnect');
    return user;
  }

  async function grantForKey(key) {
    const grant = key && await read(`grant:${key.id}`);
    if (!key?.isActive || key.revokedAt || !grant || grant.resource !== resource || grant.expiresAt <= now()) throw new InvalidGrantError('Connection is expired or revoked');
    await owner(grant);
    return grant;
  }

  async function refreshFor(grant) {
    const token = random();
    await save(`refresh:${hash(token)}`, grant, (grant.expiresAt - now()) / 1000);
    return token;
  }

  const provider = {
    // The SDK delegates S256 verification to this provider so the verifier is
    // available at the same boundary that consumes the single-use code.
    skipLocalPkceValidation: true,
    issuer: origin, resource, clientsStore: { getClient },
    async authorize(client, params, res) {
      checkResource(params.resource);
      if (client.client_id !== CHATGPT_CLIENT_ID || params.redirectUri !== CHATGPT_REDIRECT) throw new InvalidClientError('Unknown client or callback');
      if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge) || (params.state && params.state.length > 1024)) throw new InvalidRequestError('Invalid authorization request');
      const scopes = params.scopes?.length ? params.scopes : MCP_OAUTH_SCOPES;
      if (scopes.some(scope => !MCP_OAUTH_SCOPES.includes(scope))) throw new InvalidScopeError('This connection supports read-only workspace access');
      const ticket = random();
      await save(`pending:${hash(ticket)}`, { clientId: client.client_id, redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge, state: params.state, scopes: [...MCP_OAUTH_SCOPES], resource, expiresAt: now() + 600000 }, 600);
      res.redirect(`${origin}/connect-chatgpt?state=${encodeURIComponent(ticket)}`);
    },
    async preview(ticket, user) {
      const pending = typeof ticket === 'string' && ticket.length < 128 && await read(`pending:${hash(ticket)}`);
      if (!pending || pending.expiresAt <= now() || (pending.userId && pending.userId !== user.id)) throw new InvalidGrantError('Connection request expired or belongs to another account');
      const account = await prisma.user.findUnique({ where: { id: user.id } });
      const bound = { ...pending, userId: user.id, organizationId: user.organizationId, sessionVersion: account?.sessionVersion };
      await owner(bound);
      const nonce = random();
      await save(`pending:${hash(ticket)}`, { ...bound, nonceHash: hash(nonce) }, (pending.expiresAt - now()) / 1000);
      return { clientName: 'ChatGPT', scopes: [...MCP_OAUTH_SCOPES], nonce, resource, accountEmail: user.email };
    },
    async consent(ticket, nonce, user, approved) {
      const pending = typeof ticket === 'string' && ticket.length < 128 && await read(`pending:${hash(ticket)}`);
      if (!pending || pending.expiresAt <= now() || pending.userId !== user.id || typeof nonce !== 'string' || !safeEqual(pending.nonceHash, hash(nonce))) throw new InvalidGrantError('Connection request expired or changed');
      await owner(pending);
      const consumed = await take(`pending:${hash(ticket)}`);
      if (!consumed || consumed.nonceHash !== pending.nonceHash || consumed.userId !== user.id) throw new InvalidGrantError('Connection request already used');
      const redirect = new URL(pending.redirectUri);
      redirect.searchParams.set('iss', origin);
      if (pending.state) redirect.searchParams.set('state', pending.state);
      if (approved) {
        const code = random();
        await save(`code:${hash(code)}`, pending, 60);
        redirect.searchParams.set('code', code);
      } else redirect.searchParams.set('error', 'access_denied');
      return { redirect: redirect.href };
    },
    async challengeForAuthorizationCode(client, code) {
      const data = typeof code === 'string' && code.length < 128 && await read(`code:${hash(code)}`);
      if (!data || data.clientId !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
      return data.codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, verifier, redirectUri, requestedResource) {
      checkResource(requestedResource);
      const data = typeof code === 'string' && code.length < 128 && await read(`code:${hash(code)}`);
      if (!data || data.clientId !== client.client_id || redirectUri !== data.redirectUri
        || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
        || !safeEqual(crypto.createHash('sha256').update(verifier).digest('base64url'), data.codeChallenge)) throw new InvalidGrantError('Invalid authorization code or PKCE');
      await owner(data);
      if (!await take(`code:${hash(code)}`)) throw new InvalidGrantError('Authorization code already used');
      const accessToken = MCP_OAUTH_PREFIX + random();
      const key = await prisma.$transaction(async tx => {
        if (await tx.apiKey.count({ where: { userId: data.userId, isActive: true } }) >= 5) throw new InvalidGrantError('Revoke an unused API key before connecting');
        return tx.apiKey.create({ data: { name: 'ChatGPT (read-only MCP)', userId: data.userId, key: hash(accessToken),
          scopes: data.scopes, expiresAt: new Date(now() + ACCESS_SECONDS * 1000) } });
      }, { isolationLevel: 'Serializable' });
      const grant = { keyId: key.id, userId: data.userId, organizationId: data.organizationId, sessionVersion: data.sessionVersion,
        clientId: client.client_id, resource, scopes: data.scopes, expiresAt: now() + GRANT_SECONDS * 1000 };
      await save(`grant:${key.id}`, grant, GRANT_SECONDS);
      await audit(prisma, { action: 'api_key.created', organizationId: grant.organizationId, actorType: 'USER', actorUserId: grant.userId,
        entityId: key.id, metadata: { ownerUserId: grant.userId, expires: true, expiresAt: key.expiresAt, scopes: grant.scopes } });
      return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_SECONDS, scope: grant.scopes.join(' '), refresh_token: await refreshFor(grant) };
    },
    async exchangeRefreshToken(client, token, scopes, requestedResource) {
      checkResource(requestedResource);
      if (typeof token !== 'string' || token.length > 128) throw new InvalidGrantError('Invalid refresh token');
      const keyName = `refresh:${hash(token)}`;
      const data = await read(keyName);
      if (!data) {
        const used = await read(`used:${hash(token)}`);
        if (used?.clientId === client.client_id) await prisma.apiKey.updateMany({ where: { id: used.keyId }, data: { isActive: false, revokedAt: new Date(now()) } });
        throw new InvalidGrantError('Refresh token expired or already used');
      }
      if (data.clientId !== client.client_id || (scopes?.length && scopes.some(scope => !data.scopes.includes(scope)))) throw new InvalidGrantError('Invalid refresh scope or client');
      const key = await prisma.apiKey.findUnique({ where: { id: data.keyId } });
      const grant = await grantForKey(key);
      if (!await take(keyName)) throw new InvalidGrantError('Refresh token already used');
      await save(`used:${hash(token)}`, { keyId: key.id, clientId: grant.clientId }, (grant.expiresAt - now()) / 1000);
      const accessToken = MCP_OAUTH_PREFIX + random();
      const changed = await prisma.apiKey.updateMany({ where: { id: key.id, key: key.key, isActive: true, revokedAt: null },
        data: { key: hash(accessToken), expiresAt: new Date(Math.min(grant.expiresAt, now() + ACCESS_SECONDS * 1000)) } });
      if (changed.count !== 1) throw new InvalidGrantError('Connection changed; reconnect');
      return { access_token: accessToken, token_type: 'Bearer', expires_in: Math.min(ACCESS_SECONDS, Math.floor((grant.expiresAt - now()) / 1000)),
        scope: grant.scopes.join(' '), refresh_token: await refreshFor(grant) };
    },
    async verifyAccessToken(token) {
      if (typeof token !== 'string' || !token.startsWith(MCP_OAUTH_PREFIX) || token.length > 128) throw new InvalidTokenError('Invalid MCP access token');
      const key = await prisma.apiKey.findUnique({ where: { key: hash(token) } });
      const grant = await grantForKey(key);
      if (!key.expiresAt || key.expiresAt.getTime() <= now()) throw new InvalidTokenError('MCP access token expired');
      const user = await owner(grant);
      return { token, clientId: grant.clientId, scopes: [...grant.scopes], expiresAt: Math.floor(key.expiresAt.getTime() / 1000),
        resource: new URL(resource), extra: { user: { id: user.id, email: user.email, name: user.name, role: user.role,
          organizationId: user.organizationId, clientId: user.clientId } } };
    },
    async revokeToken(client, request) {
      const token = request.token;
      if (typeof token !== 'string' || token.length > 128) return;
      const refresh = await read(`refresh:${hash(token)}`) ?? await read(`used:${hash(token)}`);
      const key = refresh ? await prisma.apiKey.findUnique({ where: { id: refresh.keyId } }) : await prisma.apiKey.findUnique({ where: { key: hash(token) } });
      const grant = key && await read(`grant:${key.id}`);
      if (!grant || grant.clientId !== client.client_id) return;
      await prisma.apiKey.updateMany({ where: { id: key.id, isActive: true }, data: { isActive: false, revokedAt: new Date(now()) } });
      await audit(prisma, { action: 'api_key.revoked', organizationId: grant.organizationId, actorType: 'USER', actorUserId: grant.userId,
        entityId: key.id, metadata: { ownerUserId: grant.userId } });
    },
  };
  return provider;
}
