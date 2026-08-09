import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { tenancyMiddleware } from '../../middleware/tenancy.js';

const MODELS = ['wPSite', 'wPBackup', 'wPReport', 'wPAlert', 'wPFleetOp', 'wPMagicLoginLog', 'supportHourEntry'];

test('every WordPress bridge read receives the verified JWT organization', async () => {
  for (const modelName of MODELS) {
    const calls = [];
    const delegate = { findMany: async (args) => { calls.push(args); return []; } };
    const scoped = createScopedPrisma({ [modelName]: delegate }, 'org-a');
    await scoped[modelName].findMany({ where: { siteUrl: 'https://shared.example' } });
    assert.equal(calls.length, 1, `${modelName} should execute once`);
    assert.equal(calls[0].where.organizationId, 'org-a', `${modelName} should be org scoped`);
  }
});

test('two organizations cannot produce the same bridge query scope', async () => {
  const scopes = [];
  for (const organizationId of ['org-a', 'org-b']) {
    const delegate = { findMany: async (args) => { scopes.push(args.where); return []; } };
    await createScopedPrisma({ wPSite: delegate }, organizationId).wPSite.findMany({});
  }
  assert.deepEqual(scopes, [{ organizationId: 'org-a' }, { organizationId: 'org-b' }]);
});

test('human bridge reads use JWT tenancy while only signed plugin writes are exempt', async () => {
  const reply = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.payload = payload; return this; }
  };
  const humanRead = {
    method: 'GET',
    url: '/api/wp-bridge/backups?siteUrl=https%3A%2F%2Fa.example',
    user: { organizationId: 'org-a' }
  };
  await tenancyMiddleware(humanRead, reply);
  assert.equal(humanRead.organizationId, 'org-a');
  assert.equal(reply.statusCode, 200);

  const pluginWrite = { method: 'POST', url: '/api/wp-bridge/report' };
  await tenancyMiddleware(pluginWrite, reply);
  assert.equal(pluginWrite.organizationId, undefined);

  const untrustedFleetWrite = { method: 'POST', url: '/api/wp-bridge/fleet/command' };
  await tenancyMiddleware(untrustedFleetWrite, reply);
  assert.equal(reply.statusCode, 403);
  assert.equal(reply.payload.code, 'ORG_CONTEXT_REQUIRED');
});
