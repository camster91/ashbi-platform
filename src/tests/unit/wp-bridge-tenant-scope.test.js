import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

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
