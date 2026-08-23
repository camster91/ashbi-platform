import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { tenancyMiddleware } from '../../middleware/tenancy.js';
import { executeFleetOp, listFleetOps, resolveTargetSites } from '../../services/fleetOps.service.js';
import {
  checkMagicLoginRateLimit,
  deleteSite,
  findMagicLoginSite,
  getMagicLoginLog,
  recordMagicLoginEvent
} from '../../services/wpBridge.service.js';

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

test('fleet target selection and audit rows use the request-scoped Prisma client', async () => {
  const calls = { sites: [], creates: [], updates: [], lists: [] };
  const scoped = createScopedPrisma({
    wPSite: {
      findMany: async (args) => {
        calls.sites.push(args);
        return [{ id: 'site-a', url: 'https://a.example', name: 'A', magicLoginUserId: 7, bridgeSecretEncrypted: null }];
      }
    },
    wPFleetOp: {
      create: async (args) => { calls.creates.push(args); return { id: 'fleet-a' }; },
      update: async (args) => { calls.updates.push(args); return { id: 'fleet-a' }; },
      findMany: async (args) => { calls.lists.push(args); return []; }
    }
  }, 'org-a');

  const sites = await resolveTargetSites({ targetAll: true, prismaClient: scoped });
  assert.equal(sites.length, 1);
  assert.equal(calls.sites[0].where.organizationId, 'org-a');

  await executeFleetOp({
    opType: 'command', payload: { cmd: 'wp option get home' }, targetSites: [], endpoint: 'command', createdBy: 'admin-a', prismaClient: scoped
  });
  assert.equal(calls.creates[0].data.organizationId, 'org-a');
  assert.equal(calls.updates[0].where.organizationId, 'org-a');

  await listFleetOps({ prismaClient: scoped });
  assert.equal(calls.lists[0].where.organizationId, 'org-a');
});

test('magic-login site resolution, rate limits, and audit logs remain tenant-scoped', async () => {
  const calls = { site: [], logCreate: [], logRead: [], logCount: [] };
  const scoped = createScopedPrisma({
    wPSite: {
      findUnique: async (args) => { calls.site.push(args); return { id: 'site-a', url: 'https://a.example' }; }
    },
    wPMagicLoginLog: {
      create: async (args) => { calls.logCreate.push(args); return { id: 'log-a' }; },
      findMany: async (args) => { calls.logRead.push(args); return []; },
      count: async (args) => { calls.logCount.push(args); return 0; }
    }
  }, 'org-a');

  await findMagicLoginSite({ siteId: 'site-a' }, { prismaClient: scoped });
  await recordMagicLoginEvent({ siteId: 'site-a', siteUrl: 'https://a.example', status: 'issued' }, { prismaClient: scoped });
  await getMagicLoginLog({}, { prismaClient: scoped });
  await checkMagicLoginRateLimit({ siteId: 'site-a' }, { prismaClient: scoped });

  assert.equal(calls.site[0].where.organizationId, 'org-a');
  assert.equal(calls.logCreate[0].data.organizationId, 'org-a');
  assert.equal(calls.logRead[0].where.organizationId, 'org-a');
  assert.equal(calls.logCount[0].where.organizationId, 'org-a');
});

test('removing a WordPress site uses the request-scoped Prisma client', async () => {
  const calls = [];
  const scoped = createScopedPrisma({
    wPSite: {
      delete: async (args) => {
        calls.push(args);
        return { id: 'site-a' };
      }
    }
  }, 'org-a');

  await deleteSite('site-a', { prismaClient: scoped });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.id, 'site-a');
  assert.equal(calls[0].where.organizationId, 'org-a');
});

test('every human fleet route passes request-scoped Prisma to its service calls', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const routePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'routes', 'wp-bridge.routes.js');
  const source = fs.readFileSync(routePath, 'utf8');

  const targetResolutionCalls = source.match(/resolveTargetSites\(\{ targetAll, targetSites, prismaClient: request\.prisma \}\)/g) || [];
  assert.equal(targetResolutionCalls.length, 4, 'file patch, command, option set, and magic login must scope target selection');

  const fleetOperationCalls = source.match(/executeFleetOp\(\{[\s\S]*?prismaClient: request\.prisma[\s\S]*?\}\);/g) || [];
  assert.equal(fleetOperationCalls.length, 5, 'every fleet operation, including magic-login revoke, must scope its audit writes');
  assert.match(source, /listFleetOps\(\{ limit, opType, prismaClient: request\.prisma \}\)/);
  assert.match(source, /getMagicLoginLog\([\s\S]{0,300}?prismaClient: request\.prisma/);
  assert.match(source, /deleteSite\(id, \{ prismaClient: request\.prisma \}\)/);
});
