import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {generateKeyPair,SignJWT} from 'jose';
const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');

test('dashboard review projection preserves live review authority and decisions in actual D1',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'dashboard-reviews'},cf:false});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));}
 const {publicKey,privateKey}=await generateKeyPair('RS256'),origin='https://dashboard-reviews.example.invalid',issuer='https://identity.cloudflareaccess.com',tokens={};
 for(const [id,org,role,client]of [['finance','a','staff',null],['staff','a','staff',null],['client','a','client','ca'],['other','a','client','co'],['foreign','b','staff',null]]){await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,id+'@example.invalid',org,role,client).run();tokens[id]=await new SignJWT({email:id+'@example.invalid'}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('reviews').setSubject(id).setIssuedAt().setExpirationTime('15m').sign(privateKey);}
 for(const [id,org]of [['finance','a'],['foreign','b']])await DB.prepare('INSERT INTO actor_finance_access VALUES(?,?)').bind(id,org).run();for(const [id,org]of [['ca','a'],['co','a'],['cb','b']])await DB.prepare('INSERT INTO clients(id,organization_id,name) VALUES(?,?,?)').bind(id,org,'Client '+id).run();await DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('pa','a','ca','Shared project',1),('po','a','co','Other project',1)").run();
 const worker=createWorker(publicKey,{stripeFetch:()=>{throw Error('No provider calls on dashboard');}}),env={DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'reviews'};
 const call=(path,body,who='finance',method=body?'POST':'GET',bindings=env)=>worker.fetch(new Request(origin+'/api/'+path,{method,headers:{'cf-access-jwt-assertion':tokens[who],origin,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),bindings);
 const data=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
 async function publish(title='Review work',extra={}){const d=await data(await call('commercial/proposals',{requestId:crypto.randomUUID(),title,clientId:'ca',projectId:'pa',content:{scope:'Scope',schedule:'Schedule',terms:'Terms',currency:'CAD',charges:[{description:'Design',quantity:1,unitMinor:10000}],discountMinor:0,tax:{type:'NONE',rateBps:0}},...extra}),201);return data(await call('proposal-reviews',{requestId:crypto.randomUUID(),proposalId:d.id,proposalRevision:d.revision,proposalHash:d.contentHash,expiresAt:new Date(Math.floor((Date.now()+3600000)/1000)*1000).toISOString().replace('.000Z','Z'),reason:'PRIVATE internal reason'}),201);}
 async function decide(r,value){return data(await call('portal/proposals/'+r.id+'/respond',{requestId:crypto.randomUUID(),revision:r.revision,contentHash:r.contentHash,decision:value,comment:'Client decision',acknowledged:true},'client'));}
 const get=(q='',who='finance',bindings=env)=>call('dashboard/reviews'+q,undefined,who,'GET',bindings).then(r=>data(r));
 const open=await publish('Awaiting approval'),changes=await publish('Needs changes'),approved=await publish('Accepted'),expired=await publish('Expired'),stale=await publish('Changed source'),withdrawn=await publish('Withdrawn');await decide(changes,'CHANGES_REQUESTED');await decide(approved,'APPROVED');
 await DB.prepare('UPDATE proposal_reviews SET expires_at=1000 WHERE id=?').bind(expired.id).run();await DB.prepare("UPDATE commercial_drafts SET status='ARCHIVED' WHERE id=?").bind(stale.proposalId).run();await data(await call('proposal-reviews/'+withdrawn.id+'/revoke',{requestId:crypto.randomUUID(),revision:0,reason:'PRIVATE withdrawn'}));
 await t.test('default attention includes actual waiting and recovery states with source links and truthful ownership',async()=>{
  const r=await get();assert.deepEqual(r.items.map(x=>x.id).sort(),[open.id,changes.id,expired.id,stale.id].sort());assert.equal(r.complete,true);assert.equal(r.nextCursor,null);assert.equal(r.limit,50);assert.ok(Number.isSafeInteger(r.observedAt));const row=r.items.find(x=>x.id===open.id);assert.deepEqual(row.source,{kind:'reviews',id:open.id});assert.deepEqual(row.client,{id:'ca',name:'Client ca'});assert.deepEqual(row.project,{id:'pa',name:'Shared project'});assert.deepEqual(row.owner,{id:null,state:'UNASSIGNED'});assert.equal(row.responsibility,'CLIENT_TEAM');assert.equal(row.nextAction,'Await client review');assert.equal(row.dueOn,undefined);assert.equal(row.expiresAt,open.expiresAt);assert.equal(row.createdAt,open.createdAt);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|finance@example|createdBy|sourceHash|decision_comment|decision_actor_email/);
 });
 await t.test('derived states match the canonical detail, and filters run over current derived state',async()=>{
  const r=await get('?state=all');for(const row of r.items){const detail=await data(await call('proposal-reviews/'+row.id));assert.equal(row.state,detail.state);assert.equal(row.isLatest,detail.isLatest);}
  assert.deepEqual((await get('?state=APPROVED')).items.map(x=>x.id),[approved.id]);assert.deepEqual((await get('?state=EXPIRED')).items.map(x=>x.id),[expired.id]);assert.deepEqual((await get('?state=STALE')).items.map(x=>x.id),[stale.id]);assert.deepEqual((await get('?state=REVOKED')).items.map(x=>x.id),[withdrawn.id]);assert.equal((await get('?clientId=co')).items.length,0);
 });
 await t.test('client scope includes only shared own reviews and current response semantics',async()=>{
  const r=await get('','client'),row=r.items.find(x=>x.id===open.id);assert.equal(row.canRespond,true);assert.equal(row.nextAction,'Review proposal');assert.equal(r.items.find(x=>x.id===changes.id).nextAction,'Await revised proposal');assert.equal((await get('','other')).items.length,0);assert.equal((await get('','foreign')).items.length,0);assert.equal((await call('dashboard/reviews',undefined,'staff')).status,403);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|finance@example|decisionActor|sourceHash/);
  await DB.prepare("UPDATE projects SET client_visible=0 WHERE id='pa'").run();assert.equal((await get('','client')).items.length,0);await DB.prepare("UPDATE projects SET client_visible=1 WHERE id='pa'").run();
 });
 await t.test('unknown, duplicate, malformed and irrelevant filters fail explicitly',async()=>{
  for(const q of ['?state=WAITING','?state=OPEN&state=all','?clientId=','?projectId=%27','?after=%27','?owner=finance','?due=overdue','?limit=500'])assert.equal((await call('dashboard/reviews'+q)).status,400,q);assert.equal((await call('dashboard/reviews',{},'finance','POST')).status,405);
 });
 await t.test('pagination finds more than 50 matching reviews without deriving state from a first source page',async()=>{
  // Each source is created/published through the canonical signed workflow.
  await get('?state=OPEN&clientId=co&projectId=po');const made=[];for(let n=0;n<52;n++)made.push(await publish('Paged '+n,{projectId:'po',clientId:'co'}));
  const first=await get('?state=OPEN&clientId=co&projectId=po');assert.equal(first.items.length,50);assert.equal(first.complete,false);assert.ok(first.nextCursor);const last=await get('?state=OPEN&clientId=co&projectId=po&after='+first.nextCursor);assert.equal(last.items.length,2);assert.equal(last.complete,true);assert.equal(new Set([...first.items,...last.items].map(r=>r.id)).size,52);assert.deepEqual([...first.items,...last.items].map(r=>r.id).sort(),made.map(r=>r.id).sort());
 });
 function intercept(action){let reads=0;return {prepare(sql){const statement=DB.prepare(sql);if(!sql.includes('dashboard_scoped'))return statement;return {bind(...args){const bound=statement.bind(...args);return {async all(){const r=await bound.all();if(++reads===1)await action();return r;}};}};}};}
 await t.test('finance grant revoked after a source read denies the whole response',async()=>{
  const wrapped=intercept(()=>DB.prepare("DELETE FROM actor_finance_access WHERE id='finance'").run());assert.equal((await call('dashboard/reviews',undefined,'finance','GET',{...env,DB:wrapped})).status,403);await DB.prepare("INSERT INTO actor_finance_access VALUES('finance','a')").run();
 });
 await t.test('client remapping during reads cannot return rows for a new or cached client identity',async()=>{
  const wrapped=intercept(()=>DB.prepare("UPDATE actors SET client_id='co' WHERE id='client'").run());assert.equal((await call('dashboard/reviews',undefined,'client','GET',{...env,DB:wrapped})).status,403);await DB.prepare("UPDATE actors SET client_id='ca' WHERE id='client'").run();
 });
 await t.test('sharing revoked between client reads removes previously read reviews',async()=>{
  const wrapped=intercept(()=>DB.prepare("UPDATE projects SET client_visible=0 WHERE id='pa'").run());assert.deepEqual((await get('','client',{...env,DB:wrapped})).items,[]);await DB.prepare("UPDATE projects SET client_visible=1 WHERE id='pa'").run();
 });
 await t.test('a source failure remains an error instead of healthy empty approvals',async()=>{
  const broken={prepare(sql){if(sql.includes('dashboard_scoped'))throw Error('Synthetic source failed');return DB.prepare(sql);}};assert.equal((await call('dashboard/reviews',undefined,'finance','GET',{...env,DB:broken})).status,500);
 });
 await t.test('a new round removes previous requested changes from attention without rewriting its decision',async()=>{
  const source=await data(await call('commercial/proposals/'+changes.proposalId)),prior=await data(await call('proposal-reviews/'+changes.id));
  const next=await data(await call('proposal-reviews',{requestId:crypto.randomUUID(),proposalId:source.id,proposalRevision:source.revision,proposalHash:source.contentHash,previousReviewId:changes.id,previousRevision:prior.revision,expiresAt:new Date(Math.floor((Date.now()+3600000)/1000)*1000).toISOString().replace('.000Z','Z'),reason:'Explicit next round'}),201);
  const count=async()=>(await DB.prepare('SELECT COUNT(*) n FROM proposal_review_events').first()).n,before=await count(),attention=await get('?projectId=pa');assert.ok(attention.items.some(r=>r.id===next.id));assert.ok(attention.items.every(r=>r.id!==changes.id));const all=await get('?state=all&projectId=pa'),retained=all.items.find(r=>r.id===changes.id);assert.equal(retained.state,'CHANGES_REQUESTED');assert.equal(retained.isLatest,false);assert.equal(retained.canRespond,false);assert.equal(retained.nextAction,'Open review details');assert.equal(retained.responsibility,null);assert.equal(await count(),before);
 });
});
