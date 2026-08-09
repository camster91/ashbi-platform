import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeExpiredTrash } from '../../jobs/trash-purge.js';

test('scheduled purge delegates each expired ledger to the atomic hard-purge boundary', async () => {
  const expired = [
    { id: 'trash-a', entity: 'NOTE' },
    { id: 'trash-b', entity: 'TASK' },
  ];
  const scopedPrisma = {
    trashedItem: { findMany: async () => expired },
  };
  const calls = [];
  const purge = async (args) => {
    calls.push(args);
    if (args.trashId === 'trash-b') throw new Error('temporary database failure');
    return { deleted: true };
  };
  const rawPrisma = { marker: 'raw' };

  const result = await purgeExpiredTrash(scopedPrisma, rawPrisma, purge);

  assert.deepEqual(calls, [
    { scopedPrisma, rawPrisma, trashId: 'trash-a' },
    { scopedPrisma, rawPrisma, trashId: 'trash-b' },
  ]);
  assert.deepEqual(result, { examined: 2, purged: 1, failed: 1 });
});

test('scheduled purge reports an empty run without invoking the privileged boundary', async () => {
  const scopedPrisma = {
    trashedItem: { findMany: async () => [] },
  };
  let called = false;

  const result = await purgeExpiredTrash(scopedPrisma, {}, async () => { called = true; });

  assert.deepEqual(result, { examined: 0, purged: 0, failed: 0 });
  assert.equal(called, false);
});
