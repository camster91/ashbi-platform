import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEmbeddingOrganizationId } from '../../jobs/embedding-ownership.js';

test('current embedding jobs retain their verified tenant without a lookup', async () => {
  const prisma = { client: { findUnique: async () => assert.fail('lookup must not run') } };
  assert.equal(
    await resolveEmbeddingOrganizationId({ organizationId: 'org-current', clientId: 'client-1' }, prisma),
    'org-current',
  );
});

test('legacy embedding jobs recover ownership from their client foreign key', async () => {
  const prisma = {
    client: {
      findUnique: async (args) => {
        assert.deepEqual(args, {
          where: { id: 'client-legacy' },
          select: { organizationId: true },
        });
        return { organizationId: 'org-recovered' };
      },
    },
  };
  assert.equal(
    await resolveEmbeddingOrganizationId({ clientId: 'client-legacy' }, prisma),
    'org-recovered',
  );
});

test('legacy embedding jobs without a provable owner fail closed', async () => {
  const prisma = { client: { findUnique: async () => null } };
  assert.equal(await resolveEmbeddingOrganizationId({ clientId: 'missing' }, prisma), undefined);
  assert.equal(await resolveEmbeddingOrganizationId({}, prisma), undefined);
});
