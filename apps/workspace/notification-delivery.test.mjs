import test from 'node:test';
import assert from 'node:assert/strict';
import {hubAuthFixture} from './hub-auth-fixture.mjs';

const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');
const routedWorker=(resolveKey,providers={})=>createWorker(resolveKey,providers);
const b64url=bytes=>Buffer.from(bytes).toString('base64url');
const pushConfig=async()=>{const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),publicRaw=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)),privateJwk=await crypto.subtle.exportKey('jwk',pair.privateKey);return {PUSH_NOTIFICATIONS_ENABLED:'true',PUSH_VAPID_PUBLIC_KEY:b64url(publicRaw),PUSH_VAPID_PRIVATE_KEY:privateJwk.d,PUSH_VAPID_SUBJECT:'mailto:notifications@example.invalid',PUSH_ENDPOINT_ALLOWLIST:'push.example.invalid'};};
const subscription=await (async()=>{const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),publicRaw=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)),auth=crypto.getRandomValues(new Uint8Array(16));return {endpoint:'https://push.example.invalid/send/abc',keys:{p256dh:b64url(publicRaw),auth:b64url(auth)}};})();

test('routed delivery settings default off, stay tenant-scoped and reject unauthorized mutations',async t=>{
 const f=await hubAuthFixture(routedWorker);t.after(()=>f.close());
 const unauthEmail=await f.call('/api/inbox/email',{cookie:undefined});assert.equal(unauthEmail.status,401);
 const unauthPush=await f.call('/api/inbox/push',{cookie:undefined});assert.equal(unauthPush.status,401);
 f.login();
 const email=await f.call('/api/inbox/email',{cookie:f.cookie});assert.equal(email.status,200);assert.deepEqual(await email.json(),{email:false,available:false,emailEnabledSince:null,items:[],nextCursor:null});
 const push=await f.call('/api/inbox/push',{cookie:f.cookie});assert.equal(push.status,200);assert.deepEqual(await push.json(),{available:false,publicKey:null,subscriptions:[]});
 const wrongEmail=await f.call('/api/inbox/email',{method:'PUT',cookie:f.cookie,body:{email:true},headers:{Origin:'https://foreign.invalid'}});assert.equal(wrongEmail.status,403);
 const wrongPush=await f.call('/api/inbox/push',{method:'POST',cookie:f.cookie,body:subscription,headers:{Origin:'https://foreign.invalid'}});assert.equal(wrongPush.status,403);
 const staffEnable=await f.call('/api/inbox/email',{method:'PUT',cookie:f.cookie,body:{email:true}});assert.equal(staffEnable.status,200);const enabled=await staffEnable.json();assert.equal(enabled.email,true);assert.equal(enabled.available,false);assert.equal(typeof enabled.emailEnabledSince,'number');
 f.env=Object.assign(f.env,await pushConfig());
 const enabledPush=await f.call('/api/inbox/push',{cookie:f.cookie});assert.equal(enabledPush.status,200,await enabledPush.clone().text());assert.equal((await enabledPush.json()).available,true);
 const register=await f.call('/api/inbox/push',{method:'POST',cookie:f.cookie,body:subscription});assert.equal(register.status,201,await register.clone().text());const registered=await register.json();assert.match(registered.subscription.id,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(registered),/push\.example|A{20}|B{20}/);
 const staffPush=await f.call('/api/inbox/push',{cookie:f.cookie});assert.equal(staffPush.status,200);const staffPushPayload=await staffPush.json();assert.equal(staffPushPayload.subscriptions.length,1);assert.equal(staffPushPayload.subscriptions[0].id,registered.subscription.id);assert.doesNotMatch(JSON.stringify(staffPushPayload),/push\.example|p256dh|auth|PUSH_VAPID_PRIVATE_KEY/);
 f.setUser({id:'hub-client',email:'client@example.invalid',organizationId:'hub-org',role:'CLIENT'});f.login();
 const clientEmail=await f.call('/api/inbox/email',{cookie:f.cookie});assert.equal(clientEmail.status,200);assert.equal((await clientEmail.json()).email,false);
 const clientPush=await f.call('/api/inbox/push',{cookie:f.cookie});assert.equal(clientPush.status,200);assert.deepEqual((await clientPush.json()).subscriptions,[]);
 const clientDelete=await f.call('/api/inbox/push',{method:'DELETE',cookie:f.cookie,body:{id:registered.subscription.id}});assert.equal(clientDelete.status,200);
 await f.DB.prepare("INSERT INTO actors VALUES('foreign-staff','foreign@example.invalid','foreign-org','staff',NULL,1)").run();f.env.HUB_AUTH_ORGANIZATION_ID='foreign-org';f.setUser({id:'hub-foreign',email:'foreign@example.invalid',organizationId:'foreign-org',role:'TEAM'});f.login();
 const foreignPush=await f.call('/api/inbox/push',{cookie:f.cookie});assert.equal(foreignPush.status,200);assert.deepEqual((await foreignPush.json()).subscriptions,[]);
});

