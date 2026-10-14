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


function restorationFixture() {
 const state=harness({ledgerData:{parentId:'old-parent',projectId:'project-a'}}),actor={id:'owner',role:'TEAM',organizationId:'org-a'};
 const row={id:state.ledger.recordId,projectId:'project-a',authorId:'owner',parentId:null,accessMode:'TEAM',accessGrants:[],audienceBarrier:{readUserIds:['owner'],editUserIds:['owner']},deletedAt:new Date()};
 const transaction={user:{findFirst:async()=>actor},trashedItem:{findFirst:async()=>state.ledger,update:async args=>{state.calls.push(['restore-ledger',args]);return args;}},note:{findMany:async()=>[row],findFirst:async()=>row,update:async args=>{state.calls.push(['restore-original',args]);return args;}}};
 state.rawPrisma.$transaction=async(callback,options)=>{state.calls.push(['transaction',options]);return callback(transaction);};return {...state,actor,row};
}
test('restore proves tenant ledger ownership and atomically restores the protected archived row',async()=>{
 const state=restorationFixture();const result=await restoreTrashedItem({...state,trashId:state.ledger.id});assert.deepEqual(result,{restoredId:state.ledger.recordId,entity:'NOTE'});
 assert.deepEqual(state.calls.find(([name])=>name==='transaction')[1],{isolationLevel:'Serializable'});
 assert.deepEqual(state.calls.find(([name])=>name==='restore-original')[1],{where:{id:state.row.id},data:{deletedAt:null,parentId:null}});
 assert.equal(state.calls.find(([name])=>name==='restore-ledger')[1].where.id,state.ledger.id);
});
test('restore cannot revive the old parent or discard an inherited restriction from recovery metadata',async()=>{
 const state=restorationFixture();await restoreTrashedItem({...state,trashId:state.ledger.id});const update=state.calls.find(([name])=>name==='restore-original')[1];assert.equal(update.data.parentId,null);assert.equal('audienceBarrier' in update.data,false);
 state.actor.id='outsider';await assert.rejects(restoreTrashedItem({...state,trashId:state.ledger.id}),{statusCode:404});
});
