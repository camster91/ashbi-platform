import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localStore,exportDatabase,importDatabase,databaseImage,captureObjects,restoreObjects,verifyObjects} from './recovery-local.mjs';
import {Miniflare} from 'miniflare';
import {generateKeyPair,SignJWT} from 'jose';
const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');

test('large imported originals retain native checksums and download after object recovery',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("recovery fixture")}}',d1Databases:{DB:'large-recovery'},r2Buckets:['SOURCE','RESTORED'],cf:false});t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB'),SOURCE=await mf.getR2Bucket('SOURCE'),RESTORED=await mf.getR2Bucket('RESTORED');
 for(const name of(await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));}
 await DB.prepare("INSERT INTO actors VALUES('staff','staff@example.invalid','a','staff',NULL,1)").run();await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('c','a','Synthetic client')").run();await DB.prepare("INSERT INTO projects(id,organization_id,client_id,name) VALUES('p','a','c','Synthetic project')").run();
 const bytes=new Uint8Array(6*1024*1024).fill(71),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');await SOURCE.put('large',bytes,{sha256});
 await DB.prepare("INSERT INTO files(id,organization_id,project_id,actor_id,name,object_key,size,sha256,state,created_at) VALUES('large','a','p','staff','Large original.bin','large',?,?,'ready',1)").bind(bytes.length,sha256).run();
 const {publicKey,privateKey}=await generateKeyPair('RS256'),origin='https://recovery.example.invalid',issuer='https://identity.cloudflareaccess.com',token=await new SignJWT({email:'staff@example.invalid'}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('recovery').setSubject('staff').setIssuedAt().setExpirationTime('10m').sign(privateKey),worker=createWorker(publicKey);
 const download=FILES=>worker.fetch(new Request(origin+'/api/files/large/download',{headers:{'cf-access-jwt-assertion':token}}),{DB,FILES,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'recovery'});
 const original=await download(SOURCE);assert.equal(original.status,200);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),bytes);const image=await captureObjects(SOURCE);await restoreObjects(RESTORED,image);await verifyObjects(RESTORED,image);
 assert.equal(Buffer.from((await RESTORED.head('large')).checksums.sha256??[]).toString('hex'),sha256,'native checksum is required by the streamed download route');
 const response=await download(RESTORED);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
});

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
import {stripeDeliveryProvider} from './stripe-delivery-provider.mjs';
import {makePilotFixture} from './pilot-source-fixture.mjs';
import {reconcilePilot} from './pilot-reconcile.mjs';
import {applySourcePilot,readSourcePilot,readSourceObject} from './source-pilot.mjs';

