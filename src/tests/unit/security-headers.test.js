import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { buildHelmetOptions, permissionsPolicy } from '../../config/security-headers.js';
import { readFile } from 'node:fs/promises';

async function responseFor(options) {
  const app = Fastify();
  await app.register(helmet, buildHelmetOptions(options));
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Permissions-Policy', permissionsPolicy);
    return payload;
  });
  app.get('/', async () => ({ ok: true }));
  const response = await app.inject('/');
  await app.close();
  return response;
}

test('production responses enforce the approved security headers', async () => {
  const response = await responseFor({
    isProduction: true,
    corsOrigins: ['https://hub.ashbi.ca'],
    sentryDsn: 'https://public@example.ingest.sentry.io/1'
  });
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.match(response.headers['strict-transport-security'], /max-age=31536000/);
  assert.match(response.headers['strict-transport-security'], /includeSubDomains/);
  assert.equal(response.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
  assert.match(response.headers['permissions-policy'], /camera=\(\)/);
});

test('CSP permits required assets while denying active third-party content', async () => {
  const response = await responseFor({ isProduction: true, corsOrigins: ['https://hub.ashbi.ca'] });
  const csp = response.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com data:/);
  assert.match(csp, /style-src 'self' https:\/\/fonts\.googleapis\.com 'unsafe-inline'/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('development omits HSTS and upgrade-insecure-requests', async () => {
  const response = await responseFor({ isProduction: false });
  assert.equal(response.headers['strict-transport-security'], undefined);
  assert.doesNotMatch(response.headers['content-security-policy'], /upgrade-insecure-requests/);
});

test('production HTML contains no executable inline scripts blocked by CSP', async () => {
  const html = await readFile(new URL('../../../web/index.html', import.meta.url), 'utf8');
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  assert.deepEqual(inlineScripts, []);
});
