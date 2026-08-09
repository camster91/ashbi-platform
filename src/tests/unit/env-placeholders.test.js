/**
 * Env Placeholder Rejection Tests
 *
 * src/config/env.js refuses to start in production if any of the tracked
 * secrets equals the .env.example placeholder value. The previous
 * implementation only caught JWT_SECRET and CREDENTIALS_KEY. PR-D
 * extended the list to include WP_BRIDGE_SECRET after the audit
 * identified that a copy-paste deploy would otherwise start with a
 * publicly-known shared HMAC secret.
 *
 * The validation is a module-load-time side effect, so the only way to
 * exercise it in isolation is to spawn a fresh `node` subprocess with
 * NODE_ENV=production and the placeholder set, then assert it exits
 * non-zero with the right error message.
 *
 * Run with: node --test src/tests/unit/env-placeholders.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envJsPath = path.join(__dirname, '..', '..', 'config', 'env.js');
const envJsUrl = pathToFileURL(envJsPath).href;

/**
 * Run `node -e "import('<env.js>')"` in a child process with the given
 * env overrides. Returns { code, stdout, stderr }.
 *
 * We use -e + dynamic import() rather than executing env.js directly
 * because env.js has no top-level await; the side effect (throw on
 * placeholder) happens at module evaluation time, which dynamic import
 * triggers reliably.
 */
function runEnvWithEnv(envOverrides) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['-e', `import(${JSON.stringify(envJsUrl)})`],
      {
        env: { ...process.env, ...envOverrides },
        cwd: path.resolve(__dirname, '..', '..', '..'),
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// Snapshot env vars we mutate so other test files aren't affected
const MUTATED_KEYS = [
  'NODE_ENV',
  'JWT_SECRET',
  'CREDENTIALS_KEY',
  'WP_BRIDGE_SECRET',
];
const originalEnv = Object.fromEntries(
  MUTATED_KEYS.map((k) => [k, process.env[k]])
);

before(() => {
  for (const k of MUTATED_KEYS) delete process.env[k];
});

after(() => {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('Env placeholder rejection (production-only)', () => {
  test('rejects WP_BRIDGE_SECRET equal to placeholder in production', async () => {
    const { code, stderr } = await runEnvWithEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-real-secret-not-the-placeholder',
      CREDENTIALS_KEY: 'a-real-credentials-key',
      WP_BRIDGE_SECRET: 'your-wp-bridge-shared-secret',
    });

    assert.notEqual(code, 0, 'process should exit non-zero on placeholder');
    assert.match(
      stderr,
      /WP_BRIDGE_SECRET/,
      'error should name the offending key'
    );
    assert.match(
      stderr,
      /placeholder/i,
      'error should mention placeholder'
    );
  });

  test('rejects JWT_SECRET equal to placeholder in production (regression guard)', async () => {
    const { code, stderr } = await runEnvWithEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'your-secret-key-change-in-production',
      CREDENTIALS_KEY: 'a-real-credentials-key',
      WP_BRIDGE_SECRET: 'a-real-bridge-secret',
    });

    assert.notEqual(code, 0);
    assert.match(stderr, /JWT_SECRET/);
  });

  test('rejects CREDENTIALS_KEY equal to placeholder in production (regression guard)', async () => {
    const { code, stderr } = await runEnvWithEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-real-secret-not-the-placeholder',
      CREDENTIALS_KEY: 'your-credentials-key-change-in-production',
      WP_BRIDGE_SECRET: 'a-real-bridge-secret',
    });

    assert.notEqual(code, 0);
    assert.match(stderr, /CREDENTIALS_KEY/);
  });

  test('lists all offending keys when multiple placeholders are set', async () => {
    const { code, stderr } = await runEnvWithEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'your-secret-key-change-in-production',
      CREDENTIALS_KEY: 'your-credentials-key-change-in-production',
      WP_BRIDGE_SECRET: 'your-wp-bridge-shared-secret',
    });

    assert.notEqual(code, 0);
    assert.match(stderr, /JWT_SECRET/);
    assert.match(stderr, /CREDENTIALS_KEY/);
    assert.match(stderr, /WP_BRIDGE_SECRET/);
  });

  test('starts cleanly with all secrets replaced (no placeholders)', async () => {
    const { code, stderr } = await runEnvWithEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-real-secret-not-the-placeholder',
      CREDENTIALS_KEY: 'a-real-credentials-key',
      WP_BRIDGE_SECRET: 'a-real-bridge-secret',
    });

    // Code 0 (or 0/exit cleanly) — any non-zero is a regression in the
    // baseline-allow path. Note: env.js may warn (not throw) about
    // other missing recommended env vars; we only care that it does
    // NOT throw.
    if (code !== 0) {
      assert.fail(
        `env.js should not throw with replaced secrets, got code=${code} stderr=${stderr}`
      );
    }
  });

  test('does NOT reject placeholder values in non-production (dev) mode', async () => {
    // Dev mode intentionally allows placeholders so local development
    // works with the .env.example values. Only production is strict.
    const { code, stderr } = await runEnvWithEnv({
      NODE_ENV: 'development',
      WP_BRIDGE_SECRET: 'your-wp-bridge-shared-secret',
    });

    if (code !== 0) {
      assert.fail(
        `env.js should allow placeholder in dev, got code=${code} stderr=${stderr}`
      );
    }
  });
});

describe('WP_BRIDGE_SECRET is in the rejection list (static check)', () => {
  // Static / source-text guard so a future refactor can't silently
  // remove WP_BRIDGE_SECRET from the placeholders object. This is the
  // same discipline as the audit's manual scan, encoded as a test.
  test('src/config/env.js placeholders object contains WP_BRIDGE_SECRET', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(envJsPath, 'utf8');
    assert.match(
      src,
      /WP_BRIDGE_SECRET\s*:\s*['"]your-wp-bridge-shared-secret['"]/,
      'placeholders object must include WP_BRIDGE_SECRET with its placeholder value'
    );
  });

  test('src/config/env.js placeholders object still rejects JWT_SECRET and CREDENTIALS_KEY (no regression)', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(envJsPath, 'utf8');
    assert.match(src, /JWT_SECRET\s*:\s*['"]your-secret-key-change-in-production['"]/);
    assert.match(src, /CREDENTIALS_KEY\s*:\s*['"]your-credentials-key-change-in-production['"]/);
  });
});
