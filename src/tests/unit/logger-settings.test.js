// Under NODE_ENV=test the app logger must not start the pino-pretty transport
// worker: it writes to fd 1 asynchronously, the same pipe the Node test
// runner uses for serialized report frames, which produced intermittent
// "Unable to deserialize cloned data" failures and hung suites.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { default: logger, resolveLoggerSettings } = await import('../../utils/logger.js');

const TEST = { isDevelopment: false, isTest: true };
const DEVELOPMENT = { isDevelopment: true, isTest: false };
const DEPLOYED = { isDevelopment: false, isTest: false };

describe('logger settings', () => {
  it('test: silent by default, no transport, synchronous stderr destination', () => {
    const settings = resolveLoggerSettings(TEST, undefined);
    assert.equal(settings.level, 'silent');
    assert.equal(settings.transport, undefined);
    assert.ok(settings.destination, 'expected an explicit destination');
    assert.equal(settings.destination.fd, 2, 'test logs must never go to stdout');
  });

  it('test: LOG_LEVEL opts back in to logs (still stderr, no transport)', () => {
    const settings = resolveLoggerSettings(TEST, 'debug');
    assert.equal(settings.level, 'debug');
    assert.equal(settings.transport, undefined);
    assert.equal(settings.destination.fd, 2);
  });

  it('development: pretty transport at debug level', () => {
    const settings = resolveLoggerSettings(DEVELOPMENT, undefined);
    assert.equal(settings.level, 'debug');
    assert.equal(settings.transport.target, 'pino-pretty');
  });

  it('staging/production: JSON to stdout at info level, no transport', () => {
    const settings = resolveLoggerSettings(DEPLOYED, undefined);
    assert.equal(settings.level, 'info');
    assert.equal(settings.transport, undefined);
    assert.equal(settings.destination, undefined);
    assert.equal(resolveLoggerSettings(DEPLOYED, 'warn').level, 'warn');
  });

  it('the shared logger in this test process is silent', () => {
    if (process.env.LOG_LEVEL) return;
    assert.equal(logger.level, 'silent');
  });
});
