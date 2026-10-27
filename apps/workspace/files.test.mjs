import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {generateKeyPair,SignJWT} from 'jose';
import {createWorker} from './worker.mjs';
const origin='https://files.example.invalid',issuer='https://identity.cloudflareaccess.com';
test('private files use real local D1/R2 and preserve original bytes',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'files'},r2Buckets:['FILES'],cf:false});t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB'),FILES=await mf.getR2Bucket('FILES');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 }
 const {publicKey,privateKey}=await generateKeyPair('RS256'),tokens={};
 for(const [id,org,role,client] of [['staff','a','staff',null],['client','a','client','c'],['other','a','client','d'],['foreign','b','staff',null]]){
  const email=id+'@example.invalid';await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,email,org,role,client).run();tokens[id]=await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('files').setSubject(id).setIssuedAt().setExpirationTime('10m').sign(privateKey);
 }
 await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('c','a','Synthetic client')").run();
 await DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('p','a','c','Synthetic project',1)").run();
 const worker=createWorker(publicKey),env={DB,FILES,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'files'};
 const call=(path,actor='staff',method='GET',body,headers={},bindings=env)=>worker.fetch(new Request(origin+path,{method,headers:{'cf-access-jwt-assertion':tokens[actor],...(method!=='GET'?{origin}:{}),...headers},...(body!==undefined?{body}:{}),...(body instanceof ReadableStream?{duplex:'half'}:{})}),bindings);
 const upload=(actor='staff',headers={},body=new Uint8Array([0,255,1,2,3]))=>call('/api/files',actor,'POST',body,{'content-type':'application/octet-stream','x-project-id':'p','x-file-name':encodeURIComponent('Synthetic résumé.pdf'),'x-client-visible':'true',...headers});
 let file;
 await t.test('binding absence fails closed; staff upload returns safe metadata only',async()=>{
  assert.equal((await call('/api/files','staff','GET',undefined,{}, {...env,FILES:undefined})).status,503);
  const r=await upload();assert.equal(r.status,201);file=await r.json();assert.equal(file.name,'Synthetic résumé.pdf');assert.equal(file.size,5);assert.match(file.sha256,/^[0-9a-f]{64}$/);assert.equal(file.object_key,undefined);
  assert.equal((await FILES.list()).objects.length,1);
 });
 await t.test('download is byte exact, attachment only and private',async()=>{
  const r=await call('/api/files/'+file.id+'/download','client');assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),new Uint8Array([0,255,1,2,3]));assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.match(r.headers.get('content-disposition'),/^attachment;/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 });
 await t.test('foreign actors and clients cannot upload or discover another client files',async()=>{
  assert.equal((await upload('client')).status,403);assert.equal((await upload('foreign')).status,404);
  for(const actor of ['other','foreign']){assert.equal((await call('/api/files/'+file.id+'/download',actor)).status,404);assert.equal((await (await call('/api/files',actor)).json()).items.length,0);}
  const hidden=await upload('staff',{'x-client-visible':'false'});assert.equal(hidden.status,201);assert.equal((await call('/api/files/'+(await hidden.json()).id+'/download','client')).status,404);
  await DB.prepare("UPDATE projects SET client_visible=0 WHERE id='p'").run();assert.equal((await call('/api/files/'+file.id+'/download','client')).status,404);assert.equal((await (await call('/api/files','client')).json()).items.length,0);await DB.prepare("UPDATE projects SET client_visible=1 WHERE id='p'").run();
 });
 await t.test('untrusted names, visibility, content type, empty and oversized streams fail before storing',async()=>{
  const before=(await FILES.list()).objects.length;
  for(const headers of [{'x-file-name':'..%2Fescape.txt'},{'x-file-name':'%0Ainjected'},{'x-file-name':'%ZZ'},{'x-client-visible':'yes'},{'content-type':'text/html'},{'x-project-id':'missing'}])assert.ok([400,404].includes((await upload('staff',headers)).status));
  assert.equal((await upload('staff',{},new Uint8Array())).status,400);
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(5*1024*1024));c.enqueue(new Uint8Array(1));c.close();}});
  assert.equal((await upload('staff',{'content-length':'1'},stream)).status,413);assert.equal((await FILES.list()).objects.length,before);
  assert.equal((await upload('staff',{origin:'https://foreign.example.invalid'})).status,403);
 });
 await t.test('soft removal denies downloads, retains bytes and supports staff restore with revisions',async()=>{
  const patch=(body,actor='staff')=>call('/api/files/'+file.id,actor,'PATCH',JSON.stringify(body),{'content-type':'application/json'});
  assert.equal((await patch({deleted:true,revision:0},'client')).status,403);
  const edits=await Promise.all([patch({deleted:true,revision:0}),patch({clientVisible:false,revision:0})]);assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
  const latest=(await (await call('/api/files?includeDeleted=true')).json()).items.find(x=>x.id===file.id);
  if(!latest.deleted)assert.equal((await patch({deleted:true,revision:1})).status,200);
  assert.equal((await call('/api/files/'+file.id+'/download')).status,404);assert.equal((await call('/api/files?includeDeleted=true','client')).status,403);
  const row=await DB.prepare('SELECT * FROM files WHERE id=?').bind(file.id).first();assert.ok(await FILES.head(row.object_key));
  assert.equal((await patch({deleted:false,clientVisible:true,revision:row.revision})).status,200);assert.equal((await call('/api/files/'+file.id+'/download')).status,200);
 });
 await t.test('R2 failure keeps pending records private and never creates a visible download',async()=>{
  const failedEnv={...env,FILES:{put:async()=>{throw Error('synthetic failure');}}};
  const r=await call('/api/files','staff','POST',new Uint8Array([1]),{'content-type':'application/octet-stream','x-project-id':'p','x-file-name':'pending.txt','x-client-visible':'true'},failedEnv);assert.equal(r.status,500);
  const pending=await DB.prepare("SELECT id FROM files WHERE state='pending'").first();assert.ok(pending);assert.equal((await call('/api/files/'+pending.id+'/download')).status,404);assert.ok(!(await (await call('/api/files?includeDeleted=true')).json()).items.some(x=>x.id===pending.id));
 });
 await t.test('ready-transition failure retains the original while pending metadata stays hidden',async()=>{
  const failedEnv={...env,DB:{prepare(sql){if(sql.startsWith("UPDATE files SET state='ready'"))return {bind(){return {run:async()=>{throw Error('synthetic finalization failure');}};}};return DB.prepare(sql);}}};
  const r=await call('/api/files','staff','POST',new Uint8Array([7,8]),{'content-type':'application/octet-stream','x-project-id':'p','x-file-name':'finalization.txt','x-client-visible':'true'},failedEnv);assert.equal(r.status,500);
  const row=await DB.prepare("SELECT * FROM files WHERE name='finalization.txt'").first();assert.equal(row.state,'pending');const original=await FILES.get(row.object_key);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),new Uint8Array([7,8]));
  for(const actor of ['staff','client']){assert.equal((await call('/api/files/'+row.id+'/download',actor)).status,404);assert.ok(!(await (await call('/api/files',actor)).json()).items.some(x=>x.id===row.id));}
 });
 await t.test('file lists paginate without duplication and reject client trash access',async()=>{
  const template=await DB.prepare('SELECT * FROM files WHERE id=?').bind(file.id).first();
  for(let i=0;i<52;i++)await DB.prepare("INSERT INTO files(id,organization_id,project_id,actor_id,name,object_key,size,sha256,state,client_visible,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind('page-'+String(i).padStart(3,'0'),'a','p','staff','Synthetic page','fixture-page-'+i,1,template.sha256,'ready',1,0).run();
  const first=await (await call('/api/files','client')).json();assert.equal(first.items.length,50);assert.ok(first.nextCursor);const next=await (await call('/api/files?after='+first.nextCursor,'client')).json();assert.equal(new Set([...first.items,...next.items].map(x=>x.id)).size,53);assert.equal(next.nextCursor,null);
  assert.equal((await call('/api/files?after=%27','client')).status,400);assert.equal((await call('/api/files?includeDeleted=true','client')).status,403);
 });
 await t.test('downloads discard bytes when sharing, deletion or identity changes during storage I/O',async()=>{
  await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('reassigned','a','Reassigned client')").run();
  for(const fault of ['file-private','project-private','deleted','client-reassigned','actor-inactive','actor-role','actor-client']){
   const created=await upload(),current=await created.json();assert.equal(created.status,201);
   const mutate=()=>DB.prepare(({ 'file-private':'UPDATE files SET client_visible=0 WHERE id=?','deleted':'UPDATE files SET deleted=1 WHERE id=?','project-private':"UPDATE projects SET client_visible=0 WHERE id='p'",'client-reassigned':"UPDATE projects SET client_id='reassigned' WHERE id='p'",'actor-inactive':"UPDATE actors SET active=0 WHERE id='client'",'actor-role':"UPDATE actors SET role='staff',client_id=NULL WHERE id='client'",'actor-client':"UPDATE actors SET client_id='reassigned' WHERE id='client'"})[fault]).bind(...(['file-private','deleted'].includes(fault)?[current.id]:[])).run();
   let changed=false;const delayed={...env,FILES:{async get(key){const object=await FILES.get(key);return {...object,size:object.size,async arrayBuffer(){const bytes=await object.arrayBuffer();await mutate();changed=true;return bytes;}};}}};
   const response=await call('/api/files/'+current.id+'/download','client','GET',undefined,{},delayed);
   assert.equal(changed,true);assert.equal(response.status,fault.startsWith('actor-')?403:404,fault);assert.ok(!(await response.text()).includes(String.fromCharCode(255)));
   await DB.prepare("UPDATE projects SET client_visible=1,client_id='c' WHERE id='p'").run();await DB.prepare("UPDATE actors SET active=1,role='client',client_id='c' WHERE id='client'").run();
  }
 });
 await t.test('missing/corrupt originals fail closed and insertion failure leaves no downloadable metadata',async()=>{
  const row=await DB.prepare('SELECT * FROM files WHERE id=?').bind(file.id).first();await FILES.put(row.object_key,new Uint8Array([9,9,9,9,9]));assert.equal((await call('/api/files/'+file.id+'/download')).status,503);await FILES.delete(row.object_key);assert.equal((await call('/api/files/'+file.id+'/download')).status,503);
  const before=(await FILES.list()).objects.length;
  await DB.prepare("CREATE TRIGGER reject_files BEFORE INSERT ON files BEGIN SELECT RAISE(ABORT,'fixture'); END").run();assert.equal((await upload()).status,500);assert.equal((await FILES.list()).objects.length,before);
 });
});
