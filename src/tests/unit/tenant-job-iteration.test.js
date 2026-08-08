import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTenantOrganizationIds } from '../../jobs/tenant-iteration.js';

test('recurring jobs enumerate every organization explicitly', async () => {
  const calls = [];
  const prisma = {
    organization: {
      findMany: async (args) => {
        calls.push(args);
        return [{ id: 'org-a' }, { id: 'org-b' }];
      },
    },
  };

  assert.deepEqual(await resolveTenantOrganizationIds(prisma), ['org-a', 'org-b']);
  assert.deepEqual(calls, [{ select: { id: true }, orderBy: { id: 'asc' } }]);
});

test('tenant-targeted jobs verify the declared organization exists', async () => {
  const prisma = {
    organization: {
      findUnique: async ({ where }) => where.id === 'org-a' ? { id: 'org-a' } : null,
    },
  };

  assert.deepEqual(await resolveTenantOrganizationIds(prisma, 'org-a'), ['org-a']);
  await assert.rejects(
    resolveTenantOrganizationIds(prisma, 'org-missing'),
    /unknown organization org-missing/i,
  );
});
