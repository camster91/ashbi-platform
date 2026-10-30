import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {hubAuthFixture} from './hub-auth-fixture.mjs';
import {stripeDraftsRoute} from './stripe-drafts.mjs';
import {stripeTestProvider} from './stripe-test-provider.mjs';

const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');

test('readiness security matrix keeps authentication, origin and tenant boundaries fail closed',async t=>{
 const f=await hubAuthFixture(createWorker);t.after(()=>f.close());
 const unauth=await f.call('/api/inbox',{cookie:undefined});assert.equal(unauth.status,401);
 f.login();assert.equal((await f.call('/api/me',{cookie:f.cookie})).status,200);
 const wrongOrigin=await f.call('/api/tasks',{method:'POST',cookie:f.cookie,body:{title:'Rejected origin',projectId:'missing'},headers:{Origin:'https://foreign.invalid'}});assert.equal(wrongOrigin.status,403);
 await f.DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('foreign-client','foreign-org','Foreign client')").run();
 await f.DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('own-project','qa','own','Own project',1),('foreign-project','foreign-org','foreign-client','Foreign project',1)").run();
 const staffProjects=await f.call('/api/projects',{cookie:f.cookie});assert.equal(staffProjects.status,200);assert.doesNotMatch(await staffProjects.text(),/Foreign project/);
 f.setUser({id:'hub-client',email:'client@example.invalid',organizationId:'hub-org',role:'CLIENT'});f.login();
 assert.equal((await f.call('/api/staff',{cookie:f.cookie})).status,403);
 assert.equal((await f.call('/api/invoices',{cookie:f.cookie})).status,403);
 const clientProjects=await f.call('/api/projects',{cookie:f.cookie});assert.equal(clientProjects.status,200);const body=await clientProjects.json();assert.deepEqual(body.items.map(row=>row.id),['own-project']);assert.doesNotMatch(JSON.stringify(body),/Foreign project|foreign-project/);
});