test('complete native D1 and private R2 recovery retains the joined workspace, evidence and external idempotency',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ashbi-workspace-recovery-'));
 const source=await localStore(join(root,'source'));t.after(()=>source.dispose());
 for(const name of(await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
  // Static committed migrations only. Native exported SQL is always imported
  // by Wrangler, never split on semicolons or replayed as migrations.
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');
  await source.env.DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>source.env.DB.prepare(s)));
 }
 const fixture=await seedRecoveryWorkspace({...source.env,createWorker,stripeProvider:stripeDeliveryProvider('journey-a')}),{call,records:r,expected:e,provider}=fixture;
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

 // Independent issuance effects must survive the same native checkpoint.
 const finalPath=(input,part)=>input.path+'/parts/'+part.id+'/finalize';
 async function finalIntent(path){const plan=await data(await call(path+'-preview',{}));return {requestId:crypto.randomUUID(),revision:plan.creationRevision,fingerprint:plan.fingerprint,reason:'Synthetic child issuance review'};}
 const issuedPath=finalPath(childInput,childSchedule.parts[0]),issuedBody=await finalIntent(issuedPath),issuedPart=await data(await call(issuedPath,issuedBody),201);
 const issuanceInput=await scheduleInvoice('Uncertain child issuance checkpoint',{withTime:true}),issuanceSchedule=await data(await call(issuanceInput.path,issuanceInput.body),201),issuanceDrafts=[];
 for(const part of issuanceSchedule.parts)issuanceDrafts.push(await data(await call(issuanceInput.path+'/parts/'+part.id+'/draft',{requestId:crypto.randomUUID(),revision:issuanceSchedule.revision,fingerprint:part.plan.fingerprint,reason:'Prepare recoverable issuance source'}),201));
 const lostIssuancePath=finalPath(issuanceInput,issuanceSchedule.parts[0]),cancelledIssuanceBody=await finalIntent(lostIssuancePath);await data(await call(lostIssuancePath+'/requests/'+cancelledIssuanceBody.requestId+'/cancel',{}));
 const lostIssuanceBody=await finalIntent(lostIssuancePath);provider.loseFinalize=true;const lostIssuance=await data(await call(lostIssuancePath,lostIssuanceBody),202);assert.equal(lostIssuance.state,'UNKNOWN');
 const lostIssuanceRow=await source.env.DB.prepare('SELECT * FROM stripe_part_issuance_operations WHERE id=?').bind(lostIssuance.id).first();
 const leasedIssuancePath=finalPath(issuanceInput,issuanceSchedule.parts[1]),leasedIssuanceBody=await finalIntent(leasedIssuancePath);provider.failFinalizeBefore=true;const leasedIssuance=await data(await call(leasedIssuancePath,leasedIssuanceBody),202);assert.equal(leasedIssuance.state,'UNKNOWN');
 const issuanceLeaseUntil=Date.now()+300000;await source.env.DB.prepare('UPDATE stripe_part_issuance_operations SET lease_token=?,lease_until=? WHERE id=?').bind('synthetic-issuance-lease',issuanceLeaseUntil,leasedIssuance.id).run();const leasedIssuanceRow=await source.env.DB.prepare('SELECT * FROM stripe_part_issuance_operations WHERE id=?').bind(leasedIssuance.id).first();

 // Native delivery receipts and pending signed evidence are application state;
 // a provider GET cannot recover a lost Send acknowledgement by itself.
 const fullSendPath='invoices/'+r.invoice.id+'/stripe/send',childSendPath=childInput.path+'/parts/'+childSchedule.parts[0].id+'/send';
 async function deliveryIntent(path){const plan=await data(await call(path+'-preview',{}));return {requestId:crypto.randomUUID(),revision:plan.issuanceRevision,fingerprint:plan.fingerprint,reason:'Reviewed synthetic recovery delivery'};}
 const fullSendBody=await deliveryIntent(fullSendPath),fullSend=await data(await call(fullSendPath,fullSendBody),201);
 const childSendBody=await deliveryIntent(childSendPath);provider.loseSend=true;const childSend=await data(await call(childSendPath,childSendBody),202);assert.equal(childSend.state,'UNKNOWN');
 const childSendRow=await source.env.DB.prepare('SELECT * FROM stripe_invoice_delivery_operations WHERE id=?').bind(childSend.id).first(),childSendEffect=provider.sendEffects.at(-1);
 const deliveryLeaseInput=await uncertainInvoice('Original send lease checkpoint');await data(await call(deliveryLeaseInput.path+'/retry',{}));
 const leasedSendPath='invoices/'+deliveryLeaseInput.invoice.id+'/stripe/send',leasedSendBody=await deliveryIntent(leasedSendPath);provider.failSendBefore=true;const leasedSend=await data(await call(leasedSendPath,leasedSendBody),202);assert.equal(leasedSend.state,'UNKNOWN');
 const sendLeaseUntil=Date.now()+300000;await source.env.DB.prepare('UPDATE stripe_invoice_delivery_operations SET lease_token=?,lease_until=? WHERE id=?').bind('synthetic-send-lease',sendLeaseUntil,leasedSend.id).run();const leasedSendRow=await source.env.DB.prepare('SELECT * FROM stripe_invoice_delivery_operations WHERE id=?').bind(leasedSend.id).first();
 const cancelledSendBody=await deliveryIntent(fullSendPath),cancelledSend=await data(await call(fullSendPath+'/requests/'+cancelledSendBody.requestId+'/cancel',{}));assert.equal(cancelledSend.state,'CANCELLED');
 fixture.env.STRIPE_WEBHOOK_SECRET=['whsec','synthetic_recovery_delivery_only'].join('_');
 const sendEvent={id:'evt_recovery_send_'+crypto.randomUUID().replaceAll('-',''),object:'event',api_version:'2026-09-30.endive',livemode:false,account:fixture.env.STRIPE_ACCOUNT_ID,created:Math.floor(Date.now()/1000),type:'invoice.sent',request:{id:childSendEffect.requestId,idempotency_key:childSendEffect.key},data:{object:structuredClone(provider.invoices.get(deposit.stripeInvoiceId))}};
 const sendRaw=JSON.stringify(sendEvent),sendTimestamp=Math.floor(Date.now()/1000),sendSigningKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(fixture.env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']),sendMac=await crypto.subtle.sign('HMAC',sendSigningKey,new TextEncoder().encode(sendTimestamp+'.'+sendRaw));
 await data(await fixture.worker.fetch(new Request(fixture.env.APP_ORIGIN+'/api/stripe/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':'t='+sendTimestamp+',v1='+Buffer.from(sendMac).toString('hex')},body:sendRaw}),fixture.env),202);
 const pendingSendInbox=await source.env.DB.prepare('SELECT * FROM stripe_event_inbox WHERE event_id=?').bind(sendEvent.id).first();assert.equal(pendingSendInbox.state,'PENDING');assert.ok(pendingSendInbox.send_evidence_json);

 // Preserve independent authoritative child observations and pending event work.
 const childBilling='invoices/'+childInput.invoice.id+'/parts/'+childSchedule.parts[0].id+'/billing';
 await data(await call(childBilling+'/reconcile',{}));
 const childNative=provider.invoices.get(deposit.stripeInvoiceId);
 function childPayment(amount,suffix){const pi='pi_recovery_child_'+suffix,ch='ch_recovery_child_'+suffix;provider.payments.set(childNative.id,[...(provider.payments.get(childNative.id)||[]),{id:'inpay_recovery_child_'+suffix,object:'invoice_payment',invoice:childNative.id,currency:childNative.currency,livemode:false,amount_paid:amount,amount_requested:amount,status:'paid',payment:{type:'payment_intent',payment_intent:pi}}]);provider.intents.set(pi,{id:pi,object:'payment_intent',livemode:false,customer:childNative.customer,currency:childNative.currency,amount_received:amount,status:'succeeded',latest_charge:ch});provider.charges.set(ch,{id:ch,object:'charge',livemode:false,customer:childNative.customer,currency:childNative.currency,amount,amount_refunded:0,payment_intent:pi,paid:true});}
 Object.assign(childNative,{amount_paid:200,amount_remaining:childNative.total-200});childPayment(200,'checkpoint');
 const childObservation=await data(await call(childBilling+'/reconcile',{}));assert.equal(childObservation.paidMinor,200);
 const childObservationLeaseUntil=Date.now()+300000;await source.env.DB.prepare('UPDATE stripe_part_projection SET lease_token=?,lease_until=? WHERE part_id=?').bind('synthetic-child-observation-lease',childObservationLeaseUntil,childSchedule.parts[0].id).run();
 const childInboxId=crypto.randomUUID(),childEventId='evt_recovery_child_'+crypto.randomUUID().replaceAll('-','');
 await source.env.DB.prepare('INSERT INTO stripe_event_inbox(id,organization_id,account_id,event_id,event_type,target_kind,target_id,content_hash,api_version,stripe_created_at,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(childInboxId,fixture.env.STRIPE_ORGANIZATION_ID,fixture.env.STRIPE_ACCOUNT_ID,childEventId,'invoice.updated','invoice',childNative.id,'0'.repeat(64),'2026-09-30.endive',Math.floor(Date.now()/1000),Date.now(),Date.now()).run();
 const childStored=await data(await call(childBilling)),childPortal='portal/invoice-parts/'+childSchedule.parts[0].id,childClientStored=await data(await call(childPortal,undefined,'client'));

 // Inventory staged orphans and zero-length objects too, not only ready DB rows.
 await source.env.FILES.put('unreferenced/café; staged.bin',new Uint8Array([0,17,255]),{httpMetadata:{contentType:'application/octet-stream',contentDisposition:'attachment; filename="staged.bin"',cacheControl:'private, no-store',cacheExpiry:new Date('2030-01-02T00:00:00Z')},customMetadata:{owner:'synthetic',literal:'café; "quoted"'}});
 await source.env.FILES.put('unreferenced/empty',new Uint8Array(),{customMetadata:{state:'pending'}});
 const conversationBody={content:'Recovered project conversation — café',requestId:crypto.randomUUID(),mentionIds:['client']};
 const conversation=await data(await call('projects/'+r.project.id+'/messages',conversationBody),201);
 await data(await call('notifications/read',{messageIds:[conversation.id]},'client'));
 const inboxTask=await data(await call('tasks',{title:'Recovery assignment',projectId:r.project.id,clientVisible:false,assigneeId:conversation.actor_id}),201);
 await data(await call('inbox/read',{items:[{kind:'assignment',id:inboxTask.assignment_token}],read:true}));
 await source.env.DB.prepare('INSERT INTO notification_preferences(organization_id,actor_id,messages,assignments,deadlines,uploads,mentions) VALUES(?,?,1,1,0,0,0)').bind(inboxTask.organization_id,conversation.actor_id).run();
 await source.env.DB.prepare('UPDATE notification_preferences SET email=1,email_enabled_since=1 WHERE organization_id=? AND actor_id=?').bind(inboxTask.organization_id,conversation.actor_id).run();
 await source.env.DB.prepare("INSERT INTO notification_email_deliveries(organization_id,actor_id,kind,item_id,idempotency_key,status,attempts,next_attempt_at,created_at,updated_at,recipient_email,sender,payload_fingerprint) VALUES(?,?,'assignment',?,'synthetic-recovery-email','UNCERTAIN',1,1,1,1,'recipient@example.invalid','sender@example.invalid','synthetic-fingerprint')").bind(inboxTask.organization_id,conversation.actor_id,inboxTask.assignment_token).run();
 const pushKeys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),pushPublic=Buffer.from(await crypto.subtle.exportKey('raw',pushKeys.publicKey)).toString('base64url'),pushAuth=Buffer.alloc(16,7).toString('base64url');
 await source.env.DB.prepare("INSERT INTO push_subscriptions(organization_id,actor_id,endpoint,endpoint_hash,p256dh,auth,subscribed_since,created_at,updated_at) VALUES(?,?,'https://fcm.googleapis.com/fcm/send/synthetic-recovery',?,?,?,1,1,1)").bind(inboxTask.organization_id,conversation.actor_id,'a'.repeat(64),pushPublic,pushAuth).run();
 await source.env.DB.prepare("INSERT INTO push_delivery_events(organization_id,actor_id,endpoint,event_key,subscription_p256dh,subscription_auth,subscription_since,state,attempts,next_attempt_at,created_at,updated_at,last_error) VALUES(?,?,'https://fcm.googleapis.com/fcm/send/synthetic-recovery',?,?,?,1,'failed',1,1,1,1,'uncertain')").bind(inboxTask.organization_id,conversation.actor_id,'assignment:'+inboxTask.assignment_token,pushPublic,pushAuth).run();
 const checkpoint=join(root,'synthetic-checkpoint.json'),keyFile=join(root,'synthetic-keyring.json');
 await writeFile(checkpoint,JSON.stringify({image:await databaseImage(source.env.DB),objects:await captureObjects(source.env.FILES)}));
 // Synthetic keys are separate from database/object images. Real restore
 // credentials and historical signing keys require separate management.
 await writeFile(keyFile,JSON.stringify({active:'journey',keys:fixture.keyRing}),{mode:0o600});
 const {image,objects}=JSON.parse(await readFile(checkpoint,'utf8'));
 for(const key of Object.values(fixture.keyRing))assert.equal((await readFile(checkpoint,'utf8')).includes(key),false);
 assert.equal(Object.keys(image.tables).length,69);assert.equal(image.schema.filter(s=>s.type==='index').length,57);assert.ok(image.schema.some(s=>s.type==='index'&&s.name==='projects_archive'));assert.equal(objects.length,6);
 const sql=await exportDatabase(source);
 // External Stripe state is deliberately NOT restored with our D1/R2 image.
 const externalFinalize=provider.requests.findLast(p=>p.method==='POST'&&p.path==='/v1/invoices/'+externallyFinished.creation.stripeInvoiceId+'/finalize');
 await provider.fetch('https://api.stripe.com'+externalFinalize.path,{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+provider.bindings.STRIPE_SECRET_KEY,'Stripe-Version':'2026-09-30.endive','Idempotency-Key':externalFinalize.key},body:new URLSearchParams({auto_advance:'false'})});
 Object.assign(childNative,{amount_paid:300,amount_remaining:childNative.total-300});childPayment(100,'newer');
 const target=await importDatabase(join(root,'target'),sql);t.after(()=>target.dispose());
 await restoreObjects(target.env.FILES,objects);
 const recoveredKeys=JSON.parse(await readFile(keyFile,'utf8'));assert.deepEqual(recoveredKeys.keys,fixture.keyRing);
 const bindings={...fixture.env,...target.env,CONTRACT_EVIDENCE_KEYS:JSON.stringify(recoveredKeys.keys),CONTRACT_EVIDENCE_KEY_ID:recoveredKeys.active};
 const restored=(path,body,who='finance',method=body===undefined?'GET':'POST',extra={})=>call(path,body,who,method,{...bindings,...extra});
 const DB=target.env.DB,FILES=target.env.FILES;
 const verify=async()=>assert.deepEqual(await databaseImage(DB),image,'all schema and exact table images must match trusted checkpoint');
 const putRow=async(table,row)=>{const cols=Object.keys(row);await DB.prepare('INSERT INTO "'+table+'"('+cols.map(c=>'"'+c+'"').join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').bind(...cols.map(c=>row[c])).run();};
 await t.test('all 69 tables and 57 indexes match before any restored application use',verify);
 await t.test('restored external notification receipts preserve opt-in and uncertain outcomes without sending',async()=>{const email=await data(await restored('inbox/email'));assert.equal(email.email,true);assert.equal(email.available,false);assert.equal(email.items[0].status,'UNCERTAIN');const push=await data(await restored('inbox/push'));assert.equal(push.available,false);assert.equal(push.subscriptions[0].id,'a'.repeat(64));assert.equal((await DB.prepare("SELECT last_error FROM push_delivery_events WHERE event_key=?").bind('assignment:'+inboxTask.assignment_token).first()).last_error,'uncertain');await verify();});
 await t.test('restored project messages preserve client visibility and original retry identity',async()=>{const thread=await data(await restored('projects/'+r.project.id+'/messages',undefined,'client'));assert.equal(thread.items[0].content,conversationBody.content);assert.equal(thread.items[0].unread,0);assert.equal(thread.items[0].mentioned,1);assert.equal((await data(await restored('notifications/summary',undefined,'client'))).unreadCount,0);assert.equal((await data(await restored('projects/'+r.project.id+'/messages',conversationBody))).id,conversation.id);assert.equal((await restored('projects/'+r.project.id+'/messages',undefined,'other')).status,404);await verify();});
 await t.test('restored inbox retains personal preferences and exact assignment receipts',async()=>{const prefs=await data(await restored('inbox/preferences'));assert.equal(prefs.deadlines,false);assert.equal(prefs.uploads,false);assert.equal(prefs.mentions,false);const inbox=await data(await restored('inbox?state=read'));assert.ok(inbox.items.some(row=>row.id===inboxTask.assignment_token&&row.unread===0));await verify();});
 await t.test('all paginated objects including orphans, empty data and private metadata match',()=>verifyObjects(FILES,objects));

 await t.test('restored delivery receipts and signed pending evidence remain local with the provider disabled',async()=>{
  const before=provider.requests.length,disabled={STRIPE_MODE:undefined,STRIPE_SECRET_KEY:undefined,STRIPE_ACCOUNT_ID:undefined};
  for(const[path,body,operation]of[[fullSendPath,fullSendBody,fullSend],[childSendPath,childSendBody,childSend]]){assert.deepEqual(await data(await restored(path,undefined,'finance','GET',disabled)),operation);assert.deepEqual((await data(await restored(path+'/requests/'+body.requestId,undefined,'finance','GET',disabled))).operation,operation);assert.deepEqual(await data(await restored(path,body,'finance','POST',disabled)),operation);assert.equal(operation.emailDelivery,'TEST_MODE_NO_EMAIL');}
  assert.deepEqual(await DB.prepare('SELECT * FROM stripe_event_inbox WHERE id=?').bind(pendingSendInbox.id).first(),pendingSendInbox);assert.equal(provider.requests.length,before);await verify();
 });
 await t.test('restored delivery cancellation and active lease fence late writes without refreshing the lease',async()=>{
  const before=provider.requests.length;assert.deepEqual(await data(await restored(fullSendPath+'/requests/'+cancelledSendBody.requestId)),cancelledSend);assert.equal((await restored(fullSendPath,cancelledSendBody)).status,409);assert.equal((await restored(leasedSendPath+'/retry',{})).status,202);assert.equal(provider.requests.length,before);assert.deepEqual(await DB.prepare('SELECT lease_token,lease_until FROM stripe_invoice_delivery_operations WHERE id=?').bind(leasedSend.id).first(),{lease_token:'synthetic-send-lease',lease_until:sendLeaseUntil});await verify();
 });
 await t.test('missing original delivery journals reject restored receipts and retry without provider IO or repair',async()=>{
  const events=image.tables.stripe_invoice_delivery_events.filter(row=>row.operation_id===childSend.id).sort((a,b)=>a.revision-b.revision);assert.ok(events.length>=3);const before=provider.requests.length;
  for(const row of[events[0],events.at(-1)]){await DB.prepare('DELETE FROM stripe_invoice_delivery_events WHERE id=?').bind(row.id).run();try{assert.equal((await restored(childSendPath)).status,503);assert.equal((await restored(childSendPath+'/retry',{})).status,503);}finally{await putRow('stripe_invoice_delivery_events',row);}}
  assert.equal(provider.requests.length,before);await verify();
 });
 await t.test('restored delivery remains scoped to current finance grants and immutable source claims',async()=>{
  const before=provider.requests.length;await DB.prepare("DELETE FROM actor_finance_access WHERE id='finance'").run();try{assert.equal((await restored(childSendPath)).status,403);assert.equal((await restored(childSendPath+'/retry',{})).status,403);}finally{await putRow('actor_finance_access',image.tables.actor_finance_access.find(row=>row.id==='finance'));}
  assert.equal((await restored(childSendPath,undefined,'client')).status,403);const claimed=image.tables.time_details.find(row=>row.id===childInput.approved.id);await DB.prepare('UPDATE time_details SET invoice_ref=NULL WHERE id=?').bind(claimed.id).run();try{assert.ok((await restored(childSendPath+'/retry',{})).status>=400);}finally{await DB.prepare('UPDATE time_details SET invoice_ref=? WHERE id=?').bind(claimed.invoice_ref,claimed.id).run();}assert.equal(provider.requests.length,before);await verify();
 });

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

 await t.test('restored child issuance receipts retain finalized effects and cancelled original keys without provider access',async()=>{
  const before=provider.requests.length,disabled={STRIPE_MODE:undefined,STRIPE_SECRET_KEY:undefined};assert.deepEqual(await data(await restored(issuedPath,undefined,'finance','GET',disabled)),issuedPart);assert.deepEqual((await data(await restored(issuedPath+'/requests/'+issuedBody.requestId,undefined,'finance','GET',disabled))).operation,issuedPart);assert.deepEqual(await data(await restored(issuedPath,issuedBody,'finance','POST',disabled)),issuedPart);
  assert.equal((await data(await restored(lostIssuancePath,undefined,'finance','GET',disabled))).id,lostIssuance.id);assert.equal((await restored(lostIssuancePath,cancelledIssuanceBody)).status,409);assert.equal(provider.requests.length,before);assert.equal((await DB.prepare('SELECT attempt_at FROM stripe_part_issuance_operations WHERE id=?').bind(lostIssuance.id).first()).attempt_at,lostIssuanceRow.attempt_at);await verify();
 });
 await t.test('restored issuance lease and original journal prevent another effect or silent repair',async()=>{
  const before=posts().length;assert.equal((await restored(leasedIssuancePath+'/retry',{})).status,202);assert.equal(posts().length,before);assert.deepEqual(await DB.prepare('SELECT lease_token,lease_until FROM stripe_part_issuance_operations WHERE id=?').bind(leasedIssuance.id).first(),{lease_token:'synthetic-issuance-lease',lease_until:issuanceLeaseUntil});
  const events=image.tables.stripe_part_issuance_events.filter(row=>row.operation_id===lostIssuance.id).sort((a,b)=>a.revision-b.revision);for(const row of [events[0],events.at(-1)]){await DB.prepare('DELETE FROM stripe_part_issuance_events WHERE id=?').bind(row.id).run();try{assert.equal((await restored(lostIssuancePath)).status,503);assert.ok((await restored(lostIssuancePath+'/retry',{})).status>=400);}finally{await putRow('stripe_part_issuance_events',row);}}assert.equal(posts().length,before);await verify();
 });

 await t.test('restored child observations and client reads remain local with pending work and provider bindings disabled',async()=>{
  const before=provider.requests.length,disabled={STRIPE_MODE:undefined,STRIPE_SECRET_KEY:undefined};assert.deepEqual(await data(await restored(childBilling,undefined,'finance','GET',disabled)),childStored);assert.deepEqual(await data(await restored(childPortal,undefined,'client','GET',disabled)),childClientStored);assert.equal(provider.requests.length,before);assert.equal((await DB.prepare('SELECT state FROM stripe_event_inbox WHERE id=?').bind(childInboxId).first()).state,'PENDING');await verify();
 });
 await t.test('restored observation lease and original journals prevent work or silent historical repair',async()=>{
  const before=provider.requests.length;assert.equal((await restored(childBilling+'/reconcile',{})).status,409);assert.equal(provider.requests.length,before);assert.deepEqual(await DB.prepare('SELECT lease_token,lease_until FROM stripe_part_projection WHERE part_id=?').bind(childSchedule.parts[0].id).first(),{lease_token:'synthetic-child-observation-lease',lease_until:childObservationLeaseUntil});
  const events=image.tables.stripe_part_lifecycle_events.filter(row=>row.part_id===childSchedule.parts[0].id).sort((a,b)=>a.revision-b.revision);assert.ok(events.length>=2);for(const row of [events[0],events.at(-1)]){await DB.prepare('DELETE FROM stripe_part_lifecycle_events WHERE id=?').bind(row.id).run();try{assert.equal((await restored(childBilling)).status,503);assert.equal((await restored(childPortal,undefined,'client')).status,503);}finally{await putRow('stripe_part_lifecycle_events',row);}}assert.equal(provider.requests.length,before);await verify();
 });
 await t.test('restored child observations still require current client identity and project sharing',async()=>{
  const other=(await DB.prepare("SELECT client_id FROM actors WHERE id='other'").first()).client_id;await DB.prepare("UPDATE actors SET client_id=? WHERE id='client'").bind(other).run();try{assert.equal((await restored(childPortal,undefined,'client')).status,404);}finally{await DB.prepare("UPDATE actors SET client_id=? WHERE id='client'").bind(r.client.id).run();}await DB.prepare('UPDATE projects SET client_visible=0 WHERE id=?').bind(r.project.id).run();try{assert.equal((await restored(childPortal,undefined,'client')).status,404);}finally{await DB.prepare('UPDATE projects SET client_visible=1 WHERE id=?').bind(r.project.id).run();}await verify();
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
 await t.test('restored pending child event observes newer payment state once without provider writes or parent changes',async()=>{
  const before=posts().length,parent=await DB.prepare('SELECT * FROM invoice_drafts WHERE id=?').bind(childInput.invoice.id).first(),claimed=await DB.prepare('SELECT * FROM time_details WHERE id=?').bind(childInput.approved.id).first();await DB.prepare('UPDATE stripe_part_projection SET lease_token=NULL,lease_until=0 WHERE part_id=?').bind(childSchedule.parts[0].id).run();
  const applied=await data(await restored('stripe/events/'+childEventId+'/retry',{}));assert.equal(applied.state,'APPLIED');const observed=await data(await restored(childBilling));assert.equal(observed.paidMinor,300);assert.equal(observed.remainingMinor,childNative.total-300);assert.equal(observed.partId,childSchedule.parts[0].id);assert.equal(observed.stripeInvoiceId,childNative.id);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM stripe_part_lifecycle_events WHERE inbox_id=?').bind(childInboxId).first()).n,1);assert.equal((await data(await restored('stripe/events/'+childEventId+'/retry',{}))).state,'APPLIED');assert.equal((await DB.prepare('SELECT COUNT(*) n FROM stripe_part_lifecycle_events WHERE inbox_id=?').bind(childInboxId).first()).n,1);assert.equal(posts().length,before);assert.deepEqual(await DB.prepare('SELECT * FROM invoice_drafts WHERE id=?').bind(childInput.invoice.id).first(),parent);assert.deepEqual(await DB.prepare('SELECT * FROM time_details WHERE id=?').bind(childInput.approved.id).first(),claimed);
 });
 await t.test('restored unknown children retry their original intents against already-created external drafts',async()=>{
  for(const entry of [{path:balancePath,op:balance,row:balanceRow},{path:leasedChildPath,op:leasedChild,row:leasedChildRow}]){if(entry.op.id===leasedChild.id)await DB.prepare('UPDATE stripe_part_operations SET lease_token=NULL,lease_until=0 WHERE id=?').bind(entry.op.id).run();const original=provider.requests.find(r=>r.method==='POST'&&r.path==='/v1/invoices'&&r.params['metadata[ashbi_operation]']===entry.op.id),before=posts().length,nativeCount=provider.invoices.size;assert.ok(original);const result=await data(await restored(entry.path+'/retry',{}));assert.equal(result.state,'DONE');assert.equal(provider.invoices.size,nativeCount);const repeated=posts().slice(before).find(r=>r.path==='/v1/invoices');assert.ok(repeated);assert.equal(repeated.key,original.key);assert.deepEqual(repeated.params,original.params);assert.equal((await DB.prepare('SELECT create_attempt_at FROM stripe_part_operations WHERE id=?').bind(entry.op.id).first()).create_attempt_at,entry.row.create_attempt_at);}
 });
 await t.test('restored child finalization lost after its effect reconciles by GET with the original timestamp',async()=>{
  const before=posts().length,result=await data(await restored(lostIssuancePath+'/reconcile',{}));assert.equal(result.state,'DONE');assert.equal(result.id,lostIssuance.id);assert.equal(posts().length,before);assert.equal(provider.invoices.get(issuanceDrafts[0].stripeInvoiceId).status,'open');assert.equal((await DB.prepare('SELECT attempt_at FROM stripe_part_issuance_operations WHERE id=?').bind(lostIssuance.id).first()).attempt_at,lostIssuanceRow.attempt_at);
 });
 await t.test('restored unexecuted child finalization retries the same original path parameters and key',async()=>{
  await DB.prepare('UPDATE stripe_part_issuance_operations SET lease_token=NULL,lease_until=0 WHERE id=?').bind(leasedIssuance.id).run();const original=provider.requests.find(r=>r.method==='POST'&&r.path==='/v1/invoices/'+issuanceDrafts[1].stripeInvoiceId+'/finalize'),before=posts().length;assert.ok(original);const result=await data(await restored(leasedIssuancePath+'/retry',{}));assert.equal(result.state,'DONE');assert.equal(result.id,leasedIssuance.id);assert.equal(posts().length,before+1);const repeated=posts().at(-1);assert.equal(repeated.key,original.key);assert.equal(repeated.path,original.path);assert.deepEqual(repeated.params,original.params);assert.equal((await DB.prepare('SELECT attempt_at FROM stripe_part_issuance_operations WHERE id=?').bind(leasedIssuance.id).first()).attempt_at,leasedIssuanceRow.attempt_at);
 });
 await t.test('provider state newer than checkpoint reconciles by GET without duplicate finalization',async()=>{
  const before=posts().length,result=await data(await restored(externallyFinished.path+'/reconcile',{}));assert.equal(result.state,'DONE');assert.equal(posts().length,before);assert.equal(provider.invoices.get(externallyFinished.creation.stripeInvoiceId).status,'open');
 });
 await t.test('explicit retry of an unexecuted operation retains its first attempt and original provider key',async()=>{
  const original=provider.requests.findLast(p=>p.method==='POST'&&p.path==='/v1/invoices/'+retryable.creation.stripeInvoiceId+'/finalize'),before=posts().length,result=await data(await restored(retryable.path+'/retry',{}));assert.equal(result.state,'DONE');assert.equal(posts().length,before+1);assert.equal(posts().at(-1).key,original.key);assert.equal((await DB.prepare('SELECT attempt_at FROM stripe_invoice_issuance_operations WHERE id=?').bind(retryable.row.id).first()).attempt_at,retryable.row.attempt_at);
 });
 await t.test('restored signed send event recovers a lost child acknowledgement without another Send or financial mutation',async()=>{
  const before=posts().length,parent=await DB.prepare('SELECT * FROM invoice_drafts WHERE id=?').bind(childInput.invoice.id).first(),claimed=await DB.prepare('SELECT * FROM time_details WHERE id=?').bind(childInput.approved.id).first();
  const checked=await data(await restored(childSendPath+'/reconcile',{}));assert.equal(checked.state,'DONE');assert.equal(checked.matchingSentEventId,sendEvent.id);assert.equal((await DB.prepare('SELECT state FROM stripe_event_inbox WHERE id=?').bind(pendingSendInbox.id).first()).state,'PENDING');assert.equal(posts().length,before);
  assert.equal((await data(await restored('stripe/events/'+sendEvent.id+'/retry',{}))).state,'APPLIED');const recovered=await data(await restored(childSendPath));assert.equal(recovered.state,'DONE');assert.equal(recovered.matchingSentEventId,sendEvent.id);assert.equal(recovered.providerAcknowledgedAt,null);assert.equal(recovered.attemptAt,childSendRow.attempt_at);assert.equal(recovered.emailDelivery,'TEST_MODE_NO_EMAIL');
  const count=(await DB.prepare('SELECT COUNT(*) n FROM stripe_invoice_delivery_events WHERE operation_id=?').bind(childSend.id).first()).n;assert.equal((await data(await restored('stripe/events/'+sendEvent.id+'/retry',{}))).state,'APPLIED');assert.equal((await DB.prepare('SELECT COUNT(*) n FROM stripe_invoice_delivery_events WHERE operation_id=?').bind(childSend.id).first()).n,count);assert.equal(posts().length,before);assert.equal(provider.sendEffects.filter(row=>row.invoiceId===deposit.stripeInvoiceId).length,1);assert.deepEqual(await DB.prepare('SELECT * FROM invoice_drafts WHERE id=?').bind(childInput.invoice.id).first(),parent);assert.deepEqual(await DB.prepare('SELECT * FROM time_details WHERE id=?').bind(childInput.approved.id).first(),claimed);
 });
 await t.test('restored send retry retains the original key and first attempt after the preserved lease is released',async()=>{
  await DB.prepare('UPDATE stripe_invoice_delivery_operations SET lease_token=NULL,lease_until=0 WHERE id=?').bind(leasedSend.id).run();const original=provider.requests.find(row=>row.method==='POST'&&row.path==='/v1/invoices/'+leasedSend.stripeInvoiceId+'/send'),before=posts().length;assert.ok(original);const result=await data(await restored(leasedSendPath+'/retry',{}));assert.equal(result.state,'DONE');assert.equal(result.id,leasedSend.id);assert.equal(result.attemptAt,leasedSendRow.attempt_at);assert.equal(posts().length,before+1);assert.equal(posts().at(-1).key,original.key);assert.deepEqual(posts().at(-1).params,original.params);assert.equal(provider.sendEffects.filter(row=>row.invoiceId===leasedSend.stripeInvoiceId).length,1);
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
 assert.equal(Object.keys(image.tables).length,69);assert.equal(image.schema.filter(s=>s.type==='index').length,57);assert.ok(image.schema.some(s=>s.type==='index'&&s.name==='projects_archive'));
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
