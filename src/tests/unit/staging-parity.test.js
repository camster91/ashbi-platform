// Staging must get production security behaviour (env.isDeployed), not the
// relaxed local-development paths. env.js is evaluated once per process, so
// this file sets NODE_ENV=staging before importing anything that reads it.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';

process.env.NODE_ENV = 'staging';
process.env.LOG_LEVEL = 'silent'; // deployed logger writes JSON to stdout
process.env.JWT_SECRET = 'staging-parity-jwt-secret';
process.env.CREDENTIALS_KEY = 'staging-parity-credentials-key';
delete process.env.ADMIN_INVITE_TOKEN;

const { default: env } = await import('../../config/env.js');
const { default: authRoutes } = await import('../../routes/auth.routes.js');
const { toClientErrorBody } = await import('../../utils/http-errors.js');
const { sessionCookieOptions } = await import('../../auth/session.js');
const { reauthCookieOptions } = await import('../../auth/reauth.js');
const { buildHelmetOptions } = await import('../../config/security-headers.js');
const { apiRateLimitMax, DEFAULT_API_RATE_LIMIT_MAX } = await import('../../config/rateLimit.js');

test('staging is a deployed, non-production environment', () => {
  assert.equal(env.isStaging, true);
  assert.equal(env.isDeployed, true);
  assert.equal(env.isProduction, false);
  assert.equal(env.isDev, false);
});

test('staging refuses first-user admin bootstrap without ADMIN_INVITE_TOKEN', async (t) => {
  let created = 0;
  const user = {
    count: async () => 0,
    findUnique: async () => null,
    create: async () => { created += 1; return {}; },
  };
  const client = { user, organization: {}, $transaction: async (fn) => fn({ user, organization: {}, $executeRaw: async () => 1 }) };
  const app = Fastify();
  await app.register(fastifyJwt, { secret: 'staging-parity-jwt-secret' });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', client);
  app.addHook('onRequest', async (request) => { request.prisma = client; });
  await app.register(authRoutes);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/register',
    payload: { email: 'first@agency.test', password: 'Bootstrap-Passw0rd!', name: 'First Admin' },
  });

  assert.equal(response.statusCode, 503, response.body);
  assert.match(response.json().error, /ADMIN_INVITE_TOKEN is required/);
  assert.equal(created, 0);
});

test('staging 5xx bodies are generic, with no error detail', () => {
  const body = toClientErrorBody(new Error('postgres connection refused at 10.0.0.5'), { traceId: 't-1' });
  assert.equal(body.message, 'An unexpected error occurred');
  assert.equal(body.detail, undefined);
});

test('staging session and re-auth cookies are secure', () => {
  const session = sessionCookieOptions();
  assert.equal(session.secure, true);
  assert.equal(session.sameSite, 'strict');
  assert.equal(reauthCookieOptions().secure, true);
});

test('staging sends HSTS and upgrade-insecure-requests', () => {
  const options = buildHelmetOptions(env);
  assert.ok(options.hsts, 'expected HSTS');
  assert.deepEqual(options.contentSecurityPolicy.directives.upgradeInsecureRequests, []);
});

test('staging ignores the API rate-limit override', () => {
  assert.equal(apiRateLimitMax('2000'), DEFAULT_API_RATE_LIMIT_MAX);
  assert.equal(apiRateLimitMax('2000', 'staging'), DEFAULT_API_RATE_LIMIT_MAX);
});
