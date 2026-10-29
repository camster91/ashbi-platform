import test from 'node:test';
import assert from 'node:assert/strict';
import {hubAuthFixture} from './hub-auth-fixture.mjs';
const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');
test('notification reads stay personal, scoped and exact across retries and new arrivals',async t=>{
 const f=await hubAuthFixture(createWorker);t.after(()=>f.close());f.login();
 await f.DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('p','qa','own','Shared',1),('other','qa','other','Other',1)").run();
 const staff={id:'hub-staff',email:'staff@example.invalid',organizationId:'hub-org',role:'ADMIN'},client={id:'hub-client',email:'client@example.invalid',organizationId:'hub-org',role:'CLIENT'};
 const as=user=>f.sessions.set(f.cookie,user);
 const call=(path,body)=>f.call('/api/'+path,{method:body?'POST':'GET',body,cookie:f.cookie});
 const add=async(id,project='p',actor='native-staff')=>f.DB.prepare('INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,'qa',project,actor,crypto.randomUUID(),'Literal <b>notification</b> '+id,1).run();
 const count=async()=> (await (await call('notifications/summary')).json()).unreadCount;
 const mark=ids=>call('notifications/read',{messageIds:ids});
 await add('one');await add('foreign','other');await add('own','p','native-client');
 await t.test('own posts do not notify; client sees only authorized project messages',async()=>{
  assert.equal(await count(),1);as(client);assert.equal(await count(),1);const list=await (await call('notifications')).json();assert.deepEqual(list.items.map(r=>r.id),['one']);assert.equal(list.items[0].project_name,'Shared');
  const conversation=await (await call('projects/p/messages')).json();assert.equal(conversation.items.find(r=>r.id==='one').unread,1);assert.equal(conversation.items.find(r=>r.id==='own').unread,0);
 });
 await t.test('marking exact IDs is idempotent, excludes unavailable IDs and leaves later arrivals unread',async()=>{
  await add('two');assert.equal((await mark(['one','foreign','missing','own'])).status,200);assert.equal((await mark(['one'])).status,200);assert.equal(await count(),1);
  const reads=await f.DB.prepare('SELECT * FROM project_message_reads').all();assert.deepEqual(reads.results.map(r=>r.message_id),['one']);assert.equal(reads.results[0].actor_id,'native-client');
  as(staff);assert.equal(await count(),1);assert.equal((await mark(['own'])).status,200);assert.equal(await count(),0);as(client);assert.equal(await count(),1);
 });
 await t.test('permission revocation hides counts/previews and prevents writes at the atomic boundary',async()=>{
  await f.DB.prepare("UPDATE projects SET client_visible=0 WHERE id='p'").run();assert.equal(await count(),0);assert.deepEqual((await (await call('notifications')).json()).items,[]);assert.equal((await mark(['two'])).status,200);assert.equal(await f.DB.prepare("SELECT * FROM project_message_reads WHERE message_id='two'").first(),null);
  await f.DB.prepare("UPDATE projects SET client_visible=1 WHERE id='p'").run();const original=f.env.DB;f.env.DB={prepare(sql){if(sql.startsWith('INSERT INTO project_message_reads'))return {bind(...args){return {async run(){await original.prepare("UPDATE projects SET client_visible=0 WHERE id='p'").run();return original.prepare(sql).bind(...args).run();}};}};return original.prepare(sql);}};
  try{assert.equal((await mark(['two'])).status,200);assert.equal(await original.prepare("SELECT * FROM project_message_reads WHERE message_id='two'").first(),null);}finally{f.env.DB=original;await original.prepare("UPDATE projects SET client_visible=1 WHERE id='p'").run();}
 });
 await t.test('pagination is stable and invalid input never widens the operation',async()=>{
  for(let i=0;i<55;i++)await add('page-'+String(i).padStart(3,'0'));
  const first=await (await call('notifications')).json(),next=await (await call('notifications?after='+first.nextCursor)).json();assert.equal(first.items.length,50);assert.equal(next.items.length,6);assert.equal(new Set([...first.items,...next.items].map(r=>r.id)).size,56);
  for(const ids of [[],['one','one'],['bad id'],Array.from({length:51},(_,i)=>'x'+i)])assert.equal((await mark(ids)).status,400);
  assert.equal((await call('notifications/read',{messageIds:['two'],actorId:'native-staff'})).status,400);assert.equal((await call('notifications?after=1:a&after=1:b')).status,400);assert.equal((await call('notifications/summary?after=1:a')).status,400);
  await f.DB.prepare("UPDATE actors SET active=0 WHERE id='native-client'").run();assert.equal((await call('notifications')).status,403);await f.DB.prepare("UPDATE actors SET active=1 WHERE id='native-client'").run();
 });
});
