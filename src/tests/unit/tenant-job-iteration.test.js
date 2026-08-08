import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTenantOrganizationIds, runTenantJob, withCurrentTenantJobData } from '../../jobs/tenant-iteration.js';
import { getRequestOrganizationId } from '../../utils/request-context.js';

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

test('tenant job callbacks run inside an isolated scoped async context', async () => {
  const calls = [];
  const prisma = {
    organization: { findUnique: async () => ({ id: 'org-a' }) },
    template: { findMany: async (args) => { calls.push(args); return []; } },
  };

  await runTenantJob(prisma, 'org-a', async (tenantPrisma) => {
    assert.equal(getRequestOrganizationId(), 'org-a');
    await tenantPrisma.template.findMany();
  });
  assert.deepEqual(calls[0].where, { organizationId: 'org-a' });
});

test('request-created jobs carry the verified async-context organization', async () => {
  const data = await runTenantJob({
    organization: { findUnique: async () => ({ id: 'org-a' }) },
  }, 'org-a', async () => withCurrentTenantJobData({ projectId: 'project-a' }));
  assert.deepEqual(data, { projectId: 'project-a', organizationId: 'org-a' });
  assert.throws(() => withCurrentTenantJobData({ projectId: 'project-a' }), /tenant context/i);
});
