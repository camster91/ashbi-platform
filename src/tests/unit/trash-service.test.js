import test from 'node:test';
import assert from 'node:assert/strict';
import { softDelete } from '../../services/trash.service.js';

test('soft delete creates a tenant recovery ledger in the same transaction', async () => {
  const calls = [];
  const record = { id: 'proposal-a', organizationId: 'org-a', title: 'Draft' };
  const trashedItem = { id: 'trash-a' };
  const transaction = {
    proposal: {
      findUnique: async (args) => { calls.push(['find', args]); return record; },
      delete: async (args) => { calls.push(['delete', args]); return record; },
    },
    trashedItem: {
      create: async (args) => { calls.push(['ledger', args]); return trashedItem; },
    },
  };
  const scopedPrisma = {
    $transaction: async (callback) => callback(transaction),
  };

  const result = await softDelete({
    scopedPrisma,
    entity: 'PROPOSAL',
    recordId: 'proposal-a',
    organizationId: 'org-a',
  });

  assert.equal(result.trashedItem.id, 'trash-a');
  assert.deepEqual(calls.slice(0, 2), [
    ['find', { where: { id: 'proposal-a' } }],
    ['delete', { where: { id: 'proposal-a' } }],
  ]);
  assert.equal(calls[2][0], 'ledger');
  assert.equal(calls[2][1].data.entity, 'PROPOSAL');
  assert.equal(calls[2][1].data.organizationId, 'org-a');
  assert.equal(calls[2][1].data.recordId, 'proposal-a');
});

test('soft delete rejects an organization mismatch before mutation', async () => {
  let mutated = false;
  const scopedPrisma = {
    $transaction: async (callback) => callback({
      proposal: {
        findUnique: async () => ({ id: 'proposal-a', organizationId: 'org-b' }),
        delete: async () => { mutated = true; },
      },
      trashedItem: { create: async () => { mutated = true; } },
    }),
  };

  await assert.rejects(
    softDelete({ scopedPrisma, entity: 'PROPOSAL', recordId: 'proposal-a', organizationId: 'org-a' }),
    /organization mismatch/,
  );
  assert.equal(mutated, false);
});
