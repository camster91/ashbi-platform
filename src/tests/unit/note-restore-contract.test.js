import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeNote } from '../../services/note-access.service.js';
test('archive restoration requires current management rights and preserves inherited barriers',async()=>{
 const row={id:'note',authorId:'owner',projectId:'project',parentId:null,accessMode:'TEAM',accessGrants:[],audienceBarrier:{readUserIds:['owner','reader'],editUserIds:['owner']},deletedAt:new Date()};
 let current={id:'reader',organizationId:'org',role:'TEAM'};
 const prisma={user:{findFirst:async()=>current},note:{findMany:async()=>[row],findFirst:async()=>row}};
 await assert.rejects(authorizeNote(prisma,'note',current,{includeDeleted:true,manage:true}),{statusCode:403});
 current={...current,id:'owner'};const result=await authorizeNote(prisma,'note',current,{includeDeleted:true,manage:true});assert.equal(result.permissions.canManage,true);assert.deepEqual(result.note.audienceBarrier,row.audienceBarrier);
 current={...current,id:'other'};await assert.rejects(authorizeNote(prisma,'note',current,{includeDeleted:true}),{statusCode:404});
});
import { noteRestoreData } from '../../services/note-access.service.js';
test('legacy archived notes preserve deleted-ancestor restrictions when restored as roots',async()=>{
 const actor={id:'owner',role:'TEAM',organizationId:'org'};
 const parent={id:'old-parent',authorId:'owner',projectId:'project',parentId:null,accessMode:'RESTRICTED',accessGrants:[{userId:'reader',role:'READ'}],deletedAt:new Date()};
 const child={id:'child',authorId:'owner',projectId:'project',parentId:'old-parent',accessMode:'TEAM',accessGrants:[],deletedAt:new Date()};
 const rows=[parent,child];const prisma={user:{findFirst:async()=>actor},note:{findMany:async({where})=>rows.filter(row=>where.id.in.includes(row.id)),findFirst:async({where})=>rows.find(row=>row.id===where.id&&(where.deletedAt!==null||!row.deletedAt))||null}};
 assert.deepEqual(await noteRestoreData(prisma,'child',actor),{deletedAt:null,parentId:null,audienceBarrier:{readUserIds:['owner','reader'],editUserIds:['owner']}});
 rows.splice(0,1);actor.role='ADMIN';await assert.rejects(noteRestoreData(prisma,'child',actor),{statusCode:409});
});
