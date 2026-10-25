import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {generateKeyPair,SignJWT} from 'jose';
const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');

test('dashboard tasks project canonical records through current signed identity and actual D1',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'dashboard'},cf:false});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));}
 const {publicKey,privateKey}=await generateKeyPair('RS256'),origin='https://dashboard.example.invalid',issuer='https://identity.cloudflareaccess.com',tokens={};
 for(const [id,org,role,client] of [['staff','a','staff',null],['inactive','a','staff',null],['foreign','b','staff',null],['client','a','client','ca'],['other','a','client','co']]){const email=id+'@example.invalid';await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,email,org,role,client).run();tokens[id]=await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('dashboard').setSubject(id).setIssuedAt().setExpirationTime('10m').sign(privateKey);}
 for(const [id,org] of [['ca','a'],['co','a'],['cb','b']])await DB.prepare('INSERT INTO clients(id,organization_id,name) VALUES(?,?,?)').bind(id,org,'Client '+id).run();
 for(const [id,org,client,visible] of [['pa','a','ca',1],['hidden','a','ca',0],['po','a','co',1],['pb','b','cb',1]])await DB.prepare('INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES(?,?,?,?,?)').bind(id,org,client,'Project '+id,visible).run();
 async function seed(id,{org='a',project='pa',status='todo',owner=null,due=null,visible=1}={}){await DB.prepare('INSERT INTO tasks(id,organization_id,project_id,title,status,assignee_id,due_on,client_visible) VALUES(?,?,?,?,?,?,?,?)').bind(id,org,project,'Task '+id,status,owner,due,visible).run();}
 await seed('a-complete',{status:'done',owner:'staff',due:'2000-01-01'});await seed('b-owned',{owner:'staff',due:'2000-01-01'});await seed('c-unassigned');await seed('d-inactive',{owner:'inactive'});await seed('e-private',{visible:0});await seed('f-project-hidden',{project:'hidden'});await seed('g-other-client',{project:'po'});await seed('h-foreign',{org:'b',project:'pb',owner:'foreign'});await DB.prepare("UPDATE actors SET active=0 WHERE id='inactive'").run();
 const worker=createWorker(publicKey,{stripeFetch:()=>{throw Error('Dashboard must not call a provider');}}),env={DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'dashboard'};
 const call=(query='',who='staff',bindings=env,method='GET')=>worker.fetch(new Request(origin+'/api/dashboard/tasks'+query,{method,headers:{'cf-access-jwt-assertion':tokens[who],origin}}),bindings);
 async function get(query='',who='staff',bindings=env){const r=await call(query,who,bindings);assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');return r.json();}
 await t.test('open work exposes canonical source, client, project, owner, status and due without guessed priorities',async()=>{
  const data=await get();assert.deepEqual(data.items.map(r=>r.id),['b-owned','c-unassigned','d-inactive','e-private','f-project-hidden','g-other-client']);assert.equal(data.nextCursor,null);assert.equal(data.complete,true);assert.equal(data.limit,50);assert.ok(Number.isSafeInteger(data.observedAt));
  const row=data.items[0];assert.deepEqual(row.source,{kind:'tasks',id:'b-owned'});assert.deepEqual(row.client,{id:'ca',name:'Client ca'});assert.deepEqual(row.project,{id:'pa',name:'Project pa'});assert.deepEqual(row.owner,{id:'staff',state:'ACTIVE'});assert.equal(row.status,'todo');assert.equal(row.dueOn,'2000-01-01');assert.equal(row.overdue,true);assert.equal(row.priority,undefined);assert.deepEqual(data.items[1].owner,{id:null,state:'UNASSIGNED'});assert.deepEqual(data.items[2].owner,{id:'inactive',state:'INACTIVE'});
 });
 await t.test('filters are applied before pagination and completed work stays explicit',async()=>{
  assert.deepEqual((await get('?owner=mine')).items.map(r=>r.id),['b-owned']);assert.deepEqual((await get('?owner=unassigned&projectId=pa&clientId=ca&due=none')).items.map(r=>r.id),['c-unassigned','e-private']);assert.deepEqual((await get('?ownerId=inactive')).items.map(r=>r.id),['d-inactive']);assert.deepEqual((await get('?due=overdue')).items.map(r=>r.id),['b-owned']);assert.deepEqual((await get('?status=done')).items.map(r=>r.id),['a-complete']);assert.equal((await get('?clientId=cb')).items.length,0);
 });
 await t.test('clients only receive own explicitly shared tasks in shared projects',async()=>{
  assert.deepEqual((await get('','client')).items.map(r=>r.id),['b-owned','c-unassigned','d-inactive']);assert.deepEqual((await get('','other')).items.map(r=>r.id),['g-other-client']);assert.equal((await get('?clientId=co','client')).items.length,0);assert.deepEqual((await get('','foreign')).items.map(r=>r.id),['h-foreign']);
 });
 await t.test('unknown, duplicate, conflicting and malformed filters are rejected',async()=>{
  for(const query of ['?priority=high','?status=blocked','?due=soon','?owner=anyone','?owner=mine&ownerId=staff','?status=open&status=done','?after=%27','?clientId=','?limit=1000'])assert.equal((await call(query)).status,400,query);
  assert.equal((await call('','staff',env,'POST')).status,405);
 });
 await t.test('more than one source page remains discoverable with truthful bounded state',async()=>{
  for(let n=0;n<57;n++)await seed('z-'+String(n).padStart(3,'0'),{status:'doing',owner:'staff'});
  const first=await get('?status=doing&owner=mine');assert.equal(first.items.length,50);assert.equal(first.complete,false);assert.equal(first.nextCursor,'z-049');
  const last=await get('?status=doing&owner=mine&after='+first.nextCursor);assert.equal(last.items.length,7);assert.equal(last.complete,true);assert.equal(last.nextCursor,null);assert.equal(new Set([...first.items,...last.items].map(r=>r.id)).size,57);
 });
 await t.test('current task status and sharing changes appear without copied dashboard state',async()=>{
  await DB.prepare("UPDATE tasks SET status='done' WHERE id='b-owned'").run();assert.equal((await get('?owner=mine&status=todo')).items.length,0);await DB.prepare("UPDATE projects SET client_visible=0 WHERE id='pa'").run();assert.equal((await get('','client')).items.length,0);await DB.prepare("UPDATE projects SET client_visible=1 WHERE id='pa'").run();
 });
 await t.test('a revoked identity during the projection cannot receive previously read rows',async()=>{
  let reads=0;const wrapped={prepare(sql){const statement=DB.prepare(sql);if(!sql.startsWith('SELECT tasks.'))return statement;return {bind(...args){const bound=statement.bind(...args);return {async all(){const r=await bound.all();if(++reads===1)await DB.prepare("UPDATE actors SET active=0 WHERE id='staff'").run();return r;}};}};}};
  assert.equal((await call('','staff',{...env,DB:wrapped})).status,403);assert.ok(reads>0);await DB.prepare("UPDATE actors SET active=1 WHERE id='staff'").run();
 });
 await t.test('source database failure remains a failed response rather than healthy empty work',async()=>{
  const broken={prepare(sql){if(sql.startsWith('SELECT tasks.'))throw Error('synthetic unavailable source');return DB.prepare(sql);}};const r=await call('','staff',{...env,DB:broken});assert.equal(r.status,500);assert.deepEqual(await r.json(),{error:'Request failed'});
 });
 await t.test('an assignment without an authorized staff match stays unknown rather than falsely inactive',async()=>{
  await seed('unknown-owner',{owner:'foreign'});const row=(await get('?ownerId=foreign')).items[0];assert.deepEqual(row.owner,{id:'foreign',state:'UNAVAILABLE'});
 });
});
