import { createRemoteJWKSet, jwtVerify } from 'jose';
const resolvers = new Map();
export async function authenticate(request, env, resolveKey) {
  const issuer = env.ACCESS_TEAM_DOMAIN;
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer || '') || !env.ACCESS_AUD) throw 401;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || token.length > 16_384) throw 401;
  if (!resolveKey) {
    // Public signing keys only; never cache an identity or request data.
    if (!resolvers.has(issuer)) resolvers.set(issuer, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
    resolveKey = resolvers.get(issuer);
  }
  const { payload } = await jwtVerify(token, resolveKey, { issuer, audience: env.ACCESS_AUD,
    algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'], maxTokenAge: '1h' });
  if (typeof payload.email !== 'string' || !payload.email.includes('@')) throw 401;
  return { email: payload.email.toLowerCase(), subject: payload.sub };
}
