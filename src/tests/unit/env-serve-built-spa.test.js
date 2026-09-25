import test from 'node:test';
import assert from 'node:assert/strict';

async function loadEnv(overrides) {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    const module = await import(`../../config/env.js?serve-spa=${Math.random()}`);
    return module.default;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('the built SPA is not served outside production unless explicitly enabled', async () => {
  const env = await loadEnv({ NODE_ENV: 'test', SERVE_BUILT_SPA: undefined });
  assert.equal(env.serveBuiltSpa, false);
});

test('SERVE_BUILT_SPA=true serves the SPA for the full-stack E2E stack', async () => {
  const env = await loadEnv({ NODE_ENV: 'test', SERVE_BUILT_SPA: 'true' });
  assert.equal(env.serveBuiltSpa, true);
});

test('production always serves the built SPA', async () => {
  const env = await loadEnv({
    NODE_ENV: 'production',
    SERVE_BUILT_SPA: undefined,
    JWT_SECRET: 'unit-test-jwt-secret',
    CREDENTIALS_KEY: 'unit-test-credentials-key',
  });
  assert.equal(env.serveBuiltSpa, true);
});
