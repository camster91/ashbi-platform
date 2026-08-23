import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { scrubTelemetryEvent } from '../../observability/sentry.js';

test('telemetry removes request payloads, credentials, identities, and query strings', () => {
  const event = scrubTelemetryEvent({
    user: { id: 'user-1', email: 'client@example.com' },
    request: {
      method: 'POST',
      url: 'https://hub.ashbi.ca/api/clients/cm12345678901234567890?token=secret',
      headers: { authorization: 'Bearer private-token', cookie: 'token=private' },
      data: { clientName: 'Private Client' },
    },
    extra: {
      password: 'secret',
      payload: { project: 'Private Project' },
      safeStatus: 503,
    },
    breadcrumbs: [{ message: 'Failed for client@example.com', data: { authorization: 'Bearer abc' } }],
    exception: { values: [{ value: 'Contact client@example.com with Bearer abc.def' }] },
  });

  assert.equal(event.user, undefined);
  assert.deepEqual(event.request, { method: 'POST', url: '/api/clients/:id' });
  assert.equal(event.extra.password, '[redacted]');
  assert.equal(event.extra.payload, '[redacted]');
  assert.equal(event.extra.safeStatus, 503);
  assert.equal(event.exception.values[0].value, '[redacted error message]');
  assert.doesNotMatch(JSON.stringify(event), /Private Client|Private Project|client@example\.com|private-token|abc\.def/);
});

test('tracing is opt-in and never exits ahead of application shutdown', () => {
  const tracing = fs.readFileSync(new URL('../../tracing.js', import.meta.url), 'utf8');
  assert.doesNotMatch(tracing, /localhost:4318/);
  assert.doesNotMatch(tracing, /process\.exit\(/);
  assert.match(tracing, /process\.env\.APP_REVISION/);
  assert.match(tracing, /ATTR_DEPLOYMENT_ENVIRONMENT_NAME/);
});

test('authentication action links are never written to application logs', () => {
  const authRoutes = fs.readFileSync(new URL('../../routes/auth.routes.js', import.meta.url), 'utf8');
  const logCalls = authRoutes.match(/(?:console|logger)\.(?:log|info|warn|error)\([\s\S]*?\);/g) || [];

  for (const logCall of logCalls) {
    assert.doesNotMatch(
      logCall,
      /\b(?:resetLink|inviteLink|resetToken)\b/,
      `Authentication credential found in log call: ${logCall}`
    );
  }
});
