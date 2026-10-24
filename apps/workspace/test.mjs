import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { generateKeyPair, SignJWT } from 'jose';
import { Miniflare } from 'miniflare';
import { createWorker } from './worker.mjs';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const issuer='https://identity.cloudflareaccess.com', origin='https://workspace.example.invalid';
test('workspace with signed identity and actual local D1 storage', async t => {
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test storage")}}',d1Databases:{DB:'workspace-test'},cf:false});
 t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 }
 const env={DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'workspace',RELEASE:'test'};
 const worker=createWorker(publicKey);
 const tokens={};
 for(const [id,email,org,role,client] of [['staff','staff@example.invalid','a','staff',null],['staff2','second@example.invalid','a','staff',null],['client','client@example.invalid','a','client','c1'],['other','other@example.invalid','a','client','c2'],['foreign','foreign@example.invalid','b','staff',null]]) {
  await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,email,org,role,client).run();
  tokens[id]=await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('workspace').setSubject(id).setIssuedAt().setExpirationTime('5m').sign(privateKey);
 }
 const call=(path,actor='staff',method='GET',body,extra={})=>worker.fetch(new Request(origin+path,{method,headers:{...(actor?{'Cf-Access-Jwt-Assertion':tokens[actor]}:{}),...(body?{'Content-Type':'application/json','Origin':origin}:{}),...extra},body:body?JSON.stringify(body):undefined}),env);
 let client,project,task,note;
 await t.test('anonymous, invented identity, wrong host, cross-origin and inactive actors are denied',async()=>{
  assert.equal((await call('/api/me',null)).status,401);
  tokens.unknown=await new SignJWT({email:'unknown@example.invalid'}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('workspace').setSubject('u').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  assert.equal((await call('/api/me','unknown')).status,403);
  assert.equal((await worker.fetch(new Request('https://elsewhere.example/api/me'),env)).status,404);
  assert.equal((await call('/api/clients','staff','POST',{name:'test'},{Origin:'https://foreign.example'})).status,403);
  await DB.prepare('UPDATE actors SET active=0 WHERE id=?').bind('staff2').run();
  assert.equal((await call('/api/me','staff2')).status,403);
  await DB.prepare('UPDATE actors SET active=1 WHERE id=?').bind('staff2').run();
 });
 await t.test('staff creates clients/projects/tasks/documents without caller-controlled ownership',async()=>{
  assert.equal((await call('/api/clients','staff','POST',{name:'Fixture',organization_id:'b'})).status,400);
  const c=await call('/api/clients','staff','POST',{name:'Synthetic client'});assert.equal(c.status,201);client=await c.json();
  await DB.prepare('INSERT INTO clients(id,organization_id,name,revision) VALUES(?,?,?,0)').bind('c1','a','Own client').run();
  await DB.prepare('INSERT INTO clients(id,organization_id,name,revision) VALUES(?,?,?,0)').bind('c2','a','Other client').run();
  const p=await call('/api/projects','staff','POST',{name:'Launch',clientId:'c1',clientVisible:true});assert.equal(p.status,201);project=await p.json();
  const r=await call('/api/tasks','staff','POST',{title:'Review design',projectId:project.id,clientVisible:true});assert.equal(r.status,201);task=await r.json();
  const n=await call('/api/notes','staff','POST',{title:'Brief',text:'Synthetic brief',projectId:project.id,clientVisible:false});assert.equal(n.status,201);note=await n.json();
  assert.equal((await call('/api/projects','foreign','POST',{name:'Bad',clientId:'c1',clientVisible:true})).status,404);
 });
 await t.test('clients only see own explicitly shared projects and children; never write staff records',async()=>{
  assert.equal((await (await call('/api/projects','client')).json()).items.length,1);
  assert.equal((await (await call('/api/tasks','client')).json()).items.length,1);
  assert.equal((await (await call('/api/notes','client')).json()).items.length,0);
  for(const actor of ['other','foreign']) assert.equal((await call('/api/tasks/'+task.id,actor)).status,404);
  assert.equal((await call('/api/tasks','client','POST',{title:'No',projectId:project.id,clientVisible:true})).status,403);
  const h=await call('/api/projects','staff','PATCH',{name:'Hidden'});assert.equal(h.status,400);
  const hide=await call('/api/projects/'+project.id,'staff','PATCH',{clientVisible:false,revision:0});assert.equal(hide.status,200);
  assert.equal((await call('/api/tasks/'+task.id,'client')).status,404);
  assert.equal((await call('/api/projects/'+project.id,'staff','PATCH',{clientVisible:true,revision:1})).status,200);
 });
 await t.test('concurrent edits conflict and unknown or unvalidated fields are rejected',async()=>{
  const edits=await Promise.all(['staff','staff2'].map(actor=>call('/api/tasks/'+task.id,actor,'PATCH',{status:'done',revision:0})));
  assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
  assert.equal((await call('/api/tasks/'+task.id,'staff','PATCH',{status:'imaginary',revision:1})).status,400);
  assert.equal((await call('/api/notes/'+note.id,'staff','PATCH',{text:'x'.repeat(21000),revision:0})).status,400);
  assert.equal((await call('/api/clients','staff','POST',{name:'x'.repeat(70000)})).status,413);
 });
 await t.test('staff contact, assignment and due-date edits validate ownership and calendar dates',async()=>{
  assert.equal((await call('/api/clients/'+client.id,'staff','PATCH',{email:'contact@example.invalid',company:'Synthetic company',revision:0})).status,200);
  assert.equal((await call('/api/tasks/'+task.id,'staff','PATCH',{assigneeId:'foreign',dueOn:'2026-11-12',revision:1})).status,404);
  assert.equal((await call('/api/tasks/'+task.id,'staff','PATCH',{assigneeId:'staff2',dueOn:'2026-02-30',revision:1})).status,400);
  const edit=await call('/api/tasks/'+task.id,'staff','PATCH',{assigneeId:'staff2',dueOn:'2026-11-12',revision:1});assert.equal(edit.status,200);assert.equal((await edit.json()).assignee_id,'staff2');
  assert.equal((await call('/api/tasks/'+task.id,'staff','PATCH',{assigneeId:null,dueOn:null,revision:2})).status,200);
  assert.equal((await call('/api/staff','client')).status,403);
  assert.equal((await (await call('/api/staff')).json()).items.length,2);
 });
 await t.test('one running timer per staff, own-actor stop and exact manual seconds persist',async()=>{
  const starts=await Promise.all([1,2].map(()=>call('/api/timer/start','staff','POST',{projectId:project.id})));
  assert.deepEqual(starts.map(r=>r.status).sort(),[201,409]);
  const active=(await (await call('/api/time')).json()).items[0];
  assert.equal((await call('/api/timer/'+active.id+'/stop','staff2','POST',{})).status,404);
  assert.equal((await call('/api/timer/'+active.id+'/stop','staff','POST',{})).status,200);
  assert.equal((await call('/api/time/manual','staff','POST',{projectId:project.id,seconds:900})).status,201);
  assert.equal((await call('/api/time','client')).status,403);
  assert.equal((await call('/api/time/manual','staff','POST',{projectId:project.id,seconds:1.5})).status,400);
 });
 await t.test('active timer survives over 100 newer entries with actor/org isolation and exactly-once stop',async()=>{
  const start=await call('/api/timer/start','staff','POST',{projectId:project.id});assert.equal(start.status,201);const active=await start.json();
  await DB.prepare('UPDATE time_entries SET started_at=0 WHERE id=?').bind(active.id).run();
  await DB.batch(Array.from({length:105},(_,i)=>DB.prepare('INSERT INTO time_entries(id,organization_id,project_id,actor_id,started_at,ended_at,seconds) VALUES(?,?,?,?,?,?,?)').bind('history-'+i,'a',project.id,'staff',1000+i,61000+i,60)));
  assert.equal((await call('/api/timer/start','staff2','POST',{projectId:project.id})).status,201);
  const foreignClient=await (await call('/api/clients','foreign','POST',{name:'Foreign'})).json();
  const foreignProject=await (await call('/api/projects','foreign','POST',{name:'Foreign',clientId:foreignClient.id,clientVisible:false})).json();
  assert.equal((await call('/api/timer/start','foreign','POST',{projectId:foreignProject.id})).status,201);
  const listed=await (await call('/api/time')).json();
  assert.equal(listed.items.filter(r=>r.ended_at!==null).length,100);
  assert.equal(listed.items.filter(r=>r.ended_at===null).length,1,'active timer is independent of history bound');
  assert.equal(listed.items[0].id,active.id);
  assert.ok(listed.items.every(r=>r.actor_id==='staff'&&r.organization_id==='a'));
  assert.equal((await call('/api/timer/'+active.id+'/stop','foreign','POST',{})).status,404);
  assert.equal((await call('/api/timer/'+active.id+'/stop','staff2','POST',{})).status,404);
  const stops=await Promise.all([1,2].map(()=>call('/api/timer/'+active.id+'/stop','staff','POST',{})));
  assert.deepEqual(stops.map(r=>r.status).sort(),[200,404]);
  const stopped=await DB.prepare('SELECT * FROM time_entries WHERE id=?').bind(active.id).first();assert.ok(stopped.ended_at>0);assert.equal(stopped.seconds,Math.floor(stopped.ended_at/1000));
  assert.equal((await call('/api/timer/'+active.id+'/stop','staff','POST',{})).status,404);
  assert.deepEqual(await DB.prepare('SELECT * FROM time_entries WHERE id=?').bind(active.id).first(),stopped);
  const restarts=await Promise.all([1,2].map(()=>call('/api/timer/start','staff','POST',{projectId:project.id})));
  assert.deepEqual(restarts.map(r=>r.status).sort(),[201,409]);
  const current=(await (await call('/api/time')).json()).items.find(r=>r.ended_at===null);
  assert.ok(current);assert.notEqual(current.id,active.id);
  assert.equal((await call('/api/time','client')).status,403);
 });
 await t.test('lists are bounded and have continuation, output is private, export never exposes identities',async()=>{
  for(let i=0;i<55;i++) await DB.prepare('INSERT INTO clients(id,organization_id,name,revision) VALUES(?,?,?,0)').bind('page-'+String(i).padStart(3,'0'),'a','Page fixture').run();
  const r=await call('/api/clients');const first=await r.json();assert.equal(first.items.length,50);assert.ok(first.nextCursor);
  assert.equal(r.headers.get('cache-control'),'no-store');
  const next=await (await call('/api/clients?after='+first.nextCursor)).json();assert.ok(next.items.length>0);
  assert.equal(new Set([...first.items,...next.items].map(v=>v.id)).size,58);
  const ex=await call('/api/export');assert.equal(ex.status,200);const data=await ex.json();
  assert.equal(data.version,1);assert.ok(data.tables.clients.length>=58);assert.equal(data.tables.actors,undefined);
  assert.equal((await call('/api/export','client')).status,403);
 });
});

