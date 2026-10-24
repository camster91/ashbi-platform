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

test('document tree, archive and literal search preserve scope and atomic history in actual D1',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("tree fixture")}}',d1Databases:{DB:'tree'},cf:false});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')&&n<'0006.sql').sort()){
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 }
 const tokens={};for(const [id,org,role,client]of [['staff','a','staff',null],['second','a','staff',null],['client','a','client','c'],['other','a','client','d'],['foreign','b','staff',null]]){
  const email=id+'@example.invalid';await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,email,org,role,client).run();tokens[id]=await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('tree').setSubject(id).setIssuedAt().setExpirationTime('10m').sign(privateKey);
 }
 await DB.batch([
  DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('c','a','Own client'),('d','a','Other client'),('foreign-c','b','Foreign client')"),
  DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('p','a','c','Project',1),('q','a','c','Second project',1),('foreign-p','b','foreign-c','Foreign project',1)"),
  DB.prepare("INSERT INTO notes(id,organization_id,project_id,title,text,revision,client_visible) VALUES('legacy-tree','a','p','Existing flat document','Existing bytes',2,0)"),
  DB.prepare("INSERT INTO note_versions(id,note_id,organization_id,project_id,revision,title,text,client_visible) VALUES('legacy-tree-version','legacy-tree','a','p',2,'Existing flat document','Existing bytes',0)"),
 ]);
 const original=await DB.prepare("SELECT * FROM notes WHERE id='legacy-tree'").first();
 const sql=await readFile(new URL('./migrations/0006.sql',import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 const worker=createWorker(publicKey),env={DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'tree'};
 const call=(path,actor='staff',method='GET',body)=>worker.fetch(new Request(origin+path,{method,headers:{...(actor?{'Cf-Access-Jwt-Assertion':tokens[actor]}:{}),...(body?{'Content-Type':'application/json',Origin:origin}: {})},body:body?JSON.stringify(body):undefined}),env);
 const create=async(title,parentId=null,projectId='p',actor='staff')=>{const r=await call('/api/notes',actor,'POST',{title,text:title+' content',projectId,clientVisible:true,parentId});assert.equal(r.status,201);return r.json();};
 const current=id=>DB.prepare('SELECT * FROM notes WHERE id=?').bind(id).first();
 const patch=async(id,changes)=>call('/api/notes/'+id,'staff','PATCH',{...changes,revision:(await current(id)).revision});
 let root,child,grand,otherRoot,cross,foreign;
 await t.test('additive upgrade retains flat documents and versions as active roots',async()=>{
  assert.deepEqual(await current('legacy-tree'),original);const position=await DB.prepare("SELECT * FROM note_positions WHERE id='legacy-tree'").first();assert.equal(position.parent_id,null);assert.equal(position.archived,0);
  const version=await DB.prepare("SELECT * FROM note_versions WHERE id='legacy-tree-version'").first();assert.equal(version.text,'Existing bytes');assert.equal(version.parent_id,null);assert.equal(version.archived,0);assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
 });
 await t.test('client reads and search require every ancestor and project to be shared and active',async()=>{
  root=await create('Root internal');await patch(root.id,{clientVisible:false});child=await create('Child visible token',root.id);grand=await create('Grandchild visible token',child.id);otherRoot=await create('Other root');cross=await create('Cross-project',null,'q');foreign=await create('Foreign root',null,'foreign-p','foreign');
  assert.equal(child.parent_id,root.id);assert.equal(child.archived,0);assert.equal((await call('/api/notes/'+grand.id,'client')).status,404);assert.equal((await (await call('/api/notes?q=visible%20token','client')).json()).items.length,0);
  assert.equal((await patch(root.id,{clientVisible:true})).status,200);assert.equal((await call('/api/notes/'+grand.id,'client')).status,200);
  await patch(child.id,{clientVisible:false});assert.equal((await call('/api/notes/'+grand.id,'client')).status,404);await patch(child.id,{clientVisible:true});
  await DB.prepare("UPDATE projects SET client_visible=0 WHERE id='p'").run();assert.equal((await call('/api/notes/'+grand.id,'client')).status,404);await DB.prepare("UPDATE projects SET client_visible=1 WHERE id='p'").run();
  assert.equal((await call('/api/notes/'+grand.id,'other')).status,404);assert.equal((await call('/api/notes/'+grand.id,'foreign')).status,404);
 });
 await t.test('invalid, cyclic, foreign and cross-project parents cannot mutate placement or history',async()=>{
  const before=await current(root.id),versions=(await DB.prepare('SELECT COUNT(*) AS n FROM note_versions').first()).n;
  assert.equal((await patch(root.id,{parentId:root.id})).status,400);assert.equal((await patch(root.id,{parentId:grand.id})).status,400);
  for(const parentId of [foreign.id,cross.id,'missing-parent'])assert.equal((await patch(root.id,{parentId})).status,404);
  assert.equal((await patch(root.id,{parentId:42})).status,400);assert.equal((await patch(root.id,{archived:'true'})).status,400);
  await assert.rejects(()=>DB.prepare('UPDATE note_positions SET parent_id=? WHERE id=?').bind(cross.id,child.id).run());
  assert.deepEqual(await current(root.id),before);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM note_versions').first()).n,versions);
 });
 await t.test('simultaneous opposite moves have one winner and cannot create a cycle',async()=>{
  const a=await current(root.id),b=await current(otherRoot.id);
  const moves=await Promise.all([call('/api/notes/'+root.id,'staff','PATCH',{parentId:otherRoot.id,revision:a.revision}),call('/api/notes/'+otherRoot.id,'second','PATCH',{parentId:root.id,revision:b.revision})]);assert.equal(moves.filter(r=>r.status===200).length,1);assert.ok(moves.every(r=>[200,400,409].includes(r.status)));
  const positions=(await DB.prepare("SELECT * FROM note_positions WHERE organization_id='a'").all()).results,map=new Map(positions.map(p=>[p.id,p.parent_id]));for(const p of positions){const seen=new Set();let id=p.id;while(id){assert.ok(!seen.has(id),'tree has no cycle');seen.add(id);id=map.get(id);}}
  const winner=moves[0].status===200?root.id:otherRoot.id,position=await DB.prepare('SELECT parent_id FROM note_positions WHERE id=?').bind(winner).first(),version=await DB.prepare('SELECT parent_id,actor_id FROM note_versions WHERE note_id=? ORDER BY revision DESC LIMIT 1').bind(winner).first();assert.equal(version.parent_id,position.parent_id);assert.equal(version.actor_id,moves[0].status===200?'staff':'second');
 });
 await t.test('archive hides descendants without rewriting their own archive flags; restoring a parent preserves child choices',async()=>{
  await patch(child.id,{archived:true});const childRevision=(await current(child.id)).revision;await patch(root.id,{archived:true});
  for(const id of [root.id,child.id,grand.id]){assert.equal((await call('/api/notes/'+id)).status,404);assert.equal((await call('/api/notes/'+id+'?includeArchived=true')).status,200);assert.equal((await call('/api/notes/'+id,'client')).status,404);}
  assert.equal((await current(child.id)).revision,childRevision);assert.equal((await call('/api/notes?includeArchived=true','client')).status,403);
  await patch(root.id,{archived:false});assert.equal((await call('/api/notes/'+child.id)).status,404);await patch(child.id,{archived:false});assert.equal((await call('/api/notes/'+grand.id,'client')).status,200);
 });
 await t.test('restoring content retains current location and archive state instead of restoring old placement',async()=>{
  assert.equal((await patch(child.id,{parentId:null,archived:true})).status,200);const now=await current(child.id);
  const restored=await call('/api/notes/'+child.id+'/versions/0/restore','staff','POST',{revision:now.revision,clientVisible:true});assert.equal(restored.status,200);const row=await restored.json();assert.equal(row.parent_id,null);assert.equal(row.archived,1);assert.equal((await call('/api/notes/'+child.id,'client')).status,404);
  const version=await DB.prepare('SELECT * FROM note_versions WHERE note_id=? AND revision=?').bind(child.id,row.revision).first();assert.equal(version.parent_id,null);assert.equal(version.archived,1);assert.equal(version.source_revision,0);await patch(child.id,{archived:false,parentId:root.id});
 });
 await t.test('placement or snapshot failure rolls back content, geometry and new documents together',async()=>{
  for(const table of ['note_positions','note_versions']){
   const before=await current(child.id),position=await DB.prepare('SELECT * FROM note_positions WHERE id=?').bind(child.id).first(),count=(await DB.prepare('SELECT COUNT(*) AS n FROM note_versions').first()).n;
   await DB.prepare(`CREATE TRIGGER reject_tree BEFORE ${table==='note_positions'?'UPDATE':'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'fixture'); END`).run();
   try{assert.equal((await patch(child.id,{parentId:otherRoot.id,text:'Must roll back'})).status,500);if(table==='note_versions')assert.equal((await call('/api/notes','staff','POST',{title:'Orphan forbidden',text:'No partial creation',projectId:'p',parentId:root.id,clientVisible:false})).status,500);}
   finally{await DB.prepare('DROP TRIGGER reject_tree').run();}
   assert.deepEqual(await current(child.id),before);assert.deepEqual(await DB.prepare('SELECT * FROM note_positions WHERE id=?').bind(child.id).first(),position);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM note_versions').first()).n,count);assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM notes WHERE title='Orphan forbidden'").first()).n,0);
  }
 });
 await t.test('literal search, parent/project filters and pagination apply scope before the 50-row bound',async()=>{
  const statements=[];for(let i=0;i<65;i++){const id='search-'+String(i).padStart(3,'0'),token=crypto.randomUUID(),visible=i<10?0:1;statements.push(DB.prepare('INSERT INTO notes(id,organization_id,project_id,title,text,client_visible,history_token) VALUES(?,?,?,?,?,?,?)').bind(id,'a','p',"Needle %_ quoted' "+i,'Literal searchable content',visible,token),DB.prepare('INSERT INTO note_positions(id,organization_id,project_id,parent_id) VALUES(?,?,?,?)').bind(id,'a','p',root.id),DB.prepare('INSERT INTO note_versions(id,note_id,organization_id,project_id,revision,title,text,client_visible,parent_id) VALUES(?,?,?,?,?,?,?,?,?)').bind(token,id,'a','p',0,"Needle %_ quoted' "+i,'Literal searchable content',visible,root.id));}await DB.batch(statements);
  const query='/api/notes?q='+encodeURIComponent('NEEDLE %_')+'&projectId=p&parentId='+root.id;
  for(const [actor,total]of [['staff',65],['client',55]]){const first=await (await call(query,actor)).json();assert.equal(first.items.length,50);const next=await (await call(query+'&after='+first.nextCursor,actor)).json();assert.equal(new Set([...first.items,...next.items].map(r=>r.id)).size,total);assert.equal(next.nextCursor,null);if(actor==='client')assert.ok([...first.items,...next.items].every(r=>r.client_visible===1));}
  assert.equal((await (await call('/api/notes?q='+encodeURIComponent("' OR 1=1 --"),'client')).json()).items.length,0);assert.equal((await (await call('/api/notes?q=Needle&parentId=','client')).json()).items.length,0);assert.equal((await (await call('/api/notes?q=Needle&projectId=q','client')).json()).items.length,0);
  await patch(root.id,{archived:true});assert.equal((await (await call('/api/notes?q=Needle','client')).json()).items.length,0);assert.equal((await (await call('/api/notes?q=Needle')).json()).items.length,0);assert.equal((await (await call('/api/notes?q=Needle&includeArchived=true')).json()).items.length,50);await patch(root.id,{archived:false});
  for(const query of ['?q='+('x'.repeat(201)),'?includeArchived=maybe','?parentId=%27','?unknown=true'])assert.equal((await call('/api/notes'+query)).status,400);
 });
 await t.test('exports preserve placement and historical geometry while clients cannot mutate or export',async()=>{
  const data=await (await call('/api/export')).json();assert.ok(data.tables.note_positions.some(p=>p.id===grand.id&&p.parent_id===child.id));assert.ok(data.tables.note_versions.some(v=>v.note_id===child.id&&v.archived===1));assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
  assert.equal((await call('/api/notes/'+root.id,'client','PATCH',{parentId:null,revision:(await current(root.id)).revision})).status,403);assert.equal((await call('/api/export','client')).status,403);
 });
});

