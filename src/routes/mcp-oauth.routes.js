import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { requireRecentAuth } from '../auth/reauth.js';
import { CHATGPT_REDIRECT, MCP_OAUTH_SCOPES } from '../auth/mcp-oauth-provider.js';

// Adapt the official SDK's Express protocol handlers without introducing a
// second HTTP listener. Fastify owns parsing, global headers and rate limits.
export function sdkHandler(handler, issuer) {
  return async (request, reply) => new Promise((resolve, reject) => {
    const req = request.raw;
    const originalHeaders = req.headers;
    const originalUrl = req.url;
    const restore = () => { req.headers = originalHeaders; req.url = originalUrl; };
    req.body = request.body;
    // The body has already been consumed and parsed by Fastify. Prevent the
    // SDK's urlencoded middleware from reading that stream a second time.
    req._body = true;
    req.headers = { ...req.headers, 'content-type': 'application/json' };
    req.query = request.query;
    req.url = '/';
    const res = reply.raw;
    res.locals = {};
    res.status = code => { reply.code(code); return res; };
    res.json = body => { restore(); reply.send(body); resolve(); return res; };
    res.send = body => { restore(); reply.send(body); resolve(); return res; };
    res.redirect = target => {
      const url = new URL(target);
      if (url.origin + url.pathname === CHATGPT_REDIRECT) url.searchParams.set('iss', issuer);
      restore(); reply.redirect(url.href); resolve(); return res;
    };
    handler(req, res, error => { restore(); if (error) reject(error); else { reply.code(404).send({ error: 'not_found' }); resolve(); } });
  });
}

export default async function mcpOAuthRoutes(fastify, { provider } = {}) {
  fastify.get('/api/mcp-oauth/status', { onRequest: [fastify.authenticate] }, async () => ({ enabled: Boolean(provider) }));
  registerConsentRoutes(fastify, provider);
  if (!provider) return;
  const { issuer, resource } = provider;
  const publicRoute = { config: { public: true }, bodyLimit: 16384 };
  const noStore = async (_request, reply) => { reply.header('Cache-Control', 'no-store'); };
  const resourceMetadata = { resource, authorization_servers: [issuer], scopes_supported: [...MCP_OAUTH_SCOPES], resource_name: 'Ashbi workspace' };
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp']) {
    fastify.get(path, publicRoute, async () => resourceMetadata);
  }
  fastify.get('/.well-known/oauth-authorization-server', publicRoute, async () => ({
    issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: [...MCP_OAUTH_SCOPES],
    authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true,
  }));
  // This parser is encapsulated: it affects only these protocol endpoints.
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    const entries = [...new URLSearchParams(body)];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return done(new Error('Duplicate OAuth parameters'));
    done(null, Object.fromEntries(entries));
  });
  fastify.get('/oauth/authorize', { ...publicRoute, onRequest: [noStore], config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    sdkHandler(authorizationHandler({ provider, rateLimit: false }), issuer));
  fastify.post('/oauth/token', { ...publicRoute, onRequest: [noStore], config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    sdkHandler(tokenHandler({ provider, rateLimit: false }), issuer));
  fastify.post('/oauth/revoke', { ...publicRoute, onRequest: [noStore], config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    sdkHandler(revocationHandler({ provider, rateLimit: false }), issuer));
}

function registerConsentRoutes(fastify, provider) {
  const issuer = provider?.issuer;
  const noStore = async (_request, reply) => { reply.header('Cache-Control', 'no-store'); };
  const requireProvider = async (_request, reply) => {
    if (!provider) return reply.code(404).send({ error: 'MCP_OAUTH_DISABLED', message: 'ChatGPT OAuth is not enabled on this deployment' });
  };

  async function consentError(operation, reply) {
    try { return await operation(); }
    catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      return reply.code(400).send({ error: error.errorCode, message: 'Connection request expired or changed; start again from ChatGPT' });
    }
  }
  fastify.get('/api/mcp-oauth/consent', { onRequest: [fastify.authenticate, noStore, requireProvider], config: { sideEffectingGet: true } }, async (request, reply) =>
    consentError(() => provider.preview(request.query.state, request.user), reply));
  fastify.post('/api/mcp-oauth/consent', { onRequest: [fastify.authenticate, noStore, requireProvider], preHandler: [requireRecentAuth],
    schema: { body: { type: 'object', additionalProperties: false, required: ['state', 'nonce', 'approved'], properties: {
      state: { type: 'string', maxLength: 128 }, nonce: { type: 'string', maxLength: 128 }, approved: { type: 'boolean' },
    } } } }, async (request, reply) => {
    if (request.headers.origin !== issuer) return reply.code(403).send({ error: 'ORIGIN_DENIED' });
    return consentError(() => provider.consent(request.body.state, request.body.nonce, request.user, request.body.approved), reply);
  });
}
