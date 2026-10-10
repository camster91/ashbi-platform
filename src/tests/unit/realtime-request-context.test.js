import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma as basePrisma } from '../../config/db.js';
import { requestStorage, getRequestPrisma, getRequestOrganizationId, withoutHttpRequestContext } from '../../utils/request-context.js';

test('realtime authorization ignores an inherited HTTP tenant and restores it afterwards', async () => {
  const otherTenant = { user: { findUnique: () => { throw Error('unrelated HTTP tenant'); } } };
  await requestStorage.run({ prisma: otherTenant, organizationId: 'another-org' }, async () => {
    assert.equal(getRequestPrisma(), otherTenant);
    await withoutHttpRequestContext(async () => {
      await Promise.resolve();
      assert.equal(getRequestPrisma(), basePrisma);
      assert.equal(getRequestOrganizationId(), null);
    });
    assert.equal(getRequestPrisma(), otherTenant);
    assert.equal(getRequestOrganizationId(), 'another-org');
  });
});

test('packet continuations retain the independent realtime context', async () => {
  await requestStorage.run({ prisma: {}, organizationId: 'another-org' }, async () => {
    await new Promise(resolve => withoutHttpRequestContext(() => {
      process.nextTick(() => {
        assert.equal(getRequestPrisma(), basePrisma);
        assert.equal(getRequestOrganizationId(), null);
        resolve();
      });
    }));
    assert.equal(getRequestOrganizationId(), 'another-org');
  });
});
