import test from 'node:test';
import assert from 'node:assert/strict';
import { permanentlyDeleteTrashedItem } from '../../services/trash-purge.service.js';

function harness({ entity = 'NOTE', original = { id: 'note-a', deletedAt: new Date() }, deleteError } = {}) {
  const calls = [];
  const ledger = {
    id: 'trash-a',
    entity,
    recordId: 'note-a',
    organizationId: 'org-a',
    restoredAt: null,
  };
  const scopedPrisma = {
    trashedItem: {
      findFirst: async (args) => {
        calls.push(['scoped-ledger', args]);
        return ledger;
      },
    },
  };
  const transaction = {
    trashedItem: {
      findFirst: async (args) => {
        calls.push(['locked-ledger', args]);
        return ledger;
      },
      delete: async (args) => {
        calls.push(['delete-ledger', args]);
        return ledger;
      },
    },
    note: {
      findFirst: async (args) => {
        calls.push(['find-original', args]);
        return original;
      },
      delete: async (args) => {
        calls.push(['hard-delete', args]);
        if (deleteError) throw deleteError;
        return original;
      },
    },
  };
  const rawPrisma = {
    $transaction: async (callback, options) => {
      calls.push(['transaction', options]);
      return callback(transaction);
    },
  };
  return { scopedPrisma, rawPrisma, calls, ledger };
}

test('permanent purge proves tenant ledger ownership and hard-deletes one deleted original atomically', async () => {
  const { scopedPrisma, rawPrisma, calls } = harness();

  const result = await permanentlyDeleteTrashedItem({ scopedPrisma, rawPrisma, trashId: 'trash-a' });

  assert.deepEqual(result, { deleted: true, recordId: 'note-a', entity: 'NOTE' });
  assert.deepEqual(calls, [
    ['scoped-ledger', { where: { id: 'trash-a', restoredAt: null } }],
    ['transaction', { isolationLevel: 'Serializable' }],
    ['locked-ledger', { where: { id: 'trash-a', organizationId: 'org-a', restoredAt: null } }],
    ['find-original', { where: { id: 'note-a', deletedAt: { not: null } }, select: { id: true } }],
    ['hard-delete', { where: { id: 'note-a' } }],
    ['delete-ledger', { where: { id: 'trash-a' } }],
  ]);
});

test('permanent purge never deletes a record that was already restored', async () => {
  const { scopedPrisma, rawPrisma, calls } = harness({ original: null });

  const result = await permanentlyDeleteTrashedItem({ scopedPrisma, rawPrisma, trashId: 'trash-a' });

  assert.deepEqual(result, { deleted: false, recordId: 'note-a', entity: 'NOTE' });
  assert.equal(calls.some(([name]) => name === 'hard-delete'), false);
  assert.equal(calls.some(([name]) => name === 'delete-ledger'), true);
});

test('unknown entity and hard-delete failure retain the recovery ledger', async () => {
  const unknown = harness({ entity: 'UNKNOWN' });
  await assert.rejects(
    permanentlyDeleteTrashedItem({ scopedPrisma: unknown.scopedPrisma, rawPrisma: unknown.rawPrisma, trashId: 'trash-a' }),
    /Unknown trash entity/,
  );
  assert.equal(unknown.calls.some(([name]) => name === 'delete-ledger'), false);

  const failed = harness({ deleteError: new Error('database refused delete') });
  await assert.rejects(
    permanentlyDeleteTrashedItem({ scopedPrisma: failed.scopedPrisma, rawPrisma: failed.rawPrisma, trashId: 'trash-a' }),
    /database refused delete/,
  );
  assert.equal(failed.calls.some(([name]) => name === 'delete-ledger'), false);
});
