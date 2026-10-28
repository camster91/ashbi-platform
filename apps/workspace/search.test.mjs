import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {generateKeyPair,SignJWT} from 'jose';
import {searchRoute} from './search.mjs';
const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');

test('global search filters before paging and retains canonical visibility',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'search'},cf:false});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 for(const file of(await readdir(new URL('./migrations',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile(new URL('./migrations/'+file,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));}
 for(const [id,org,role,client] of [['staff','a','staff',null],['client','a','client','ca'],['foreign','b','staff',null]])await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,id+'@example.invalid',org,role,client).run();
 for(const [id,org]of [['ca','a'],['other','a'],['cb','b']])await DB.prepare('INSERT INTO clients(id,organization_id,name) VALUES(?,?,?)').bind(id,org,'Needle '+id).run();
 for(const [id,org,client,visible,archived]of [['pa','a','ca',1,0],['private','a','ca',0,0],['other-project','a','other',1,0],['archived','a','ca',1,1],['pb','b','cb',1,0]])await DB.prepare('INSERT INTO projects(id,organization_id,client_id,name,client_visible,archived) VALUES(?,?,?,?,?,?)').bind(id,org,client,'Needle '+id,visible,archived).run();
 for(let i=0;i<65;i++)await DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,client_visible) VALUES(?,'a','pa',?,1)").bind('task-'+String(i).padStart(3,'0'),'Needle '+i).run();
 for(const [id,p,org,visible,title]of [['hidden','pa','a',0,'Needle hidden'],['private-task','private','a',1,'Needle private'],['other-task','other-project','a',1,'Needle other'],['archived-task','archived','a',1,'Needle archived'],['foreign-task','pb','b',1,'Needle foreign'],['literal','pa','a',1,'100%_ exact'],['not-literal','pa','a',1,'100ABC exact']])await DB.prepare('INSERT INTO tasks(id,organization_id,project_id,title,client_visible) VALUES(?,?,?,?,?)').bind(id,org,p,title,visible).run();
 for(const [id,visible,parent,archived]of [['root',0,null,0],['child',1,'root',0],['archive-root',1,null,1],['archive-child',1,'archive-root',0],['public-note',1,null,0]]){
  await DB.prepare("INSERT INTO notes(id,organization_id,project_id,title,text,client_visible) VALUES(?,'a','pa',?,'SECRET BODY',?)").bind(id,'Needle '+id,visible).run();
  await DB.prepare("INSERT INTO note_positions(id,organization_id,project_id,parent_id,archived) VALUES(?,'a','pa',?,?)").bind(id,parent,archived).run();
 }
 const {publicKey,privateKey}=await generateKeyPair('RS256'),origin='https://workspace.invalid',issuer='https://identity.cloudflareaccess.com',tokens={};
 for(const id of ['staff','client','foreign'])tokens[id]=await new SignJWT({email:id+'@example.invalid'}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('search').setSubject(id).setIssuedAt().setExpirationTime('10m').sign(privateKey);
 const worker=createWorker(publicKey),env={DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'search'};
 const call=async(query,who='staff',method='GET')=>worker.fetch(new Request(origin+'/api/search?'+query,{method,headers:{'cf-access-jwt-assertion':tokens[who],origin}}),env);
 const data=async(query,who)=>{const r=await call(query,who);assert.equal(r.status,200);return r.json();};
 await t.test('all result types are bounded and contain only identifiers and titles',async()=>{const r=await data('q=Needle');assert.deepEqual(r.groups.map(g=>g.type),['clients','projects','tasks','notes']);assert.ok(r.groups.every(g=>g.items.length<=20));assert.doesNotMatch(JSON.stringify(r),/SECRET BODY|foreign|archived-task|archive-child/);for(const g of r.groups)for(const row of g.items)assert.deepEqual(Object.keys(row).sort(),['id','title']);});
 await t.test('client pagination reaches every authorized match beyond fifty without duplicates',async()=>{let after='',ids=[];do{const r=await data('q=Needle&type=tasks'+(after?'&after='+after:''),'client');ids.push(...r.groups[0].items.map(x=>x.id));after=r.groups[0].nextCursor;}while(after);assert.equal(ids.length,65);assert.equal(new Set(ids).size,65);assert.ok(ids.every(x=>x.startsWith('task-')));});
 await t.test('client/project/ancestor visibility and archived ancestors constrain every result',async()=>{const r=await data('q=Needle','client');assert.deepEqual(r.groups[0].items.map(x=>x.id),['ca']);assert.deepEqual(r.groups[1].items.map(x=>x.id),['pa']);assert.deepEqual(r.groups[3].items.map(x=>x.id),['public-note']);const staff=await data('q=Needle&type=notes');assert.ok(staff.groups[0].items.some(x=>x.id==='child'));assert.ok(!staff.groups[0].items.some(x=>x.id==='archive-child'));const foreign=await data('q=Needle','foreign');assert.ok(foreign.groups.every(g=>g.items.every(x=>['cb','pb','foreign-task'].includes(x.id))));});
 await t.test('literal wildcard input stays literal and malformed filters fail closed',async()=>{assert.deepEqual((await data('q='+encodeURIComponent('100%_')+'&type=tasks')).groups[0].items.map(x=>x.id),['literal']);for(const q of ['q=','q=%20','q='+('x'.repeat(201)),'q=x&q=y','q=x&type=files','q=x&after=a','q=x&type=tasks&after=','q=x&type=tasks&after=a&after=b','q=x&extra=1'])assert.equal((await call(q)).status,400,q);assert.equal((await call('q=x','staff','POST')).status,405);});
 await t.test('identity changes reject results built for the previous client scope',async()=>{await DB.prepare("UPDATE actors SET client_id='other' WHERE id='client'").run();await assert.rejects(()=>searchRoute(new Request(origin+'/api/search?q=Needle'),DB,{id:'client',organization_id:'a',role:'client',client_id:'ca'},x=>x),e=>e===403);await DB.prepare("UPDATE actors SET active=0 WHERE id='staff'").run();assert.equal((await call('q=Needle')).status,403);});
});
