import test from 'node:test';
import assert from 'node:assert/strict';
import {hubAuthFixture} from './hub-auth-fixture.mjs';
const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');
test('project conversations preserve scope, retry identity, pagination and current permissions',async t=>{
 const f=await hubAuthFixture(createWorker);t.after(()=>f.close());f.login();
 await f.DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('conversation','qa','own','Conversation',1),('other-project','qa','other','Other',1)").run();
 const staff={id:'hub-staff',email:'staff@example.invalid',organizationId:'hub-org',role:'ADMIN'},client={id:'hub-client',email:'client@example.invalid',organizationId:'hub-org',role:'CLIENT'};
 const as=user=>f.sessions.set(f.cookie,user);
 const call=(method='GET',body,path='conversation/messages')=>f.call('/api/projects/'+path,{method,body,cookie:f.cookie,headers:{Origin:f.env.APP_ORIGIN}});
 const requestId=crypto.randomUUID(),body={content:'Literal <script>alert(1)</script> message',requestId};
 await t.test('staff and own client read the same durable message; concurrent retry creates once',async()=>{
  const results=await Promise.all([call('POST',body),call('POST',body)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);const rows=await f.DB.prepare('SELECT * FROM project_messages').all();assert.equal(rows.results.length,1);assert.equal(rows.results[0].actor_id,'native-staff');
  assert.equal((await call('POST',{...body,content:'Changed'})).status,409);as(client);assert.equal((await (await call()).json()).items[0].content,body.content);
  assert.equal((await call('POST',{content:'Client reply',requestId:crypto.randomUUID()})).status,201);as(staff);assert.equal((await (await call()).json()).items.length,2);assert.equal((await (await f.call('/api/export',{cookie:f.cookie})).json()).tables.project_messages.length,2);
 });
 await t.test('foreign client, hidden project, archived project and revoked actor fail closed',async()=>{
  as(client);assert.equal((await call('GET',undefined,'other-project/messages')).status,404);
  await f.DB.prepare("UPDATE projects SET client_visible=0 WHERE id='conversation'").run();assert.equal((await call()).status,404);assert.equal((await call('POST',{content:'hidden',requestId:crypto.randomUUID()})).status,404);
  await f.DB.prepare("UPDATE projects SET client_visible=1,archived=1 WHERE id='conversation'").run();assert.equal((await call()).status,200);assert.equal((await call('POST',{content:'archived',requestId:crypto.randomUUID()})).status,409);as(staff);assert.equal((await call('POST',body)).status,200);
  await f.DB.prepare("UPDATE projects SET archived=0 WHERE id='conversation'").run();as(client);await f.DB.prepare("UPDATE actors SET active=0 WHERE id='native-client'").run();assert.equal((await call()).status,403);await f.DB.prepare("UPDATE actors SET active=1 WHERE id='native-client'").run();as(staff);
 });
 await t.test('permission revoked after body read cannot publish a message',async()=>{
  as(client);const original=f.env.DB;let revoked=false;
  f.env.DB={prepare(sql){if(sql.startsWith('INSERT INTO project_messages'))return {bind(...args){return {async first(){await original.prepare("UPDATE projects SET client_visible=0 WHERE id='conversation'").run();revoked=true;return original.prepare(sql).bind(...args).first();}};}};return original.prepare(sql);}};
  try{assert.equal((await call('POST',{content:'must not publish',requestId:crypto.randomUUID()})).status,404);assert.equal(revoked,true);assert.equal(await original.prepare("SELECT id FROM project_messages WHERE content='must not publish'").first(),null);}finally{f.env.DB=original;await original.prepare("UPDATE projects SET client_visible=1 WHERE id='conversation'").run();as(staff);}
 });
 await t.test('stable paging and strict input handling keep original history',async()=>{
  for(let i=0;i<55;i++)await f.DB.prepare("INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at) VALUES(?,'qa','conversation','native-staff',?,'Page item',1)").bind('page-'+String(i).padStart(3,'0'),crypto.randomUUID()).run();
  const first=await (await call()).json(),second=await (await call('GET',undefined,'conversation/messages?after='+first.nextCursor)).json();assert.equal(first.items.length,50);assert.equal(second.items.length,7);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,57);assert.equal(second.nextCursor,null);
  for(const invalid of [{content:'',requestId},{content:'x',requestId:'invalid'},{content:'x'.repeat(10001),requestId},{...body,actorId:'native-client'}])assert.equal((await call('POST',invalid)).status,400);
  assert.equal((await call('GET',undefined,'conversation/messages?after=1:a&after=1:b')).status,400);assert.equal((await call('DELETE')).status,405);
 });
});
