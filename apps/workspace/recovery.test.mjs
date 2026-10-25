import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localStore,exportDatabase,importDatabase,databaseImage,captureObjects,restoreObjects,verifyObjects} from './recovery-local.mjs';

test('native local D1 SQL export restores exact schema and literal data into separate storage',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ashbi-recovery-'));
 const source=await localStore(join(root,'source'));t.after(()=>source.dispose());
 await source.env.DB.exec('CREATE TABLE probe(id TEXT PRIMARY KEY, literal TEXT NOT NULL, exact INTEGER NOT NULL)');
 const literal='café; "quoted"\nline two — preserved';
 await source.env.DB.prepare('INSERT INTO probe VALUES(?,?,?)').bind('one',literal,Number.MAX_SAFE_INTEGER).run();
 await source.env.DB.batch(Array.from({length:125},(_,i)=>source.env.DB.prepare('INSERT INTO probe VALUES(?,?,?)').bind('history-'+i,literal,Number.MAX_SAFE_INTEGER)));
 await source.env.DB.exec('CREATE TABLE acf_probe(id INTEGER PRIMARY KEY, empty TEXT, zero INTEGER)');
 await source.env.DB.prepare('INSERT INTO acf_probe VALUES(?,?,?)').bind(1,null,0).run();
 const image=await databaseImage(source.env.DB);assert.equal(image.tables.probe.length,126);assert.deepEqual(image.tables.acf_probe,[{id:1,empty:null,zero:0}]);
 await source.env.DB.prepare('UPDATE probe SET exact=9007199254740993').run();
 await assert.rejects(()=>databaseImage(source.env.DB),/unsafe numeric image/);
 await source.env.DB.prepare('UPDATE probe SET exact=?').bind(Number.MAX_SAFE_INTEGER).run();
 const sql=await exportDatabase(source);
 const restored=await importDatabase(join(root,'restored'),sql);t.after(()=>restored.dispose());
 assert.notEqual(source.path,restored.path);
 await assert.rejects(()=>localStore(restored.path),{code:'EEXIST'});
 assert.deepEqual(await databaseImage(restored.env.DB),image);
 assert.equal((await restored.env.DB.prepare('SELECT * FROM probe').first()).literal,literal);
 assert.equal((await restored.env.DB.prepare('SELECT * FROM probe').first()).exact,Number.MAX_SAFE_INTEGER);
});

import {seedRecoveryWorkspace} from './recovery-fixture.mjs';
import {makePilotFixture} from './pilot-source-fixture.mjs';
import {reconcilePilot} from './pilot-reconcile.mjs';
import {applySourcePilot,readSourcePilot,readSourceObject} from './source-pilot.mjs';
const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');

