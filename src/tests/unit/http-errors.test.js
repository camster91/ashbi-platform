import test from 'node:test';
import assert from 'node:assert/strict';
import { toClientErrorBody } from '../../utils/http-errors.js';
import { redactIntegration } from '../../utils/redact-integration.js';

test('toClientErrorBody hides internal messages for 500 in production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const body = toClientErrorBody(new Error('postgres connection refused'), { traceId: 'abc' });
  assert.equal(body.message, 'An unexpected error occurred');
  assert.equal(body.error, 'InternalServerError');
  assert.equal(body.traceId, 'abc');
  assert.equal(body.detail, undefined);
  process.env.NODE_ENV = prev;
});

test('redactIntegration strips OAuth tokens', () => {
  const out = redactIntegration({
    id: '1',
    type: 'QUICKBOOKS',
    accessToken: 'secret-at',
    refreshToken: 'secret-rt',
    status: 'CONNECTED',
  });
  assert.equal(out.accessToken, '[REDACTED]');
  assert.equal(out.refreshToken, '[REDACTED]');
  assert.equal(out.status, 'CONNECTED');
});
