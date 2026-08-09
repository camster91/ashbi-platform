import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildApp } from '../../index.js';

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
