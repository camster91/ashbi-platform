// NODE_ENV is an explicit allowlist: only `development` and `test` may start
// without deployment secrets. Staging is validated like production, and an
// unknown value fails closed at startup instead of silently skipping
// validation (the previous check was `NODE_ENV !== 'production'`).
//
// env.js validates at module-evaluation time, so each case imports it in a
// fresh child process with a controlled environment.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const envUrl = pathToFileURL(path.join(here, '..', '..', 'config', 'env.js')).href;

const SECRET_KEYS = ['JWT_SECRET', 'CREDENTIALS_KEY', 'ADMIN_INVITE_TOKEN', 'WEBHOOK_SECRET', 'STRIPE_SECRET_KEY'];

function loadEnv(overrides) {
  const childEnv = { ...process.env };
  for (const key of [...SECRET_KEYS, 'NODE_ENV']) delete childEnv[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) childEnv[key] = value;
  }
  const script = `import(${JSON.stringify(envUrl)}).then((m) => {
    const e = m.default;
    process.stdout.write(JSON.stringify({ nodeEnv: e.nodeEnv, isDev: e.isDev, isDevelopment: e.isDevelopment, isTest: e.isTest, isStaging: e.isStaging, isProduction: e.isProduction, requiresDeploymentSecrets: e.requiresDeploymentSecrets }));
  });`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: childEnv, encoding: 'utf8' });
  return {
    code: result.status,
    stderr: result.stderr,
    flags: result.status === 0 ? JSON.parse(result.stdout) : null,
  };
}

const REAL_SECRETS = { JWT_SECRET: 'a-real-jwt-secret', CREDENTIALS_KEY: 'a-real-credentials-key' };

describe('NODE_ENV secret validation', () => {
  for (const nodeEnv of ['development', 'test', undefined]) {
    it(`${nodeEnv ?? 'unset (development)'} starts without deployment secrets`, () => {
      const { code, stderr, flags } = loadEnv({ NODE_ENV: nodeEnv });
      assert.equal(code, 0, stderr);
      assert.equal(flags.requiresDeploymentSecrets, false);
      assert.equal(flags.isDev, true);
      assert.equal(flags.nodeEnv, nodeEnv ?? 'development');
    });
  }

  for (const nodeEnv of ['staging', 'production']) {
    it(`${nodeEnv} refuses to start without critical secrets`, () => {
      const { code, stderr } = loadEnv({ NODE_ENV: nodeEnv });
      assert.notEqual(code, 0);
      assert.match(stderr, /Missing critical environment variables: JWT_SECRET, CREDENTIALS_KEY/);
    });

    it(`${nodeEnv} rejects .env.example placeholder secrets`, () => {
      const { code, stderr } = loadEnv({ NODE_ENV: nodeEnv, ...REAL_SECRETS, STRIPE_SECRET_KEY: 'your-stripe-secret-key' });
      assert.notEqual(code, 0);
      assert.match(stderr, /Refusing to start with placeholder env values: STRIPE_SECRET_KEY/);
    });

    it(`${nodeEnv} starts with real secrets and gets deployed-environment flags`, () => {
      const { code, stderr, flags } = loadEnv({ NODE_ENV: nodeEnv, ...REAL_SECRETS });
      assert.equal(code, 0, stderr);
      assert.equal(flags.requiresDeploymentSecrets, true);
      assert.equal(flags.isDev, false, 'deployed environments must not get development behaviour');
      assert.equal(flags.isStaging, nodeEnv === 'staging');
      assert.equal(flags.isProduction, nodeEnv === 'production');
    });
  }

  for (const nodeEnv of ['prod', 'e2e', 'Production']) {
    it(`unknown NODE_ENV "${nodeEnv}" fails closed with a clear error, even with secrets`, () => {
      const { code, stderr } = loadEnv({ NODE_ENV: nodeEnv, ...REAL_SECRETS });
      assert.notEqual(code, 0);
      assert.match(stderr, new RegExp(`Unsupported NODE_ENV "${nodeEnv}"\\. Set NODE_ENV to one of: development, test, staging, production\\.`));
    });
  }
});