test('complete native D1 and private R2 recovery retains the joined workspace, evidence and external idempotency',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ashbi-workspace-recovery-'));
 const source=await localStore(join(root,'source'));t.after(()=>source.dispose());
 for(const name of(await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
  // Static committed migrations only. Native exported SQL is always imported
  // by Wrangler, never split on semicolons or replayed as migrations.
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');
  await source.env.DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>source.env.DB.prepare(s)));
 }
 const fixture=await seedRecoveryWorkspace({...source.env,createWorker}),{call,records:r,expected:e,provider}=fixture;
 const data=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
 const posts=()=>provider.requests.filter(p=>p.method==='POST');
 async function uncertainInvoice(title){
  const body={clientId:r.client.id,projectId:r.project.id,title,currency:'CAD',tax:{type:'NONE',rateBps:0},dueOn:new Date(Date.now()+30*86400000).toISOString().slice(0,10),times:[],charges:[{description:'Synthetic recovery work',quantity:1,unitMinor:1200}]};
  const preview=await data(await call('invoices/preview',body)),invoice=await data(await call('invoices',{...body,requestId:crypto.randomUUID(),fingerprint:preview.fingerprint}),201);
  const draftPreview=await data(await call('invoices/'+invoice.id+'/stripe-preview',{})),creation=await data(await call('invoices/'+invoice.id+'/stripe',{requestId:crypto.randomUUID(),revision:invoice.revision,fingerprint:draftPreview.fingerprint,reason:'Synthetic recovery draft'}),201);
  const issuancePreview=await data(await call('invoices/'+invoice.id+'/stripe/finalize-preview',{})),intent={requestId:crypto.randomUUID(),revision:issuancePreview.invoiceRevision,fingerprint:issuancePreview.fingerprint,reason:'Synthetic recovery issuance'};
  provider.failFinalizeBefore=true;
  const response=await call('invoices/'+invoice.id+'/stripe/finalize',intent);assert.ok([201,202].includes(response.status),await response.clone().text());
  const operation=await response.json();assert.equal(operation.state,'UNKNOWN');
  const row=await source.env.DB.prepare('SELECT * FROM stripe_invoice_issuance_operations WHERE invoice_id=?').bind(invoice.id).first();
  return {invoice,creation,intent,operation,row,path:'invoices/'+invoice.id+'/stripe/finalize'};
 }
 const externallyFinished=await uncertainInvoice('Provider advances after checkpoint'),retryable=await uncertainInvoice('Same original retry key'),leased=await uncertainInvoice('Lease survives recovery');
 const leaseUntil=Date.now()+300000;await source.env.DB.prepare('UPDATE stripe_invoice_issuance_operations SET lease_token=?,lease_until=? WHERE id=?').bind('synthetic-active-lease',leaseUntil,leased.row.id).run();

 // New schedule reservations are application records; native restore must retain
 // their separate identities, frozen review images, keys and source locks too.
 const scheduleFuture=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
 async function scheduleInvoice(title,{withTime=false}={}){
  let approved=null;if(withTime){const time=await data(await call('time/manual',{projectId:r.project.id,seconds:1800,workedOn:'2026-10-24',billable:true,description:'Reserved installment work'}),201);approved=await data(await call('time/details/'+time.id+'/approve',{revision:0,currency:'CAD',rateMinor:1000}));}
  const body={clientId:r.client.id,projectId:r.project.id,title,currency:'CAD',tax:{type:'HST',rateBps:1300},dueOn:scheduleFuture(30),times:approved?[{id:approved.id,revision:approved.revision}]:[],charges:[{description:'Frozen installment work',quantity:1,unitMinor:1300}],deposit:{amountMinor:700,dueOn:scheduleFuture(7)}},preview=await data(await call('invoices/preview',body)),invoice=await data(await call('invoices',{...body,requestId:crypto.randomUUID(),fingerprint:preview.fingerprint}),201),plan=await data(await call('invoices/'+invoice.id+'/stripe-schedule-preview',{}));
  return {invoice,approved,path:'stripe/schedules/'+invoice.id,body:{requestId:crypto.randomUUID(),revision:invoice.revision,fingerprint:plan.fingerprint,reason:'Synthetic recovery schedule review'}};
 }
 const reservedInput=await scheduleInvoice('Frozen reservation survives recovery',{withTime:true}),reserved=await data(await call(reservedInput.path,reservedInput.body),201);
 const cancelledScheduleInput=await scheduleInvoice('Cancelled late schedule request'),cancelledSchedule=await data(await call(cancelledScheduleInput.path+'/requests/'+cancelledScheduleInput.body.requestId+'/cancel',{}));assert.equal(cancelledSchedule.state,'CANCELLED');
 const abandonedInput=await scheduleInvoice('Abandoned schedule history'),abandonedInitial=await data(await call(abandonedInput.path,abandonedInput.body),201),abandoned=await data(await call(abandonedInput.path+'/'+abandonedInitial.id+'/abandon',{revision:abandonedInitial.revision,reason:'Reviewed before provider activation'}));assert.equal(abandoned.state,'ABANDONED');

 // External child drafts survive independently of the database checkpoint.
 const childInput=await scheduleInvoice('Child drafts checkpoint',{withTime:true}),childSchedule=await data(await call(childInput.path,childInput.body),201);
 const childPath=part=>childInput.path+'/parts/'+part.id+'/draft',childBody=part=>({requestId:crypto.randomUUID(),revision:childSchedule.revision,fingerprint:part.plan.fingerprint,reason:'Synthetic part draft'});
 const depositBody=childBody(childSchedule.parts[0]),depositPath=childPath(childSchedule.parts[0]),deposit=await data(await call(depositPath,depositBody),201),balancePath=childPath(childSchedule.parts[1]),cancelledPartBody=childBody(childSchedule.parts[1]);
 await data(await call(balancePath+'/requests/'+cancelledPartBody.requestId+'/cancel',{}));
 const balanceBody=childBody(childSchedule.parts[1]);provider.loseCreate=true;const balance=await data(await call(balancePath,balanceBody),202);assert.equal(balance.state,'UNKNOWN');
 const balanceRow=await source.env.DB.prepare('SELECT * FROM stripe_part_operations WHERE id=?').bind(balance.id).first();
 const leasedChildInput=await scheduleInvoice('Child lease checkpoint'),leasedChildSchedule=await data(await call(leasedChildInput.path,leasedChildInput.body),201),leasedChildPath=leasedChildInput.path+'/parts/'+leasedChildSchedule.parts[0].id+'/draft',leasedChildBody={requestId:crypto.randomUUID(),revision:leasedChildSchedule.revision,fingerprint:leasedChildSchedule.parts[0].plan.fingerprint,reason:'Original child lease'};
 provider.loseCreate=true;const leasedChild=await data(await call(leasedChildPath,leasedChildBody),202);assert.equal(leasedChild.state,'UNKNOWN');const childLeaseUntil=Date.now()+300000;
 await source.env.DB.prepare('UPDATE stripe_part_operations SET lease_token=?,lease_until=? WHERE id=?').bind('synthetic-child-lease',childLeaseUntil,leasedChild.id).run();const leasedChildRow=await source.env.DB.prepare('SELECT * FROM stripe_part_operations WHERE id=?').bind(leasedChild.id).first();

 // Inventory staged orphans and zero-length objects too, not only ready DB rows.
 await source.env.FILES.put('unreferenced/café; staged.bin',new Uint8Array([0,17,255]),{httpMetadata:{contentType:'application/octet-stream',contentDisposition:'attachment; filename="staged.bin"',cacheControl:'private, no-store',cacheExpiry:new Date('2030-01-02T00:00:00Z')},customMetadata:{owner:'synthetic',literal:'café; "quoted"'}});
 await source.env.FILES.put('unreferenced/empty',new Uint8Array(),{customMetadata:{state:'pending'}});
 const checkpoint=join(root,'synthetic-checkpoint.json'),keyFile=join(root,'synthetic-keyring.json');
 await writeFile(checkpoint,JSON.stringify({image:await databaseImage(source.env.DB),objects:await captureObjects(source.env.FILES)}));
 // Synthetic keys are separate from database/object images. Real restore
 // credentials and historical signing keys require separate management.
 await writeFile(keyFile,JSON.stringify({active:'journey',keys:fixture.keyRing}),{mode:0o600});
 const {image,objects}=JSON.parse(await readFile(checkpoint,'utf8'));
 for(const key of Object.values(fixture.keyRing))assert.equal((await readFile(checkpoint,'utf8')).includes(key),false);
 assert.equal(Object.keys(image.tables).length,52);assert.equal(image.schema.filter(s=>s.type==='index').length,39);assert.equal(objects.length,6);
 const sql=await exportDatabase(source);
 // External Stripe state is deliberately NOT restored with our D1/R2 image.
 const externalFinalize=provider.requests.findLast(p=>p.method==='POST'&&p.path==='/v1/invoices/'+externallyFinished.creation.stripeInvoiceId+'/finalize');
 await provider.fetch('https://api.stripe.com'+externalFinalize.path,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+provider.bindings.STRIPE_SECRET_KEY,'Stripe-Version':'2026-09-30.endive','Idempotency-Key':externalFinalize.key},body:new URLSearchParams({auto_advance:'false'})});
 const target=await importDatabase(join(root,'target'),sql);t.after(()=>target.dispose());
 await restoreObjects(target.env.FILES,objects);
 const recoveredKeys=JSON.parse(await readFile(keyFile,'utf8'));assert.deepEqual(recoveredKeys.keys,fixture.keyRing);
 const bindings={...fixture.env,...target.env,CONTRACT_EVIDENCE_KEYS:JSON.stringify(recoveredKeys.keys),CONTRACT_EVIDENCE_KEY_ID:recoveredKeys.active};
 const restored=(path,body,who='finance',method=body===undefined?'GET':'POST',extra={})=>call(path,body,who,method,{...bindings,...extra});
 const DB=target.env.DB,FILES=target.env.FILES;
 const verify=async()=>assert.deepEqual(await databaseImage(DB),image,'all schema and exact table images must match trusted checkpoint');
 const putRow=async(table,row)=>{const cols=Object.keys(row);await DB.prepare('INSERT INTO "'+table+'"('+cols.map(c=>'"'+c+'"').join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').bind(...cols.map(c=>row[c])).run();};
 await t.test('all 52 tables and 39 indexes match before any restored application use',verify);
 await t.test('all paginated objects including orphans, empty data and private metadata match',()=>verifyObjects(FILES,objects));

 await t.test('restored frozen schedule keeps distinct identities, original receipts and exact source reservations',async()=>{
  const before=provider.requests.length;assert.deepEqual(await data(await restored(reservedInput.path)),reserved);assert.deepEqual((await data(await restored(reservedInput.path+'/requests/'+reservedInput.body.requestId))).schedule,reserved);assert.deepEqual(await data(await restored(reservedInput.path,reservedInput.body)),reserved);assert.equal(provider.requests.length,before,'receipt recovery cannot invoke the provider');assert.equal((await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(reservedInput.approved.id).first()).invoice_ref,'workspace:'+reservedInput.invoice.id);assert.notEqual(reserved.parts[0].id,reserved.parts[1].id);await verify();
 });
 await t.test('restored cancelled keys and abandoned history cannot become new schedules',async()=>{
  const before=provider.requests.length;assert.deepEqual(await data(await restored(cancelledScheduleInput.path+'/requests/'+cancelledScheduleInput.body.requestId)),cancelledSchedule);assert.equal((await restored(cancelledScheduleInput.path,cancelledScheduleInput.body)).status,409);assert.deepEqual(await data(await restored(abandonedInput.path)),abandoned);assert.deepEqual(await data(await restored(abandonedInput.path,abandonedInput.body)),abandoned);assert.equal(provider.requests.length,before);await verify();
 });
 await t.test('restored active schedule continues to block parent void and source-time reuse',async()=>{
  const invoice=await data(await restored('invoices/'+reservedInput.invoice.id)),before=provider.requests.length;assert.equal((await restored('invoices/'+invoice.id+'/void',{revision:invoice.revision,reason:'Cannot release frozen obligations'})).status,409);assert.equal((await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(reservedInput.approved.id).first()).invoice_ref,'workspace:'+invoice.id);assert.equal(provider.requests.length,before);await verify();
 });
 await t.test('missing restored schedule part or journal rejects the receipt without repair or provider calls',async()=>{
  for(const table of ['stripe_installment_parts','stripe_installment_events']){const row=image.tables[table].find(row=>row.schedule_id===reserved.id);assert.ok(row,table);await DB.prepare('DELETE FROM '+table+' WHERE id=?').bind(row.id).run();try{await assert.rejects(verify);const before=provider.requests.length;assert.equal((await restored(reservedInput.path)).status,503);assert.equal((await restored(reservedInput.path,reservedInput.body)).status,503);assert.equal(provider.requests.length,before);}finally{await putRow(table,row);}}await verify();
 });

 await t.test('restored child receipts retain native identities without configured provider access',async()=>{
  const before=provider.requests.length,disabled={STRIPE_MODE:undefined,STRIPE_SECRET_KEY:undefined};
  assert.deepEqual(await data(await restored(depositPath,undefined,'finance','GET',disabled)),deposit);assert.deepEqual((await data(await restored(depositPath+'/requests/'+depositBody.requestId,undefined,'finance','GET',disabled))).operation,deposit);assert.deepEqual(await data(await restored(depositPath,depositBody,'finance','POST',disabled)),deposit);
  assert.equal((await data(await restored(balancePath,undefined,'finance','GET',disabled))).id,balance.id);assert.equal((await restored(balancePath,cancelledPartBody)).status,409);assert.equal(provider.requests.length,before);
  assert.equal((await DB.prepare('SELECT create_attempt_at FROM stripe_part_operations WHERE id=?').bind(balance.id).first()).create_attempt_at,balanceRow.create_attempt_at);assert.equal((await DB.prepare('SELECT invoice_ref FROM time_details WHERE id=?').bind(childInput.approved.id).first()).invoice_ref,'workspace:'+childInput.invoice.id);await verify();
 });
 await t.test('restored child activation and journal continue to hold the parent and its sources',async()=>{
  const before=posts().length,invoice=await data(await restored('invoices/'+childInput.invoice.id));assert.equal((await restored(childInput.path+'/'+childSchedule.id+'/abandon',{revision:childSchedule.revision,reason:'Cannot abandon external child'})).status,409);assert.equal((await restored('invoices/'+invoice.id+'/void',{revision:invoice.revision,reason:'Cannot release external child'})).status,409);
  const events=image.tables.stripe_part_events.filter(row=>row.operation_id===balance.id).sort((a,b)=>a.revision-b.revision);for(const row of [events[0],events.at(-1)]){await DB.prepare('DELETE FROM stripe_part_events WHERE id=?').bind(row.id).run();try{assert.equal((await restored(balancePath)).status,503);assert.ok((await restored(balancePath+'/retry',{})).status>=400);}finally{await putRow('stripe_part_events',row);}}assert.equal(posts().length,before);await verify();
 });
 await t.test('restored active child lease blocks retry without changing its expiration',async()=>{
  const before=posts().length;assert.equal((await restored(leasedChildPath+'/retry',{})).status,202);assert.equal(posts().length,before);assert.deepEqual(await DB.prepare('SELECT lease_token,lease_until FROM stripe_part_operations WHERE id=?').bind(leasedChild.id).first(),{lease_token:'synthetic-child-lease',lease_until:childLeaseUntil});await verify();
 });

 await t.test('own client reads exact original file and immutable signed JSON/PDF bytes',async()=>{
  for(const path of e.clientPaths)assert.equal((await restored(path,undefined,'client')).status,200,path);
  for(const[path,bytes]of[['files/'+r.file.id+'/download',e.fileBytes],[r.contractPath+'/signed-document',e.jsonBytes],[r.contractPath+'/signed-pdf',e.pdfBytes]])assert.deepEqual(new Uint8Array(await(await restored(path,undefined,'client')).arrayBuffer()),bytes);
 });
 await t.test('second staff retains private files, notes and the running timer; other clients and foreign staff remain isolated',async()=>{
  for(const path of e.privatePaths){assert.equal((await restored(path,undefined,'second')).status,200);assert.equal((await restored(path,undefined,'client')).status,404);}
  for(const who of['other','foreign'])for(const path of e.clientPaths)assert.equal((await restored(path,undefined,who)).status,who==='foreign'&&path.startsWith('portal/')?403:404,who+' '+path);
  assert.equal((await data(await restored('timer/current',undefined,'second'))).item.id,r.timer.id);
  assert.equal((await restored('timer/start',{projectId:r.project.id,description:'Duplicate running timer'},'second')).status,409);
 });
 await t.test('missing cancellation tombstone, missing empty table and lost unique index reject the full image',async()=>{
  const row=image.tables.cancelled_invoice_requests[0];assert.ok(row);await DB.prepare('DELETE FROM cancelled_invoice_requests WHERE id=?').bind(row.id).run();try{await assert.rejects(verify);}finally{await putRow('cancelled_invoice_requests',row);}
  const empty=image.schema.find(s=>s.name==='cancelled_contract_signature_requests');assert.equal(image.tables[empty.name].length,0);await DB.prepare('DROP TABLE '+empty.name).run();try{await assert.rejects(verify);}finally{await DB.prepare(empty.sql).run();}
  const index=image.schema.find(s=>s.type==='index'&&s.sql.startsWith('CREATE UNIQUE INDEX'));await DB.prepare('DROP INDEX "'+index.name+'"').run();try{await assert.rejects(verify);}finally{await DB.prepare(index.sql).run();}
  await verify();
 });
 await t.test('missing or altered object bytes and metadata reject the object image',async()=>{
  const object=objects.find(o=>o.key.includes('staged.bin'));
  for(const corrupt of[
   ()=>FILES.delete(object.key),
   ()=>FILES.put(object.key,'altered',{httpMetadata:{...object.httpMetadata,cacheExpiry:new Date(object.httpMetadata.cacheExpiry)},customMetadata:object.customMetadata}),
   ()=>FILES.put(object.key,Buffer.from(object.base64,'base64'),{customMetadata:{owner:'changed'}})
  ]){try{await corrupt();await assert.rejects(()=>verifyObjects(FILES,objects));}finally{await restoreObjects(FILES,objects);}}
  try{await FILES.put('unexpected-target-object','untracked');await assert.rejects(()=>verifyObjects(FILES,objects));}finally{await FILES.delete('unexpected-target-object');}
  await assert.rejects(()=>restoreObjects(FILES,[{...object,base64:Buffer.from('wrong').toString('base64')}]));await verifyObjects(FILES,objects);
 });
 await t.test('missing and wrong historical signing keys fail closed; historical key remains usable after rotation',async()=>{
  for(const keys of[undefined,JSON.stringify({journey:Buffer.alloc(32,3).toString('base64url')})])for(const suffix of['/signed-document','/signed-pdf'])assert.equal((await restored(r.contractPath+suffix,undefined,'client','GET',{CONTRACT_EVIDENCE_KEYS:keys})).status,503);
  for(const suffix of['/signed-document','/signed-pdf'])assert.equal((await restored(r.contractPath+suffix,undefined,'client','GET',{CONTRACT_EVIDENCE_KEYS:JSON.stringify({...fixture.keyRing,next:Buffer.alloc(32,9).toString('base64url')}),CONTRACT_EVIDENCE_KEY_ID:'next'})).status,200);
 });
 await t.test('missing or corrupt signed JSON and PDF are withheld instead of silently repaired',async()=>{
  const signature=image.tables.contract_signatures[0],pdf=image.tables.contract_signature_pdfs[0];
  for(const[key,suffix]of[[signature.object_key,'/signed-document'],[pdf.object_key,'/signed-pdf']]){assert.ok(key);for(const corrupt of[()=>FILES.delete(key),()=>FILES.put(key,'corrupt signed evidence')])try{await corrupt();assert.equal((await restored(r.contractPath+suffix,undefined,'client')).status,503);}finally{await restoreObjects(FILES,objects);}}
 });
 await t.test('missing signature and PDF journals block artifact delivery and reject the image',async()=>{
  for(const[table,suffix]of[['contract_signature_events','/signed-document'],['contract_signature_pdf_events','/signed-pdf']]){const row=image.tables[table][0];await DB.prepare('DELETE FROM '+table+' WHERE id=?').bind(row.id).run();try{await assert.rejects(verify);assert.equal((await restored(r.contractPath+suffix,undefined,'client')).status,503);}finally{await putRow(table,row);}}
 });
 await t.test('missing current issuance journal blocks receipt use without any provider POST',async()=>{
  const rows=image.tables.stripe_invoice_issuance_events.filter(row=>row.operation_id===r.issuance.id),row=rows.sort((a,b)=>b.revision-a.revision)[0],before=posts().length;
  await DB.prepare('DELETE FROM stripe_invoice_issuance_events WHERE id=?').bind(row.id).run();try{await assert.rejects(verify);assert.equal((await restored('invoices/'+r.invoice.id+'/stripe/finalize')).status,503);assert.equal(posts().length,before);}finally{await putRow('stripe_invoice_issuance_events',row);}
 });
 await t.test('restored cancellation fences delayed invoice creation and source claims cannot be billed twice',async()=>{
  const before=posts().length;assert.equal((await restored('invoices',r.cancelledBody)).status,409);
  const body={clientId:r.client.id,projectId:r.project.id,title:'Attempt duplicate source',currency:'CAD',tax:{type:'HST',rateBps:1300},dueOn:r.invoice.snapshot.dueOn,times:[{id:r.time.id,revision:e.claimed.revision}],charges:[]};
  assert.equal((await restored('invoices/preview',body)).status,409);assert.equal(posts().length,before);assert.deepEqual(await DB.prepare('SELECT * FROM time_details WHERE id=?').bind(r.time.id).first(),e.claimed);
 });
 await t.test('completed creation and issuance receipts replay without another provider mutation',async()=>{
  const before=posts().length;assert.deepEqual(await data(await restored('invoices/'+r.invoice.id+'/stripe')),e.creationReceipt);assert.deepEqual(await data(await restored('invoices/'+r.invoice.id+'/stripe/finalize')),e.issuanceReceipt);assert.equal(posts().length,before);
 });
 await t.test('an active recovered lease blocks retry and preserves its original expiration',async()=>{
  const before=posts().length;const response=await restored(leased.path+'/retry',{});assert.equal(response.status,202);assert.equal((await response.json()).state,'UNKNOWN');assert.equal(posts().length,before);const row=await DB.prepare('SELECT lease_token,lease_until FROM stripe_invoice_issuance_operations WHERE id=?').bind(leased.row.id).first();assert.deepEqual(row,{lease_token:'synthetic-active-lease',lease_until:leaseUntil});
 });
 await t.test('current finance grants, actor activity and project sharing still govern restored access',async()=>{
  const before=posts().length;
  await DB.prepare("DELETE FROM actor_finance_access WHERE id='finance'").run();try{assert.equal((await restored(retryable.path+'/retry',{})).status,403);}finally{await putRow('actor_finance_access',image.tables.actor_finance_access.find(row=>row.id==='finance'));}
  await DB.prepare("UPDATE actors SET active=0 WHERE id='second'").run();try{assert.equal((await restored(e.privatePaths[0],undefined,'second')).status,403);}finally{await DB.prepare("UPDATE actors SET active=1 WHERE id='second'").run();}
  await DB.prepare('UPDATE projects SET client_visible=0 WHERE id=?').bind(r.project.id).run();try{for(const path of e.clientPaths)assert.equal((await restored(path,undefined,'client')).status,404,path);}finally{await DB.prepare('UPDATE projects SET client_visible=1 WHERE id=?').bind(r.project.id).run();}
  assert.equal(posts().length,before);await verify();
 });
 await t.test('restored unknown children retry their original intents against already-created external drafts',async()=>{
  for(const entry of [{path:balancePath,op:balance,row:balanceRow},{path:leasedChildPath,op:leasedChild,row:leasedChildRow}]){if(entry.op.id===leasedChild.id)await DB.prepare('UPDATE stripe_part_operations SET lease_token=NULL,lease_until=0 WHERE id=?').bind(entry.op.id).run();const original=provider.requests.find(r=>r.method==='POST'&&r.path==='/v1/invoices'&&r.params['metadata[ashbi_operation]']===entry.op.id),before=posts().length,nativeCount=provider.invoices.size;assert.ok(original);const result=await data(await restored(entry.path+'/retry',{}));assert.equal(result.state,'DONE');assert.equal(provider.invoices.size,nativeCount);const repeated=posts().slice(before).find(r=>r.path==='/v1/invoices');assert.ok(repeated);assert.equal(repeated.key,original.key);assert.deepEqual(repeated.params,original.params);assert.equal((await DB.prepare('SELECT create_attempt_at FROM stripe_part_operations WHERE id=?').bind(entry.op.id).first()).create_attempt_at,entry.row.create_attempt_at);}
 });
 await t.test('provider state newer than checkpoint reconciles by GET without duplicate finalization',async()=>{
  const before=posts().length,result=await data(await restored(externallyFinished.path+'/reconcile',{}));assert.equal(result.state,'DONE');assert.equal(posts().length,before);assert.equal(provider.invoices.get(externallyFinished.creation.stripeInvoiceId).status,'open');
 });
 await t.test('explicit retry of an unexecuted operation retains its first attempt and original provider key',async()=>{
  const original=provider.requests.findLast(p=>p.method==='POST'&&p.path==='/v1/invoices/'+retryable.creation.stripeInvoiceId+'/finalize'),before=posts().length,result=await data(await restored(retryable.path+'/retry',{}));assert.equal(result.state,'DONE');assert.equal(posts().length,before+1);assert.equal(posts().at(-1).key,original.key);assert.equal((await DB.prepare('SELECT attempt_at FROM stripe_invoice_issuance_operations WHERE id=?').bind(retryable.row.id).first()).attempt_at,retryable.row.attempt_at);
 });
 await t.test('target fault injection and subsequent writes leave the source checkpoint unchanged',async()=>{await source.open();try{assert.deepEqual(await databaseImage(source.env.DB),image);await verifyObjects(source.env.FILES,objects);}finally{await source.dispose();}});
});