test('task comments persist with author identity, client scope and retry safety in actual D1',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("comments fixture")}}',d1Databases:{DB:'comments'},cf:false});t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')&&n<'0004.sql').sort()){
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 }
 const tokens={};
 for(const [id,org,role,client]of [['staff','a','staff',null],['staff2','a','staff',null],['client','a','client','c'],['other','a','client','d'],['foreign','b','staff',null]]){
  const email=id+'@example.invalid';await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,email,org,role,client).run();
  tokens[id]=await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('comments').setSubject(id).setIssuedAt().setExpirationTime('10m').sign(privateKey);
 }
 await DB.batch([
  DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('c','a','Own client')"),
  DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('p','a','c','Shared project',1)"),
  DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,client_visible) VALUES('t','a','p','Shared task',1)"),
  DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,client_visible) VALUES('internal','a','p','Internal task',0)"),
 ]);
 const originalTasks=(await DB.prepare('SELECT * FROM tasks ORDER BY id').all()).results;
 const migration=await readFile(new URL('./migrations/0004.sql',import.meta.url),'utf8');
 await DB.batch(migration.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 await t.test('additive comment migration preserves existing populated tasks and actors',async()=>{
  assert.deepEqual((await DB.prepare('SELECT * FROM tasks ORDER BY id').all()).results,originalTasks);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM actors').first()).n,5);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
 });
 const worker=createWorker(publicKey),env={DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'comments'};
 const path='/api/tasks/t/comments';
 const call=(url=path,actor='staff',method='GET',body,bindings=env,headers={})=>worker.fetch(new Request(origin+url,{method,headers:{...(actor?{'Cf-Access-Jwt-Assertion':tokens[actor]}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{}),...headers},body:body?JSON.stringify(body):undefined}),bindings);
 const post=(content,extra={})=>({content,requestId:crypto.randomUUID(),...extra});let shared;
 await t.test('both staff can comment; client replies are shared and server-owned authors persist',async()=>{
  const internal=await call(path,'staff','POST',post('Internal discussion'));assert.equal(internal.status,201);const a=await internal.json();assert.equal(a.actor_id,'staff');assert.equal(a.client_visible,0);
  const visible=await call(path,'staff2','POST',post('Client checkpoint',{clientVisible:true}));assert.equal(visible.status,201);shared=await visible.json();assert.equal(shared.actor_id,'staff2');
  const reply=await call(path,'client','POST',post('<script>literal plain text</script>'));assert.equal(reply.status,201);const c=await reply.json();assert.equal(c.actor_id,'client');assert.equal(c.client_visible,1);assert.equal(c.content,'<script>literal plain text</script>');
  const staff=await call();assert.equal(staff.headers.get('cache-control'),'no-store');assert.equal((await staff.json()).items.length,3);
  const client=await (await call(path,'client')).json();assert.equal(client.items.length,2);assert.ok(client.items.every(c=>c.client_visible===1));assert.ok(client.items.every(c=>!('request_id'in c)&&!('organization_id'in c)));
 });
 await t.test('task, project, client and organization visibility gates both reads and writes',async()=>{
  for(const actor of ['other','foreign']){assert.equal((await call(path,actor)).status,404);assert.equal((await call(path,actor,'POST',post('Denied'))).status,404);}
  assert.equal((await call('/api/tasks/internal/comments','client')).status,404);
  assert.equal((await call(path,'client','POST',post('Cannot be internal',{clientVisible:false}))).status,403);
  for(const [table,column,id]of [['tasks','client_visible','t'],['projects','client_visible','p']]){
   await DB.prepare(`UPDATE ${table} SET ${column}=0 WHERE id=?`).bind(id).run();
   assert.equal((await call(path,'client')).status,404);assert.equal((await call(path,'client','POST',post('Hidden parent'))).status,404);
   assert.equal((await call()).status,200);await DB.prepare(`UPDATE ${table} SET ${column}=1 WHERE id=?`).bind(id).run();
  }
  assert.equal((await call(path,null)).status,401);
 });
 await t.test('concurrent retries create one comment; changed payloads conflict and keys belong to their author',async()=>{
  const input=post('Exactly once',{clientVisible:true});const attempts=await Promise.all([1,2].map(()=>call(path,'staff','POST',input)));
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,201]);const rows=await Promise.all(attempts.map(r=>r.json()));assert.equal(rows[0].id,rows[1].id);
  const replay=await call(path,'staff','POST',{...input,requestId:input.requestId.toUpperCase()});assert.equal(replay.status,200);assert.equal((await replay.json()).id,rows[0].id);
  assert.equal((await call(path,'staff','POST',{...input,content:'Different'})).status,409);
  assert.equal((await call(path,'staff','POST',{...input,clientVisible:false})).status,409);
  assert.equal((await call('/api/tasks/internal/comments','staff','POST',input)).status,409);
  assert.equal((await call(path,'staff2','POST',input)).status,201);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM task_comments WHERE actor_id=? AND request_id=?').bind('staff',input.requestId).first()).n,1);
  const clientInput=post('Client retry');assert.equal((await call(path,'client','POST',clientInput)).status,201);
  await DB.prepare("UPDATE tasks SET client_visible=0 WHERE id='t'").run();assert.equal((await call(path,'client','POST',clientInput)).status,404);await DB.prepare("UPDATE tasks SET client_visible=1 WHERE id='t'").run();
 });
 await t.test('parent visibility is rechecked atomically at insert after a client loses access',async()=>{
  const guarded={...env,DB:{prepare(sql){const statement=DB.prepare(sql);if(!sql.startsWith('INSERT INTO task_comments'))return statement;
   return {bind(...values){const bound=statement.bind(...values);return {async first(){await DB.prepare("UPDATE tasks SET client_visible=0 WHERE id='t'").run();return bound.first();}};}};
  }}};
  const before=(await DB.prepare('SELECT COUNT(*) AS n FROM task_comments').first()).n;
  assert.equal((await call(path,'client','POST',post('Must not insert'),guarded)).status,404);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM task_comments').first()).n,before);
  await DB.prepare("UPDATE tasks SET client_visible=1 WHERE id='t'").run();
 });
 await t.test('pagination is stable for tied timestamps and filters internal comments before bounding',async()=>{
  await DB.batch(Array.from({length:65},(_,i)=>DB.prepare('INSERT INTO task_comments(id,organization_id,task_id,actor_id,request_id,content,client_visible,created_at) VALUES(?,?,?,?,?,?,?,?)').bind('page-'+String(i).padStart(3,'0'),'a','t','staff',crypto.randomUUID(),'Page '+i,i<55?1:0,1)));
  for(const actor of ['staff','client']){
   let items=[],after='';for(let i=0;i<3;i++){const r=await (await call(path+(after?'?after='+encodeURIComponent(after):''),actor)).json();assert.ok(r.items.length<=50);items.push(...r.items);after=r.nextCursor;if(!after)break;}
   assert.equal(after,null);assert.equal(new Set(items.map(r=>r.id)).size,items.length);
   assert.equal(items.filter(r=>r.id.startsWith('page-')).length,actor==='staff'?65:55);
   if(actor==='client')assert.ok(items.every(r=>r.client_visible===1));
   assert.deepEqual(items.map(r=>r.id),[...items].sort((a,b)=>b.created_at-a.created_at||b.id.localeCompare(a.id)).map(r=>r.id));
  }
  for(const after of ['',"'",'9999999999999999:x','1:x:y'])assert.equal((await call(path+'?after='+encodeURIComponent(after))).status,400);
  assert.equal((await call(path+'?includeInternal=true','client')).status,400);
 });
 await t.test('strict input/method/origin/actor validation and relational boundaries do not mutate comments',async()=>{
  const before=(await DB.prepare('SELECT COUNT(*) AS n FROM task_comments').first()).n;
  for(const body of [post(' '),post('x'.repeat(10001)),post('x',{actorId:'foreign'}),post('x',{organizationId:'b'}),post('x',{taskId:'internal'}),post('x',{requestId:'invalid'}),post('x',{clientVisible:'true'})])assert.equal((await call(path,'staff','POST',body)).status,400);
  assert.equal((await call(path,'staff','DELETE',{})).status,405);
  assert.equal((await call(path,'staff','POST',post('cross-origin'),env,{Origin:'https://elsewhere.invalid'})).status,403);
  await DB.prepare("UPDATE actors SET active=0 WHERE id='staff2'").run();assert.equal((await call(path,'staff2','POST',post('inactive'))).status,403);await DB.prepare("UPDATE actors SET active=1 WHERE id='staff2'").run();
  await assert.rejects(()=>DB.prepare('INSERT INTO task_comments(id,organization_id,task_id,actor_id,request_id,content,created_at) VALUES(?,?,?,?,?,?,?)').bind('bad-org','b','t','foreign',crypto.randomUUID(),'No',0).run());
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM task_comments').first()).n,before);
  assert.equal((await DB.prepare('SELECT content FROM task_comments WHERE id=?').bind(shared.id).first()).content,shared.content);
 });
 await t.test('bounded staff record export includes comment content and author references',async()=>{
  const response=await call('/api/export');assert.equal(response.status,200);const data=await response.json();assert.ok(data.tables.task_comments.length>=65);assert.ok(data.tables.task_comments.some(r=>r.id===shared.id));assert.equal(data.tables.actors,undefined);
  assert.equal((await call('/api/export','client')).status,403);
 });
});
