import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildApp } from '../../index.js';
import { registerCoreRevenueRoutes } from '../../domains/revenue/register-core-routes.js';

test('buildApp constructs the complete API without listening', async () => {
  const app = await buildApp({ initializeRuntime: false, jwtSecret: 'test-only-jwt-secret' });
  try {
    assert.equal(app.server.listening, false);
    const response = await app.inject({ method: 'GET', url: '/api/live' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'ok');
  } finally {
    await app.close();
  }
});

test('process lifecycle is isolated from application construction', () => {
  const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

  assert.doesNotMatch(factory, /\.listen\s*\(/);
  assert.doesNotMatch(factory, /process\.on\s*\(/);
  assert.match(server, /await buildApp\(\)/);
  assert.match(server, /process\.once\('SIGINT'/);
  assert.match(server, /process\.once\('SIGTERM'/);
  assert.equal(packageJson.scripts['start:api'], 'node --import ./src/tracing.js src/server.js');
});

test('runtime subscribers receive dependencies instead of importing the entry point', () => {
  for (const relative of [
    '../../subscribers/notification.subscriber.js',
    '../../subscribers/socket.subscriber.js',
    '../../services/notification.service.js',
    '../../routes/notification.routes.js',
  ]) {
    const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /import\(['"]\.\.\/index\.js['"]\)|from ['"]\.\.\/index\.js['"]/);
  }
});

test('the backend boundary and incremental domain plan are documented', () => {
  const documentation = fs.readFileSync(new URL('../../../docs/backend-application-boundaries.md', import.meta.url), 'utf8');
  assert.match(documentation, /server -> app ->/);
  assert.match(documentation, /identity and access/);
  assert.match(documentation, /client delivery/);
  assert.match(documentation, /revenue/);
  assert.match(documentation, /integrations and operations/);
});

test('core revenue routes are owned by a domain registrar', () => {
  const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const registrar = fs.readFileSync(new URL('../../domains/revenue/register-core-routes.js', import.meta.url), 'utf8');

  assert.match(factory, /registerCoreRevenueRoutes\(fastify\)/);
  for (const route of ['invoice-chaser', 'invoice', 'contract', 'proposal']) {
    assert.doesNotMatch(factory, new RegExp(`routes\\/${route}\\.routes\\.js`));
    assert.match(registrar, new RegExp(`routes\\/${route}\\.routes\\.js`));
  }
  for (const prefix of ['/api/invoice-chaser', '/api/invoices', '/api/contracts', '/api/proposals']) {
    assert.match(registrar, new RegExp(prefix));
  }
});

test('core revenue registrar preserves route order and prefixes', async () => {
  const registrations = [];
  const fastify = {
    async register(plugin, options) {
      registrations.push({ plugin, prefix: options.prefix });
    },
  };

  await registerCoreRevenueRoutes(fastify);

  assert.deepEqual(registrations.map(({ prefix }) => prefix), [
    '/api/invoice-chaser',
    '/api/invoices',
    '/api/contracts',
    '/api/proposals',
  ]);
  assert.equal(new Set(registrations.map(({ plugin }) => plugin)).size, 4);
  assert.ok(registrations.every(({ plugin }) => typeof plugin === 'function'));
});
