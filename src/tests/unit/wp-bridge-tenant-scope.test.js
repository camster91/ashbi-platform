import test from 'node:test';
import assert from 'node:assert/strict';
import { tenancyMiddleware } from '../../middleware/tenancy.js';

test('human bridge reads use JWT tenancy while only signed plugin writes are exempt', async () => {
  const reply = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.payload = payload; return this; }
  };
  const humanRead = {
    method: 'GET',
    url: '/api/wp-bridge',
    user: { organizationId: 'org-a' }
  };
  await tenancyMiddleware(humanRead, reply);
  assert.equal(humanRead.organizationId, 'org-a');
  assert.equal(reply.statusCode, 200);

  for (const url of ['/api/wp-bridge', '/api/wp-bridge/']) {
    const healthWrite = { method: 'PUT', url };
    reply.statusCode = 200;
    await tenancyMiddleware(healthWrite, reply);
    assert.equal(reply.statusCode, 200, `${url} reaches route-level HMAC verification`);
    assert.equal(healthWrite.organizationId, undefined);
  }

  const untrustedFleetWrite = { method: 'POST', url: '/api/wp-bridge/fleet/command' };
  await tenancyMiddleware(untrustedFleetWrite, reply);
  assert.equal(reply.statusCode, 403);
  assert.equal(reply.payload.code, 'ORG_CONTEXT_REQUIRED');
});