test('document versions and restoration commit atomically in actual local D1',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("document fixture")}}',d1Databases:{DB:'documents'},cf:false});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')&&n<'0005.sql').sort()){
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 }
 const tokens={};for(const [id,org,role,client]of [['staff','a','staff',null],['second','a','staff',null],['client','a','client','c'],['other','a','client','d'],['foreign','b','staff',null]]){
  const email=id+'@example.invalid';await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,email,org,role,client).run();tokens[id]=await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('documents').setSubject(id).setIssuedAt().setExpirationTime('10m').sign(privateKey);
 }
 await DB.batch([
  DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('c','a','Document client')"),
  DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('p','a','c','Document project',1)"),
  DB.prepare("INSERT INTO notes(id,organization_id,project_id,title,text,revision,client_visible) VALUES('legacy','a','p','Existing document','Original existing content',4,0)"),
 ]);
 const before=(await DB.prepare('SELECT * FROM notes').all()).results;
 const sql=await readFile(new URL('./migrations/0005.sql',import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 const worker=createWorker(publicKey),env={DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'documents'};
 const call=(path,actor='staff',method='GET',body,headers={})=>worker.fetch(new Request(origin+path,{method,headers:{...(actor?{'Cf-Access-Jwt-Assertion':tokens[actor]}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{}),...headers},body:body?JSON.stringify(body):undefined}),env);
 let note,path;
 await t.test('upgrade captures existing content without inventing its author or edit date',async()=>{
  assert.deepEqual((await DB.prepare('SELECT id,organization_id,project_id,title,text,revision,client_visible FROM notes').all()).results,before);
  const old=await DB.prepare("SELECT * FROM note_versions WHERE note_id='legacy'").first();assert.equal(old.revision,4);assert.equal(old.text,'Original existing content');assert.equal(old.actor_id,null);assert.equal(old.recorded_at,null);
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
 });
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')&&n>'0005.sql').sort()){
  const later=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(later.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 }
 await t.test('create and concurrent saves capture exactly the successful revisions and authors',async()=>{
  const created=await call('/api/notes','staff','POST',{title:'Original title',text:'<script>literal original</script>',projectId:'p',clientVisible:false});assert.equal(created.status,201);note=await created.json();path='/api/notes/'+note.id;assert.equal(note.history_token,undefined);
  assert.equal((await call(path,'second','PATCH',{text:'Shared revision',clientVisible:true,revision:0})).status,200);
  const attempts=await Promise.all(['staff','second'].map(actor=>call(path,actor,'PATCH',{title:'Winner '+actor,revision:1})));assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);const winner=attempts[0].status===200?'staff':'second';
  const history=await (await call(path+'/versions')).json();assert.deepEqual(history.items.map(r=>r.revision),[2,1,0]);assert.equal(history.currentRevision,2);assert.equal(history.items[0].actor_id,winner);assert.ok(history.items[0].recorded_at>0);assert.ok(history.items.every(r=>!('text'in r)));
  assert.equal((await (await call(path+'/versions/0')).json()).text,'<script>literal original</script>');assert.equal((await (await call(path+'/versions/1')).json()).actor_id,'second');
  assert.equal((await (await call(path)).json()).history_token,undefined);
  assert.equal((await (await call(path,'client')).json()).text,'Shared revision');assert.equal((await call(path+'/versions','client')).status,403);
 });
 await t.test('restoration creates a new version with explicit visibility and prevents replay or stale overwrite',async()=>{
  const restored=await call(path+'/versions/0/restore','staff','POST',{revision:2,clientVisible:false});assert.equal(restored.status,200);const row=await restored.json();assert.equal(row.revision,3);assert.equal(row.title,'Original title');assert.equal(row.text,'<script>literal original</script>');assert.equal(row.client_visible,0);
  const snapshot=await (await call(path+'/versions/3')).json();assert.equal(snapshot.source_revision,0);assert.equal(snapshot.actor_id,'staff');assert.equal((await call(path,'client')).status,404);
  assert.equal((await call(path+'/versions/0/restore','staff','POST',{revision:2,clientVisible:false})).status,409);
  assert.equal((await call(path+'/versions/3/restore','staff','POST',{revision:3,clientVisible:false})).status,409);
  assert.equal((await call(path+'/versions/1/restore','second','POST',{revision:3,clientVisible:true})).status,200);
  assert.equal((await (await call(path,'client')).json()).text,'Shared revision');assert.equal((await call(path+'/versions/0','client')).status,403);
 });
 await t.test('history insertion failure rolls back creation, editing and restoration',async()=>{
  const current=await (await call(path)).json(),count=(await DB.prepare('SELECT COUNT(*) AS n FROM note_versions').first()).n;
  await DB.prepare("CREATE TRIGGER reject_note_versions BEFORE INSERT ON note_versions BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
  try{
   assert.equal((await call(path,'staff','PATCH',{text:'Must roll back',revision:4})).status,500);
   assert.equal((await call('/api/notes','staff','POST',{title:'Must not exist',text:'No orphan document',projectId:'p',clientVisible:false})).status,500);
   assert.equal((await call(path+'/versions/0/restore','staff','POST',{revision:4,clientVisible:false})).status,500);
  }finally{await DB.prepare('DROP TRIGGER reject_note_versions').run();}
  assert.deepEqual(await (await call(path)).json(),current);assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM notes WHERE title='Must not exist'").first()).n,0);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM note_versions').first()).n,count);
 });
 await t.test('a concurrent restore and edit have one winner and one matching snapshot',async()=>{
  const results=await Promise.all([call(path+'/versions/0/restore','staff','POST',{revision:4,clientVisible:false}),call(path,'second','PATCH',{text:'Concurrent edit',revision:4})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const latest=await (await call(path+'/versions/5')).json();assert.equal(latest.actor_id,results[0].status===200?'staff':'second');assert.equal(latest.source_revision,results[0].status===200?0:null);assert.equal(latest.text,results[0].status===200?'<script>literal original</script>':'Concurrent edit');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM note_versions WHERE note_id=?').bind(note.id).first()).n,6);
 });
 await t.test('version metadata paginates beyond 50 without exposing content or losing older versions',async()=>{
  await DB.batch(Array.from({length:60},(_,i)=>DB.prepare('INSERT INTO note_versions(id,note_id,organization_id,project_id,revision,title,text,client_visible,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),note.id,'a','p',i+6,'Version '+(i+6),'Synthetic version '+(i+6),0,'staff',Date.now())));
  await DB.prepare('UPDATE notes SET revision=65 WHERE id=?').bind(note.id).run();
  const first=await (await call(path+'/versions')).json();assert.equal(first.items.length,50);assert.equal(first.nextCursor,'16');assert.equal(first.currentRevision,65);
  const last=await (await call(path+'/versions?before='+first.nextCursor)).json();assert.equal(last.items.length,16);assert.equal(last.nextCursor,null);assert.deepEqual([...first.items,...last.items].map(r=>r.revision),Array.from({length:66},(_,i)=>65-i));
  assert.ok(first.items.every(r=>!('text'in r)&&!('history_token'in r)));assert.equal((await (await call(path+'/versions/0')).json()).text,'<script>literal original</script>');
 });
 await t.test('strict authority, methods, fields, origin and revision validation fail closed',async()=>{
  for(const actor of ['client','other']){assert.equal((await call(path+'/versions',actor)).status,403);assert.equal((await call(path+'/versions/0/restore',actor,'POST',{revision:65,clientVisible:true})).status,403);}
  assert.equal((await call(path+'/versions','foreign')).status,404);assert.equal((await call(path+'/versions',null)).status,401);
  for(const body of [{revision:65},{revision:65,clientVisible:'true'},{revision:-1,clientVisible:false},{revision:65,clientVisible:false,actorId:'foreign'},{revision:65,clientVisible:false,projectId:'other'}])assert.equal((await call(path+'/versions/0/restore','staff','POST',body)).status,400);
  for(const before of ['',"'",'1.5','9999999999999999'])assert.equal((await call(path+'/versions?before='+encodeURIComponent(before))).status,400);
  assert.equal((await call(path+'/versions/99')).status,404);assert.equal((await call(path+'/versions/0','staff','POST',{})).status,405);
  assert.equal((await call(path+'/versions/0/restore','staff','POST',{revision:65,clientVisible:false},{Origin:'https://elsewhere.invalid'})).status,403);
  assert.equal((await call(path,'staff','PATCH',{history_token:'caller-token',revision:65})).status,400);
  await DB.prepare("UPDATE actors SET active=0 WHERE id='second'").run();assert.equal((await call(path+'/versions','second')).status,403);await DB.prepare("UPDATE actors SET active=1 WHERE id='second'").run();
 });
 await t.test('staff export retains document versions and restoration provenance',async()=>{
  const exported=await (await call('/api/export')).json();assert.ok(exported.tables.note_versions.some(r=>r.note_id===note.id&&r.revision===0));assert.ok(exported.tables.note_versions.some(r=>r.source_revision===0));assert.equal(exported.tables.actors,undefined);
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
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')&&n>'0004.sql').sort()){
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 }
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
