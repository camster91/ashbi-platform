import test from 'node:test';
import assert from 'node:assert/strict';
import { auditWpBridgeOwnership } from '../../../scripts/audit-wp-bridge-ownership.mjs';

test('ownership audit works after organizationId becomes non-nullable', async () => {
  const queries = [];
  const prismaClient = new Proxy({
    $queryRawUnsafe: async (sql) => {
      queries.push(sql);
      return /SELECT id, url/.test(sql) ? [] : [{ count: 0 }];
    }
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return { count: async () => 2 };
    }
  });

  const report = await auditWpBridgeOwnership(prismaClient);

  assert.equal(report.wPSite.total, 2);
  assert.equal(report.wPSite.unowned, 0);
  assert.equal(report.wPSite.unprovisionedCredentials, 0);
  assert.deepEqual(report.unownedSites, []);
  assert.ok(queries.some((sql) => sql.includes('FROM "wp_sites" WHERE "organizationId" IS NULL')));
});