test('scheduled delivery stays side-effect free when providers are not configured',async t=>{
 const calls=[];const providers={emailSend:()=>{calls.push('email');throw Error('email provider must stay disabled');},pushSend:()=>{calls.push('push');throw Error('push provider must stay disabled');},stripeFetch:()=>{calls.push('stripe');throw Error('stripe provider must stay idle');}};
 const f=await hubAuthFixture((resolveKey,fixtureProviders)=>createWorker(resolveKey,{...fixtureProviders,...providers}));t.after(()=>f.close());
 const before=await Promise.all([f.DB.prepare('SELECT COUNT(*) n FROM notification_email_deliveries').first(),f.DB.prepare('SELECT COUNT(*) n FROM push_delivery_events').first()]);
 await f.worker.scheduled({},f.env,{});assert.deepEqual(calls,[]);
 const after=await Promise.all([f.DB.prepare('SELECT COUNT(*) n FROM notification_email_deliveries').first(),f.DB.prepare('SELECT COUNT(*) n FROM push_delivery_events').first()]);assert.deepEqual(after,before);
});

test('scheduled delivery accepts one new unread item per opted-in channel and stays idempotent',async t=>{
 const emailCalls=[],pushCalls=[];const providers={emailSend:async message=>{emailCalls.push(message);return {messageId:'email-acceptance-1'};},pushSend:async request=>{pushCalls.push(request);return {status:201};}};
 const f=await hubAuthFixture((resolveKey,fixtureProviders)=>createWorker(resolveKey,{...fixtureProviders,...providers}));t.after(()=>f.close());f.login();
 Object.assign(f.env,await pushConfig(),{EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_FROM:'Ashbi <notifications@example.invalid>'});
 const emailOptIn=await f.call('/api/inbox/email',{method:'PUT',cookie:f.cookie,body:{email:true}});assert.equal(emailOptIn.status,200,await emailOptIn.clone().text());
 const pushOptIn=await f.call('/api/inbox/push',{method:'POST',cookie:f.cookie,body:subscription});assert.equal(pushOptIn.status,201,await pushOptIn.clone().text());
 await f.DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('scheduled-project','qa','own','Scheduled project',1)").run();
 const createdAt=Date.now();await f.DB.prepare("INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at) VALUES('scheduled-message','qa','scheduled-project','native-client','scheduled-request','Synthetic unread activity',?)").bind(createdAt).run();
 await f.worker.scheduled({},f.env,{});assert.equal(emailCalls.length,1);assert.equal(pushCalls.length,1);
 assert.deepEqual(emailCalls[0].to,'staff@example.invalid');assert.deepEqual(emailCalls[0].from,{email:'notifications@example.invalid',name:'Ashbi'});assert.doesNotMatch(JSON.stringify(emailCalls[0]),/Synthetic unread activity/);
 assert.equal(pushCalls[0].actor.id,'native-staff');assert.equal(pushCalls[0].payload.body,'You have a new message.');assert.doesNotMatch(JSON.stringify(pushCalls[0].payload),/Synthetic unread activity/);
 const emailRow=await f.DB.prepare("SELECT status,provider_id FROM notification_email_deliveries WHERE organization_id='qa' AND actor_id='native-staff' AND item_id='scheduled-message'").first();assert.deepEqual(emailRow,{status:'ACCEPTED',provider_id:'email-acceptance-1'});
 const pushRow=await f.DB.prepare("SELECT state FROM push_delivery_events WHERE organization_id='qa' AND actor_id='native-staff' AND event_key='message:scheduled-message'").first();assert.deepEqual(pushRow,{state:'sent'});
 await f.worker.scheduled({},f.env,{});assert.equal(emailCalls.length,1);assert.equal(pushCalls.length,1);
});

test('notifications service worker is public but private by default',async t=>{
 const f=await hubAuthFixture(routedWorker);t.after(()=>f.close());
 const response=await f.worker.fetch(new Request(f.env.APP_ORIGIN+'/notifications-sw.js'),f.env);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^application\/javascript/);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);const body=await response.text();assert.match(body,/showNotification/);assert.doesNotMatch(body,/PUSH_VAPID_PRIVATE_KEY|EMAIL_FROM|p256dh/);
});
