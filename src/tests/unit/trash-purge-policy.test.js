import test from 'node:test';
import assert from 'node:assert/strict';
import { permanentlyDeleteTrashedItem, restoreTrashedItem } from '../../services/trash-purge.service.js';

function harness({ entity = 'NOTE', original = { id: 'note-a', deletedAt: new Date() }, deleteError, ledgerData } = {}) {
  const calls = [];
  const ledger = {
    id: 'trash-a',
    entity,
    recordId: 'note-a',
    organizationId: 'org-a',
    restoredAt: null,
    data: ledgerData,
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

test('restore proves tenant ledger ownership and restores the hidden row atomically through raw Prisma', async () => {
  const { scopedPrisma, rawPrisma, calls, ledger } = harness();
  const transaction = {
    trashedItem: {
      findFirst: async (args) => { calls.push(['locked-ledger', args]); return ledger; },
      update: async (args) => { calls.push(['restore-ledger', args]); return { ...ledger, restoredAt: args.data.restoredAt }; },
    },
    note: {
      findFirst: async (args) => { calls.push(['find-original', args]); return { id: ledger.recordId }; },
      update: async (args) => { calls.push(['restore-original', args]); return { id: ledger.recordId, deletedAt: null }; },
    },
  };
  rawPrisma.$transaction = async (callback, options) => {
    calls.push(['transaction', options]);
    return callback(transaction);
  };

  const result = await restoreTrashedItem({ scopedPrisma, rawPrisma, trashId: ledger.id });

  assert.deepEqual(result, { restoredId: ledger.recordId, entity: 'NOTE' });
  assert.deepEqual(calls.map(([name]) => name), [
    'scoped-ledger', 'transaction', 'locked-ledger', 'find-original', 'restore-original', 'restore-ledger',
  ]);
  assert.deepEqual(calls[4][1], { where: { id: ledger.recordId }, data: { deletedAt: null, parentId: null } });
  assert.equal(calls[5][1].where.id, ledger.id);
  assert.ok(calls[5][1].data.restoredAt instanceof Date);
});

test('restoring a note retains only an active parent from its original project', async () => {
  const { scopedPrisma, rawPrisma, calls, ledger } = harness({ ledgerData: { parentId: 'parent-a', projectId: 'project-a' } });
  let findCount = 0;
  const transaction = {
    trashedItem: {
      findFirst: async () => ledger,
      update: async args => args,
    },
    note: {
      findFirst: async args => {
        findCount += 1;
        calls.push([findCount === 1 ? 'find-original' : 'find-parent', args]);
        return findCount === 1 ? { id: ledger.recordId } : { id: 'parent-a' };
      },
      update: async args => { calls.push(['restore-original', args]); return args; },
    },
  };
  rawPrisma.$transaction = async callback => callback(transaction);
  await restoreTrashedItem({ scopedPrisma, rawPrisma, trashId: ledger.id });
  const restore = calls.find(([name]) => name === 'restore-original')[1];
  assert.deepEqual(restore.data, { deletedAt: null, parentId: 'parent-a' });
  assert.deepEqual(calls.find(([name]) => name === 'find-parent')[1].where, {
    id: 'parent-a', projectId: 'project-a', deletedAt: null,
  });
});