test('native isolated recovery preserves an ingested source package, original bytes and current archive permissions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ashbi-source-recovery-')),source=await localStore(join(root,'source'));t.after(()=>source.dispose());
 for(const name of(await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await source.env.DB.batch((await readFile(new URL('./migrations/'+name,import.meta.url),'utf8')).split(';').map(s=>s.trim()).filter(Boolean).map(s=>source.env.DB.prepare(s)));
 const fixture=await makePilotFixture(root),report=await reconcilePilot(fixture.root,fixture.mapping),actor={id:'cameron',organization_id:'pilot-org',role:'staff'};
 const DB=source.env.DB;
 for(const id of['cameron','bianca','ordinary'])await DB.prepare("INSERT INTO actors VALUES(?,?,?,'staff',NULL,1)").bind(id,id+'@example.invalid','pilot-org').run();
 await DB.prepare("INSERT INTO actor_finance_access VALUES('cameron','pilot-org')").run();
 await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('canonical-client','pilot-org','Fixture Co')").run();
 await DB.prepare("INSERT INTO projects(id,organization_id,client_id,name) VALUES('canonical-project','pilot-org','canonical-client','Site')").run();
 const objects=[];for(const[source,pins]of Object.entries(report.sourceFiles))for(const pin of pins)objects.push({source,path:pin.path,bytes:new Uint8Array(await readFile(join(fixture.root,source,pin.path)))});
 const input={requestId:crypto.randomUUID(),report,objects,snapshot:{clientRevision:0,projectRevision:0}},receipt=await applySourcePilot(source.env,actor,input),before=await readSourcePilot(source.env,actor,receipt.id),image=await databaseImage(DB),objectImage=await captureObjects(source.env.FILES);
 assert.equal(Object.keys(image.tables).length,52);assert.equal(image.schema.filter(s=>s.type==='index').length,39);
 assert.equal(image.tables.source_pilot_records.length,19);assert.equal(image.tables.source_pilot_objects.length,objects.length);
 const target=await importDatabase(join(root,'restored'),await exportDatabase(source));t.after(()=>target.dispose());await restoreObjects(target.env.FILES,objectImage);
 assert.deepEqual(await databaseImage(target.env.DB),image);assert.deepEqual(await readSourcePilot(target.env,actor,receipt.id),before);
 for(const object of objects)assert.deepEqual(await readSourceObject(target.env,actor,receipt.id,object.source,object.path),object.bytes);
 assert.deepEqual(await applySourcePilot(target.env,actor,input),receipt);
 const verify=async()=>assert.deepEqual(await databaseImage(target.env.DB),image);
 await t.test('missing held provenance is rejected by full recovery and receipt reads',async()=>{
  const row=image.tables.source_pilot_records.find(r=>JSON.stringify(r).includes('held-notion-database'));assert.ok(row);
  await target.env.DB.prepare('DELETE FROM source_pilot_records WHERE run_id=? AND source_key=?').bind(row.run_id,row.source_key).run();
  try{await assert.rejects(verify);await assert.rejects(()=>readSourcePilot(target.env,actor,receipt.id),e=>e===503);}finally{const cols=Object.keys(row);await target.env.DB.prepare('INSERT INTO source_pilot_records('+cols.join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').bind(...cols.map(c=>row[c])).run();}
 });
 await t.test('restored originals are verified and not silently repaired',async()=>{
  const object=objectImage[0];await target.env.FILES.put(object.key,'changed');
  try{const pin=image.tables.source_pilot_objects.find(o=>o.object_key===object.key);assert.ok(pin);await assert.rejects(()=>verifyObjects(target.env.FILES,objectImage));await assert.rejects(()=>readSourceObject(target.env,actor,receipt.id,pin.source,pin.path),e=>e===503);}finally{await restoreObjects(target.env.FILES,objectImage);}
 });
 await t.test('current grants and project identity still govern restored archives',async()=>{
  await assert.rejects(()=>readSourcePilot(target.env,{...actor,id:'ordinary'},receipt.id),e=>e===403);
  await target.env.DB.prepare("DELETE FROM actor_finance_access WHERE id='cameron'").run();try{await assert.rejects(()=>readSourcePilot(target.env,actor,receipt.id),e=>e===403);}finally{await target.env.DB.prepare("INSERT INTO actor_finance_access VALUES('cameron','pilot-org')").run();}
  await target.env.DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('replacement','pilot-org','Other')").run();await target.env.DB.prepare("UPDATE projects SET client_id='replacement' WHERE id='canonical-project'").run();try{await assert.rejects(()=>readSourcePilot(target.env,actor,receipt.id),e=>e===404);}finally{await target.env.DB.prepare("UPDATE projects SET client_id='canonical-client' WHERE id='canonical-project'").run();await target.env.DB.prepare("DELETE FROM clients WHERE id='replacement'").run();}
  await verify();await verifyObjects(target.env.FILES,objectImage);
 });
});
