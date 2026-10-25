import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {generateKeyPair,SignJWT} from 'jose';

const load=async()=> (await import('./stripe-installments.mjs')).allocateInstallments;
const half=(n,d)=>(n*2n+d)/(d*2n);
function fixture(amounts=[101,202],rate=1300,deposit=null){
 const subtotalMinor=amounts.reduce((a,b)=>a+b,0),taxMinor=Number(half(BigInt(subtotalMinor)*BigInt(rate),10000n)),totalMinor=subtotalMinor+taxMinor;
 return {version:1,currency:'CAD',tax:{type:rate?'TAX':'NONE',rateBps:rate},dueOn:'2028-03-01',lines:amounts.map((n,i)=>({kind:'FIXED',description:'Source '+i,quantity:1,unitMinor:n,totalMinor:n})),subtotalMinor,taxMinor,totalMinor,installments:deposit===null?[{kind:'FULL',dueOn:'2028-03-01',amountMinor:totalMinor}]:[{kind:'DEPOSIT',dueOn:'2028-02-29',amountMinor:deposit},{kind:'BALANCE',dueOn:'2028-03-01',amountMinor:totalMinor-deposit}]};
}
function conservation(snapshot,result){
 assert.equal(result.installments.length,snapshot.installments.length);
 for(const [i,child] of result.installments.entries()){
  assert.equal(child.kind,snapshot.installments[i].kind);assert.equal(child.dueOn,snapshot.installments[i].dueOn);
  assert.equal(child.totalMinor,snapshot.installments[i].amountMinor);
  assert.equal(child.subtotalMinor+child.taxMinor,child.totalMinor);
  assert.equal(child.lines.reduce((s,l)=>s+BigInt(l.amountMinor),0n),BigInt(child.subtotalMinor));
  assert.equal(child.lines.reduce((s,l)=>s+BigInt(l.taxMinor),0n),BigInt(child.taxMinor));
  assert.equal(child.lines.length,snapshot.lines.length);
  for(const [j,line] of child.lines.entries()){assert.equal(line.index,j);assert.equal(line.sourceIndex,j);assert.ok(Number.isSafeInteger(line.amountMinor)&&line.amountMinor>=0);assert.ok(Number.isSafeInteger(line.taxMinor)&&line.taxMinor>=0);}
 }
 for(const key of ['subtotalMinor','taxMinor','totalMinor'])assert.equal(result.installments.reduce((n,c)=>n+BigInt(c[key]),0n),BigInt(snapshot[key]));
 let cumulative=0n,previousTax=0n;
 for(const [i,line] of snapshot.lines.entries()){
  cumulative+=BigInt(line.totalMinor);const tax=half(cumulative*BigInt(snapshot.tax.rateBps),10000n);
  assert.equal(result.installments.reduce((n,c)=>n+BigInt(c.lines[i].amountMinor),0n),BigInt(line.totalMinor));
  assert.equal(result.installments.reduce((n,c)=>n+BigInt(c.lines[i].taxMinor),0n),tax-previousTax);previousTax=tax;
 }
}
test('FULL preserves cumulative tax, zero lines and fixed descriptions',async()=>{
 const allocate=await load(),s=fixture([1,1,0,2],5000),r=allocate(s);conservation(s,r);
 assert.deepEqual(r.installments[0].lines.map(l=>l.taxMinor),[1,0,0,1]);
 assert.equal(r.installments[0].lines[0].description,'Source 0 (quantity 1)');assert.deepEqual(r.holds,[]);
});