test('billing sandbox configuration is explicit and disabled mode performs no provider work',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'readiness-billing'},cf:false});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 const provider=stripeTestProvider({organizationId:'qa',enabled:false});
 const {readFile,readdir}=await import('node:fs/promises');
 for(const name of(await readdir(new URL('./migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()){
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 }
 await DB.prepare("INSERT INTO actors VALUES('finance','finance@example.invalid','qa','staff',NULL,1)").run();await DB.prepare("INSERT INTO actor_finance_access VALUES('finance','qa')").run();await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('billing-client','qa','Billing client')").run();
 const env={DB,APP_ORIGIN:'https://readiness.invalid',STRIPE_MODE:'test',STRIPE_ORGANIZATION_ID:'qa',...provider.bindings};
 const json=(value,status=200)=>Response.json(value,{status}),statusRequest=new Request('https://readiness.invalid/api/stripe/status'),previewRequest=new Request('https://readiness.invalid/api/stripe/customers/preview',{method:'POST',headers:{Origin:'https://readiness.invalid','Content-Type':'application/json'},body:JSON.stringify({clientId:'billing-client',customerId:'cus_alpha'})}),actor={id:'finance',organization_id:'qa',role:'staff',client_id:null};
 const disabled=await stripeDraftsRoute(statusRequest,env,actor,async()=>({}),json,provider.fetch);assert.deepEqual(await disabled.json(),{configured:false,mode:'test'});assert.equal(provider.requests.length,0);
 const unconfigured={DB,APP_ORIGIN:env.APP_ORIGIN,STRIPE_MODE:'live',STRIPE_ORGANIZATION_ID:'qa'};await assert.rejects(()=>stripeDraftsRoute(previewRequest,unconfigured,actor,async()=>({clientId:'billing-client',customerId:'cus_alpha'}),json,provider.fetch),e=>e===503);assert.equal(provider.requests.length,0);
});

test('representative local task and Inbox reads report mixed-feed timings and exact pagination',async t=>{
 const f=await hubAuthFixture(createWorker);t.after(()=>f.close());f.login();
 await f.DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('perf-project','qa','own','Performance project',1)").run();
 const statements=[];
 for(let i=0;i<150;i++)statements.push(f.DB.prepare('INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at) VALUES(?,?,?,?,?,?,?)').bind('perf-message-'+i,'qa','perf-project','native-client','perf-request-'+i,'Synthetic project update '+i,1000+i));
 for(let i=0;i<20;i++)statements.push(f.DB.prepare('INSERT INTO tasks(id,organization_id,project_id,title,status,client_visible,revision,assignee_id,due_on,assignment_token,assigned_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind('perf-task-'+i,'qa','perf-project','Assigned task '+i,'todo',1,0,'native-staff','2020-01-01','assignment-'+i,1000+i));
 await f.DB.batch(statements);
 await f.DB.batch([
  ...Array.from({length:10},(_,i)=>f.DB.prepare('INSERT INTO project_message_reads(organization_id,actor_id,message_id,read_at) VALUES(?,?,?,?)').bind('qa','native-staff','perf-message-'+i,2000+i)),
  ...Array.from({length:5},(_,i)=>f.DB.prepare('INSERT INTO inbox_reads(organization_id,actor_id,kind,item_id,read_at) VALUES(?,?,?,?,?)').bind('qa','native-staff','assignment','assignment-'+i,2000+i)),
  ...Array.from({length:5},(_,i)=>f.DB.prepare('INSERT INTO inbox_reads(organization_id,actor_id,kind,item_id,read_at) VALUES(?,?,?,?,?)').bind('qa','native-staff','deadline','perf-task-'+i+'--2020-01-01',2000+i))
 ]);
 const samples=[];for(let i=0;i<6;i++){const start=performance.now();const response=await f.call('/api/tasks',{cookie:f.cookie});assert.equal(response.status,200);await response.arrayBuffer();samples.push(performance.now()-start);}
 const inboxSamples=[],summaryStart=performance.now();for(let i=0;i<4;i++){const start=performance.now();const inbox=await f.call('/api/inbox/summary',{cookie:f.cookie});assert.equal(inbox.status,200);const summary=await inbox.json();assert.equal(summary.unreadCount,170);inboxSamples.push(performance.now()-start);}const inboxMs=performance.now()-summaryStart;
 const ids=new Set(),pageSizes=[];let after=null;for(let page=0;page<10;page++){const path='/api/inbox?state=unread'+(after?'&after='+encodeURIComponent(after):''),response=await f.call(path,{cookie:f.cookie});assert.equal(response.status,200);const data=await response.json();pageSizes.push(data.items.length);for(const row of data.items)ids.add(row.kind+':'+row.id);if(!data.nextCursor){assert.equal(page,3);break;}after=data.nextCursor;assert.ok(after);}
 assert.equal(ids.size,170);assert.equal(pageSizes.reduce((sum,size)=>sum+size,0),170);assert.deepEqual([...pageSizes].sort((a,b)=>b-a),[50,50,50,20]);assert.equal([...ids].filter(id=>id.startsWith('message:')).length,140);assert.equal([...ids].filter(id=>id.startsWith('assignment:')).length,15);assert.equal([...ids].filter(id=>id.startsWith('deadline:')).length,15);
 const sorted=[...samples].sort((a,b)=>a-b),p95=sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)],inboxP95=[...inboxSamples].sort((a,b)=>a-b)[Math.min(inboxSamples.length-1,Math.ceil(inboxSamples.length*.95)-1)];assert.ok(samples.every(Number.isFinite));assert.ok(inboxSamples.every(Number.isFinite));
 t.diagnostic(`local task samples=${samples.map(value=>value.toFixed(1)).join(',')}ms p95=${p95.toFixed(1)}ms inbox summary samples=${inboxSamples.map(value=>value.toFixed(1)).join(',')}ms p95=${inboxP95.toFixed(1)}ms total=${inboxMs.toFixed(1)}ms pages=${pageSizes.join(',')}`);
});