test('durable installment schedules freeze exact reviewed parts without provider activation',async t=>{
 const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'durable-installments'},cf:false});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await DB.batch((await readFile(new URL('./migrations/'+name,import.meta.url),'utf8')).split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 const {publicKey,privateKey}=await generateKeyPair('RS256'),origin='https://installments.example.invalid',issuer='https://identity.cloudflareaccess.com',tokens={};
 for(const [id,org,role,client]of [['fin','a','staff',null],['staff','a','staff',null],['foreign','b','staff',null],['client','a','client','ca']]){const email=id+'@example.invalid';await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,email,org,role,client).run();tokens[id]=await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('schedule').setSubject(id).setIssuedAt().setExpirationTime('20m').sign(privateKey);}
 await DB.batch([DB.prepare("INSERT INTO actor_finance_access VALUES('fin','a'),('foreign','b')"),DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('ca','a','Fixture'),('ca2','a','Other client')"),DB.prepare("INSERT INTO projects(id,organization_id,client_id,name) VALUES('pa','a','ca','Fixture project')")]);
 const env={DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'schedule',STRIPE_MODE:'test',STRIPE_ORGANIZATION_ID:'a',STRIPE_ACCOUNT_ID:'acct_fixture',STRIPE_SECRET_KEY:['sk','test','fixture'].join('_')},requests=[];
 let providerHook=null;
 const worker=createWorker(publicKey,{stripeFetch:async(url,opts)=>{requests.push({url,method:opts.method});assert.equal(opts.method,'GET','freezing must never activate provider invoices');if(providerHook)await providerHook(url);return Response.json(url.endsWith('/account')?{id:'acct_fixture',object:'account'}:{id:'cus_fixture',object:'customer',livemode:false,name:'Fixture customer',email:null,currency:null});}});
 const call=(path,body,who='fin',method=body===undefined?'GET':'POST',bindings=env)=>worker.fetch(new Request(origin+'/api/'+path,{method,headers:{'cf-access-jwt-assertion':tokens[who],...(body===undefined?{}:{origin,'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}),bindings);
 const data=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
 const mapping=await data(await call('stripe/customers/preview',{clientId:'ca',customerId:'cus_fixture'}));await data(await call('stripe/customers',{clientId:'ca',customerId:'cus_fixture',clientRevision:0,requestId:crypto.randomUUID(),fingerprint:mapping.fingerprint,reason:'Reviewed fixture mapping'}),201);
 const future=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
 async function prepared(){
  const time=await data(await call('time/manual',{projectId:'pa',seconds:3600,workedOn:'2026-10-24',billable:true,description:'Schedule source'}),201),approved=await data(await call('time/details/'+time.id+'/approve',{revision:0,currency:'CAD',rateMinor:1000}));
  const input={clientId:'ca',projectId:'pa',title:'Durable schedule',currency:'CAD',tax:{type:'HST',rateBps:1300},dueOn:future(30),times:[{id:approved.id,revision:approved.revision}],charges:[{description:'Reviewed fixed work',quantity:1,unitMinor:10000}],deposit:{amountMinor:5000,dueOn:future(7)}};
  const preview=await data(await call('invoices/preview',input)),invoice=await data(await call('invoices',{...input,requestId:crypto.randomUUID(),fingerprint:preview.fingerprint}),201),plan=await data(await call('invoices/'+invoice.id+'/stripe-schedule-preview',{}));
  return {invoice,time,plan,path:'stripe/schedules/'+invoice.id,body:{requestId:crypto.randomUUID(),revision:invoice.revision,fingerprint:plan.fingerprint,reason:'Reviewed deposit and balance'}};
 }
 await t.test('freeze stores two immutable child plans and increments only the local parent revision',async()=>{
  const p=await prepared(),before=requests.length;let batchError=null;
  const response=await call(p.path,p.body,'fin','POST',{...env,DB:{prepare:sql=>DB.prepare(sql),async batch(statements){try{return await DB.batch(statements);}catch(error){batchError=error.message;throw error;}}}});
  if(response.status!==201){const counts=await DB.prepare('SELECT (SELECT revision FROM invoice_drafts WHERE id=?) parentRevision,(SELECT COUNT(*) FROM stripe_installment_schedules WHERE invoice_id=?) schedules,(SELECT COUNT(*) FROM stripe_installment_parts) parts,(SELECT COUNT(*) FROM stripe_installment_events) events').bind(p.invoice.id,p.invoice.id).first();assert.equal(response.status,201,JSON.stringify({response:await response.text(),batchError,...counts}));}
  const s=await data(response,201);
  assert.equal(s.invoiceId,p.invoice.id);assert.equal(s.state,'FROZEN');assert.equal(s.revision,0);assert.ok(s.id);assert.equal(s.parts.length,2);assert.notEqual(s.parts[0].id,s.parts[1].id);
  assert.deepEqual(s.plan,p.plan);assert.deepEqual(s.parts.map(v=>v.kind),['DEPOSIT','BALANCE']);assert.deepEqual(s.parts.map(v=>v.plan),p.plan.installments);
  const current=await data(await call('invoices/'+p.invoice.id));assert.equal(current.revision,p.invoice.revision+1);assert.equal(current.provider_state,'NOT_CONNECTED');assert.equal(current.stripe_invoice_id,null);
  assert.equal((await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(p.time.id).first()).invoice_ref,'workspace:'+p.invoice.id);
  assert.ok(requests.slice(before).every(v=>v.method==='GET'));assert.deepEqual(await data(await call(p.path)),s);
  const receipt=await data(await call(p.path+'/requests/'+p.body.requestId));assert.equal(receipt.state,'SAVED');assert.deepEqual(receipt.schedule,s);
  assert.deepEqual(await data(await call(p.path,p.body)),s);assert.deepEqual((await data(await call(p.path+'/requests/'+p.body.requestId+'/cancel',{}))).schedule,s);
 });
 const receiptPath=(p,key=p.body.requestId)=>p.path+'/requests/'+key;
 const abandonPath=s=>'stripe/schedules/'+s.invoiceId+'/'+s.id+'/abandon';
 function beforeScheduleBatch(change){
  let fired=false;const sqls=new WeakMap();return {get fired(){return fired;},bindings:{...env,DB:{prepare(sql){const statement=DB.prepare(sql);sqls.set(statement,sql);return new Proxy(statement,{get(target,key){if(key==='bind')return(...values)=>{const bound=target.bind(...values);sqls.set(bound,sql);return bound;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});},async batch(statements){if(!fired&&statements.some(s=>/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+stripe_installment_(schedules|parts|events)\b/i.test(sqls.get(s)||''))){fired=true;await change();}return DB.batch(statements);}}}};
 }
 const unpublished=async p=>{assert.equal((await DB.prepare('SELECT COUNT(*) n FROM stripe_installment_schedules WHERE invoice_id=?').bind(p.invoice.id).first()).n,0);assert.equal((await data(await call('invoices/'+p.invoice.id))).revision,p.invoice.revision);assert.equal((await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(p.time.id).first()).invoice_ref,'workspace:'+p.invoice.id);};
 await t.test('same request concurrent retries produce one stable schedule and two stable parts',async()=>{
  const p=await prepared(),responses=await Promise.all([call(p.path,p.body),call(p.path,p.body)]);assert.ok(responses.every(r=>[200,201].includes(r.status)));const values=await Promise.all(responses.map(r=>r.json()));assert.deepEqual(values[0],values[1]);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM stripe_installment_schedules WHERE invoice_id=?').bind(p.invoice.id).first()).n,1);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM stripe_installment_parts WHERE schedule_id=?').bind(values[0].id).first()).n,2);
 });
 await t.test('different keys cannot freeze overlapping active schedules or reuse another reviewed invoice',async()=>{
  const p=await prepared(),q=await prepared(),s=await data(await call(p.path,p.body),201);assert.equal((await call(p.path,{...p.body,requestId:crypto.randomUUID()})).status,409);assert.equal((await call(q.path,{...q.body,requestId:p.body.requestId})).status,409);assert.equal((await data(await call(p.path))).id,s.id);
 });
 await t.test('cancellation tombstone defeats a delayed freeze and leaves existing claims unchanged',async()=>{
  const p=await prepared();assert.deepEqual(await data(await call(receiptPath(p))),{state:'UNKNOWN'});assert.equal((await data(await call(receiptPath(p)+'/cancel',{}))).state,'CANCELLED');assert.equal((await call(p.path,p.body)).status,409);await unpublished(p);
  const q=await prepared(),hook=beforeScheduleBatch(async()=>{await data(await call(receiptPath(q)+'/cancel',{}));});assert.equal((await call(q.path,q.body,'fin','POST',hook.bindings)).status,409);assert.equal(hook.fired,true);await unpublished(q);
 });
 await t.test('abandon preserves the old receipt and permits a newly reviewed replacement schedule',async()=>{
  const p=await prepared(),s=await data(await call(p.path,p.body),201),abandoned=await data(await call(abandonPath(s),{revision:s.revision,reason:'Rework local schedule'}));assert.equal(abandoned.state,'ABANDONED');assert.equal(abandoned.revision,s.revision+1);assert.equal((await data(await call(receiptPath(p)))).schedule.state,'ABANDONED');assert.equal((await data(await call(p.path,p.body))).state,'ABANDONED');
  const invoice=await data(await call('invoices/'+p.invoice.id));assert.equal(invoice.revision,p.invoice.revision+2);const plan=await data(await call('invoices/'+invoice.id+'/stripe-schedule-preview',{})),next=await data(await call(p.path,{...p.body,requestId:crypto.randomUUID(),revision:invoice.revision,fingerprint:plan.fingerprint}),201);assert.notEqual(next.id,s.id);
 });
 await t.test('active schedules block local void while abandonment allows existing claim release',async()=>{
  const p=await prepared(),s=await data(await call(p.path,p.body),201);let invoice=await data(await call('invoices/'+p.invoice.id));assert.equal((await call('invoices/'+invoice.id+'/void',{revision:invoice.revision,reason:'Still frozen'})).status,409);
  await data(await call(abandonPath(s),{revision:s.revision,reason:'Cancel unactivated schedule'}));invoice=await data(await call('invoices/'+p.invoice.id));await data(await call('invoices/'+invoice.id+'/void',{revision:invoice.revision,reason:'Review local claim release'}));
  assert.equal((await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(p.time.id).first()).invoice_ref,'workspace:'+invoice.id);assert.equal((await call('invoices/'+invoice.id+'/release-preview')).status,409);
  const now=Date.now,future=now()+11000;Date.now=()=>future;try{const release=await data(await call('invoices/'+invoice.id+'/release-preview'));await data(await call('invoices/'+invoice.id+'/release',{revision:release.revision,fingerprint:release.fingerprint}));assert.equal((await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(p.time.id).first()).invoice_ref,null);}finally{Date.now=now;}
  const before=requests.length;for(const value of [await data(await call(p.path)),(await data(await call(receiptPath(p)))).schedule,await data(await call(p.path,p.body))]){assert.equal(value.id,s.id);assert.equal(value.state,'ABANDONED');assert.deepEqual(value.parts,s.parts);assert.deepEqual(value.plan,s.plan);}assert.equal(requests.length,before,'historical receipts must not consult or activate the provider');
 });
 await t.test('unknown or activated schedules cannot be abandoned',async()=>{
  const p=await prepared();assert.equal((await call(p.path+'/'+crypto.randomUUID()+'/abandon',{revision:0,reason:'Unknown'})).status,404);const s=await data(await call(p.path,p.body),201);await DB.prepare('UPDATE stripe_installment_schedules SET activated_at=? WHERE id=?').bind(Date.now(),s.id).run();assert.equal((await call(abandonPath(s),{revision:s.revision,reason:'Already activated'})).status,409);
 });
 await t.test('finance, tenant, strict methods and inputs protect all schedule paths',async()=>{
  const p=await prepared();for(const who of ['staff','client'])for(const [path,body]of [[p.path,p.body],[p.path,undefined],[receiptPath(p),undefined],[receiptPath(p)+'/cancel',{}]])assert.equal((await call(path,body,who)).status,403);
  assert.equal((await call(p.path,undefined,'foreign')).status,404);assert.equal((await call(p.path,p.body,'foreign')).status,404);assert.equal((await call(p.path,p.body,'fin','PUT')).status,405);assert.equal((await call(p.path+'?extra=1',p.body)).status,400);
  for(const body of [{...p.body,extra:true},{...p.body,revision:-1},{...p.body,requestId:'bad'},{...p.body,reason:''},{...p.body,fingerprint:'bad'}])assert.equal((await call(p.path,body)).status,400);await unpublished(p);
 });
 await t.test('late finance revocation rolls back every schedule and parent projection',async()=>{
  const p=await prepared(),hook=beforeScheduleBatch(()=>DB.prepare("DELETE FROM actor_finance_access WHERE id='fin'").run());try{assert.equal((await call(p.path,p.body,'fin','POST',hook.bindings)).status,403);assert.equal(hook.fired,true);}finally{await DB.prepare("INSERT OR IGNORE INTO actor_finance_access VALUES('fin','a')").run();}await unpublished(p);
 });
 await t.test('late canonical scope, parent revision, source claim and audit changes cannot publish',async()=>{
  for(const kind of ['project','revision','claim','audit']){
   const p=await prepared();
   const hook=beforeScheduleBatch(async()=>{if(kind==='project')await DB.prepare("UPDATE projects SET client_id='ca2' WHERE id='pa'").run();if(kind==='revision')await DB.prepare('UPDATE invoice_drafts SET revision=revision+1 WHERE id=?').bind(p.invoice.id).run();if(kind==='claim')await DB.prepare('UPDATE time_details SET invoice_ref=NULL WHERE id=?').bind(p.time.id).run();if(kind==='audit')await DB.prepare('DELETE FROM time_billing_events WHERE time_id=?').bind(p.time.id).run();});
   try{assert.ok([409,503].includes((await call(p.path,p.body,'fin','POST',hook.bindings)).status),kind);assert.equal(hook.fired,true);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM stripe_installment_schedules WHERE invoice_id=?').bind(p.invoice.id).first()).n,0,kind);}finally{if(kind==='project')await DB.prepare("UPDATE projects SET client_id='ca' WHERE id='pa'").run();}
  }
 });
 await t.test('configuration changing during provider review cannot freeze the obsolete plan',async()=>{
  const p=await prepared(),old=env.STRIPE_ACCOUNT_ID;providerHook=async()=>{env.STRIPE_ACCOUNT_ID='acct_changed';};try{assert.ok([409,503].includes((await call(p.path,p.body)).status));}finally{env.STRIPE_ACCOUNT_ID=old;providerHook=null;}await unpublished(p);
 });
 await t.test('saved history cancellation and unactivated abandonment remain local with provider disabled',async()=>{
  const p=await prepared(),s=await data(await call(p.path,p.body),201),before=requests.length,disabled={...env,STRIPE_MODE:undefined,STRIPE_SECRET_KEY:undefined};
  assert.equal((await data(await call(p.path,undefined,'fin','GET',disabled))).id,s.id);assert.equal((await data(await call(receiptPath(p),undefined,'fin','GET',disabled))).state,'SAVED');
  assert.equal((await data(await call(receiptPath(p)+'/cancel',{},'fin','POST',disabled))).state,'SAVED');assert.equal((await data(await call(abandonPath(s),{revision:s.revision,reason:'Local only abandonment'},'fin','POST',disabled))).state,'ABANDONED');assert.equal(requests.length,before);
 });
 await t.test('a receipt key cannot be read or cancelled under another parent invoice',async()=>{
  const p=await prepared(),q=await prepared();await data(await call(p.path,p.body),201);for(const suffix of ['', '/cancel'])assert.equal((await call(receiptPath(q,p.body.requestId)+suffix,suffix?{}:undefined)).status,409);
 });
 await t.test('missing journal child or parent projection fails closed and cannot partially abandon',async()=>{
  for(const kind of ['journal','part','projection']){
   const p=await prepared(),s=await data(await call(p.path,p.body),201),parent=await data(await call('invoices/'+p.invoice.id));
   if(kind==='journal')await DB.prepare('DELETE FROM stripe_installment_events WHERE schedule_id=?').bind(s.id).run();
   if(kind==='part')await DB.prepare('DELETE FROM stripe_installment_parts WHERE id=?').bind(s.parts[0].id).run();
   if(kind==='projection')await DB.prepare('UPDATE invoice_drafts SET revision=revision+1 WHERE id=?').bind(p.invoice.id).run();
   const before=(await DB.prepare('SELECT revision FROM invoice_drafts WHERE id=?').bind(p.invoice.id).first()).revision;
   for(const path of [p.path,receiptPath(p)])assert.ok([409,503].includes((await call(path)).status),kind);
   assert.ok([409,503].includes((await call(abandonPath(s),{revision:s.revision,reason:'Must remain atomic'})).status),kind);
   assert.equal((await DB.prepare('SELECT state,revision FROM stripe_installment_schedules WHERE id=?').bind(s.id).first()).state,'FROZEN',kind);assert.equal((await DB.prepare('SELECT revision FROM invoice_drafts WHERE id=?').bind(p.invoice.id).first()).revision,before,kind);
   assert.equal((await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(p.time.id).first()).invoice_ref,'workspace:'+p.invoice.id);assert.ok(before>=parent.revision);
  }
 });
 await t.test('an omitted child journal or parent update rolls the complete freeze transaction back',async()=>{
  for(const kind of ['part','journal','projection']){
   const p=await prepared(),sqls=new WeakMap();let fired=false;
   const bindings={...env,DB:{prepare(sql){const statement=DB.prepare(sql);return new Proxy(statement,{get(target,key){if(key==='bind')return(...values)=>{const bound=target.bind(...values);sqls.set(bound,sql);return bound;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});},async batch(statements){
    const match=kind==='part'?/INSERT\s+INTO\s+stripe_installment_parts\b/i:kind==='journal'?/INSERT\s+INTO\s+stripe_installment_events\b/i:/UPDATE\s+invoice_drafts\b/i;
    const index=fired?-1:statements.findIndex(s=>match.test(sqls.get(s)||''));if(index>=0){fired=true;return DB.batch(statements.filter((_,i)=>i!==index));}return DB.batch(statements);
   }}};
   assert.ok([409,503].includes((await call(p.path,p.body,'fin','POST',bindings)).status),kind);assert.equal(fired,true,kind);await unpublished(p);
   assert.equal((await DB.prepare('SELECT COUNT(*) n FROM stripe_installment_parts WHERE schedule_id IN (SELECT id FROM stripe_installment_schedules WHERE invoice_id=?)').bind(p.invoice.id).first()).n,0);
  }
 });
 await t.test('the original FREEZE actor and image remain bound after a valid abandonment journal',async()=>{
  const p=await prepared(),s=await data(await call(p.path,p.body),201);await data(await call(abandonPath(s),{revision:s.revision,reason:'Keep both journal images'}));
  const event=await DB.prepare('SELECT * FROM stripe_installment_events WHERE schedule_id=? AND revision=0').bind(s.id).first();
  for(const kind of ['actor','image']){try{if(kind==='actor')await DB.prepare("UPDATE stripe_installment_events SET actor_id='staff' WHERE id=?").bind(event.id).run();else{const image=JSON.parse(event.state_json);image.reason='Altered original reason';await DB.prepare('UPDATE stripe_installment_events SET state_json=? WHERE id=?').bind(JSON.stringify(image),event.id).run();}assert.equal((await call(receiptPath(p))).status,503,kind);}finally{await DB.prepare('UPDATE stripe_installment_events SET actor_id=?,state_json=? WHERE id=?').bind(event.actor_id,event.state_json,event.id).run();}}
 });
 await t.test('literal client and project renames preserve frozen history and local abandonment',async()=>{
  const p=await prepared(),s=await data(await call(p.path,p.body),201),before=requests.length;
  await DB.batch([DB.prepare("UPDATE clients SET name='Renamed client',revision=revision+1 WHERE id='ca'"),DB.prepare("UPDATE projects SET name='Renamed project',revision=revision+1 WHERE id='pa'")]);
  try{
   const reads=[await call(p.path),await call(receiptPath(p)),await call(receiptPath(p)+'/cancel',{})],abandon=await call(abandonPath(s),{revision:s.revision,reason:'Abandon after harmless rename'});
   assert.deepEqual([...reads,abandon].map(r=>r.status),[200,200,200,200]);
   const history=await reads[0].json();assert.deepEqual(history.plan,s.plan);assert.deepEqual(history.parts,s.parts);assert.equal((await abandon.json()).state,'ABANDONED');assert.equal(requests.length,before,'local history and abandonment do not call the provider');
   assert.equal((await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(p.time.id).first()).invoice_ref,'workspace:'+p.invoice.id);
  }finally{await DB.batch([DB.prepare("UPDATE clients SET name='Fixture',revision=revision-1 WHERE id='ca'"),DB.prepare("UPDATE projects SET name='Fixture project',revision=revision-1 WHERE id='pa'")]);}
 });
 await t.test('a customer mapping changed at the freeze commit boundary cannot publish the old plan',async()=>{
  const p=await prepared(),hook=beforeScheduleBatch(()=>DB.prepare("UPDATE stripe_customer_links SET customer_id='cus_changed' WHERE client_id='ca' AND organization_id='a'").run());
  try{const result=await call(p.path,p.body,'fin','POST',hook.bindings);assert.equal(hook.fired,true);assert.equal(result.status,409);await unpublished(p);}finally{await DB.prepare("UPDATE stripe_customer_links SET customer_id='cus_fixture' WHERE client_id='ca' AND organization_id='a'").run();}
 });
 await t.test('released historical schedules still require the original immutable CLAIM audit',async()=>{
  const p=await prepared(),s=await data(await call(p.path,p.body),201);await data(await call(abandonPath(s),{revision:s.revision,reason:'Release historical claim'}));const parent=await data(await call('invoices/'+p.invoice.id));await data(await call('invoices/'+p.invoice.id+'/void',{revision:parent.revision,reason:'Release reviewed source'}));
  const now=Date.now,future=now()+11000;Date.now=()=>future;try{const release=await data(await call('invoices/'+p.invoice.id+'/release-preview'));await data(await call('invoices/'+p.invoice.id+'/release',{revision:release.revision,fingerprint:release.fingerprint}));}finally{Date.now=now;}
  assert.equal((await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(p.time.id).first()).invoice_ref,null);
  const removed=await DB.prepare("DELETE FROM time_billing_events WHERE invoice_id=? AND action='CLAIM' RETURNING id").bind(p.invoice.id).all();assert.equal(removed.results.length,1);
  const before=requests.length,responses=[await call(p.path),await call(receiptPath(p)),await call(p.path,p.body)];assert.equal(requests.length,before);assert.ok(responses.every(r=>[409,503].includes(r.status)),JSON.stringify(responses.map(r=>r.status)));
 });
 await t.test('local frozen reads and abandonment retain exact time rate claim and billing audit checks',async()=>{
  for(const kind of ['seconds','rate','claim','audit']){
   const p=await prepared(),s=await data(await call(p.path,p.body),201),parentRevision=(await data(await call('invoices/'+p.invoice.id))).revision;
   if(kind==='seconds')await DB.prepare('UPDATE time_entries SET seconds=seconds+1 WHERE id=?').bind(p.time.id).run();
   if(kind==='rate')await DB.prepare('UPDATE time_details SET rate_minor=rate_minor+1 WHERE id=?').bind(p.time.id).run();
   if(kind==='claim')await DB.prepare('UPDATE time_details SET invoice_ref=NULL WHERE id=?').bind(p.time.id).run();
   if(kind==='audit')await DB.prepare("DELETE FROM time_billing_events WHERE invoice_id=? AND action='CLAIM'").bind(p.invoice.id).run();
   const before=requests.length,responses=[await call(p.path),await call(receiptPath(p)),await call(abandonPath(s),{revision:s.revision,reason:'Reject changed '+kind})];assert.ok(responses.every(r=>[409,503].includes(r.status)),kind+':'+JSON.stringify(responses.map(r=>r.status)));assert.equal(requests.length,before);
   assert.equal((await DB.prepare('SELECT state FROM stripe_installment_schedules WHERE id=?').bind(s.id).first()).state,'FROZEN');assert.equal((await DB.prepare('SELECT revision FROM invoice_drafts WHERE id=?').bind(p.invoice.id).first()).revision,parentRevision);
  }
 });
 await t.test('native part constraints reject absent kind and monetary fields instead of accepting SQL NULL',async()=>{
  const p=await prepared(),s=await data(await call(p.path,p.body),201),part=await DB.prepare('SELECT * FROM stripe_installment_parts WHERE id=?').bind(s.parts[0].id).first(),rejected=[];
  await DB.prepare('UPDATE stripe_installment_parts SET plan_json=? WHERE id=?').bind(part.plan_json,part.id).run();
  for(const field of ['kind','totalMinor','taxMinor','subtotalMinor']){
   try{await DB.prepare('UPDATE stripe_installment_parts SET plan_json=json_remove(plan_json,?) WHERE id=?').bind('$.'+field,part.id).run();rejected.push(false);}catch(error){assert.match(error.message,/CHECK constraint failed/i);rejected.push(true);}finally{await DB.prepare('UPDATE stripe_installment_parts SET plan_json=? WHERE id=?').bind(part.plan_json,part.id).run();}
  }
  assert.deepEqual(rejected,[true,true,true,true]);assert.deepEqual((await data(await call(p.path))).parts,s.parts);
 });
 await t.test('abandonment rolls back if its original journal or reviewed schedule changes at commit',async()=>{
  const results=[];
  for(const kind of ['journal','reason']){
   const p=await prepared(),s=await data(await call(p.path,p.body),201),revision=(await data(await call('invoices/'+p.invoice.id))).revision;
   const hook=beforeScheduleBatch(async()=>{if(kind==='journal')await DB.prepare('DELETE FROM stripe_installment_events WHERE schedule_id=? AND revision=0').bind(s.id).run();else await DB.prepare('UPDATE stripe_installment_schedules SET reason=? WHERE id=?').bind('Changed after abandonment review',s.id).run();});
   const response=await call(abandonPath(s),{revision:s.revision,reason:'Cannot abandon changed journal'},'fin','POST',hook.bindings);assert.equal(hook.fired,true,kind);
   const row=await DB.prepare('SELECT state,revision FROM stripe_installment_schedules WHERE id=?').bind(s.id).first(),parent=await DB.prepare('SELECT revision FROM invoice_drafts WHERE id=?').bind(p.invoice.id).first(),claim=await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(p.time.id).first();
   results.push({kind,denied:[409,503].includes(response.status),state:row.state,revision:row.revision,parentRevision:parent.revision,claim:claim.invoice_ref,expectedParentRevision:revision,expectedClaim:'workspace:'+p.invoice.id});
  }
  for(const result of results){assert.equal(result.denied,true,result.kind);assert.equal(result.state,'FROZEN',JSON.stringify(result));assert.equal(result.revision,0,result.kind);assert.equal(result.parentRevision,result.expectedParentRevision,result.kind);assert.equal(result.claim,result.expectedClaim,result.kind);}
 });
});
test('deposit uses cumulative gross allocation and exact residual balance',async()=>{
 const allocate=await load(),s=fixture([101,202],1300,100),r=allocate(s);conservation(s,r);
 assert.deepEqual(r.installments[0].lines.map(l=>[l.amountMinor,l.taxMinor]),[[29,4],[59,8]]);
 assert.deepEqual(r.installments[1].lines.map(l=>[l.amountMinor,l.taxMinor]),[[72,9],[143,18]]);
});
test('tax-only penny is retained and explicitly held for provider review',async()=>{
 const allocate=await load(),s=fixture([1],5000,1),r=allocate(s);conservation(s,r);
 assert.deepEqual(r.installments[0].lines[0],{index:0,description:'Source 0 (quantity 1)',sourceIndex:0,amountMinor:0,taxMinor:1});
 assert.deepEqual(r.holds,[{code:'TAX_ONLY_LINE_REVIEW_REQUIRED',kind:'DEPOSIT',sourceIndex:0}]);
});
test('time lineage and existing rounded time amounts are preserved',async()=>{
 const allocate=await load(),s=fixture([1],0);s.lines=[{kind:'TIME',description:'Approved work',totalMinor:1,source:{id:'time-1',seconds:1,rateMinor:1800}}];
 const r=allocate(s);conservation(s,r);assert.equal(r.installments[0].lines[0].description,'Approved work');
});
test('maximum safe totals use exact BigInt products without floating point loss',async()=>{
 const allocate=await load(),s=fixture([Number.MAX_SAFE_INTEGER-2,2],0,4503599627370495),r=allocate(s);conservation(s,r);
 assert.equal(r.installments[0].lines[0].amountMinor,4503599627370494);
});
test('all tiny schedules conserve each source subtotal and tax',async()=>{
 const allocate=await load();for(const rate of [0,1,500,1300,5000])for(let a=0;a<6;a++)for(let b=1;b<6;b++){
  const base=fixture([a,b],rate);for(let d=1;d<base.totalMinor;d++){const s=fixture([a,b],rate,d);conservation(s,allocate(s));}
 }
});
test('allocation is deterministic and leaves deeply frozen source snapshots unchanged',async()=>{
 const allocate=await load(),s=fixture([1,202],1300,35),before=JSON.stringify(s);
 const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}};freeze(s);
 assert.deepEqual(allocate(s),allocate(s));assert.equal(JSON.stringify(s),before);
});
test('malformed snapshot totals, rates, lines, dates and schedules fail closed with 409',async()=>{
 const allocate=await load();const changes=[
  s=>s.version=2,s=>s.subtotalMinor++,s=>s.taxMinor++,s=>s.totalMinor++,s=>s.tax.rateBps=5001,s=>s.tax.rateBps=0.5,s=>s.tax.type='UNKNOWN',s=>s.tax.type='NONE',
  s=>s.lines=[],s=>s.lines[0].totalMinor=-1,s=>s.lines[0].totalMinor=1.2,s=>s.lines[0].unitMinor++,s=>s.lines[0].quantity=0,s=>s.lines[0].description='',s=>s.lines[0].kind='UNKNOWN',
  s=>s.dueOn='2027-02-29',s=>s.installments[0].dueOn='2028-03-02',s=>s.installments[0].amountMinor++,s=>s.installments.push({...s.installments[0]}),
  s=>s.lines[0]={kind:'TIME',description:'Work',totalMinor:101,source:{seconds:1,rateMinor:1}},s=>s.totalMinor=Number.MAX_SAFE_INTEGER+1
 ];
 for(const change of changes){const s=fixture();change(s);assert.throws(()=>allocate(s),e=>e===409,String(change));}
 for(const bad of [null,[],{},'snapshot'])assert.throws(()=>allocate(bad),e=>e===409);
 for(const change of [s=>s.installments.reverse(),s=>s.installments[0].amountMinor=0,s=>s.installments[1].amountMinor++,s=>s.installments[0].dueOn=s.dueOn,s=>s.installments[1].kind='FULL']){
  const s=fixture([101,202],1300,100);change(s);assert.throws(()=>allocate(s),e=>e===409);
 }
});
