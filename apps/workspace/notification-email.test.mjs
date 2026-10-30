import test from 'node:test';
import assert from 'node:assert/strict';
import {hubAuthFixture} from './hub-auth-fixture.mjs';
import {drainNotificationEmails,emailNotificationRoute,emailNotificationInternals} from './notification-email.mjs';
import {createWorker} from './worker.mjs';

const json=(value,status=200)=>Response.json(value,{status});
const readBody=async request=>request.json();
const actor={id:'native-staff',organization_id:'qa',role:'staff',client_id:null,email:'staff@example.invalid'};

async function setup(t){
 const f=await hubAuthFixture(createWorker);t.after(()=>f.close());
 await f.DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('email-project','qa','own','Email project',1)").run();
 await f.DB.prepare("INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at) VALUES('email-message','qa','email-project','native-client','email-request','Private preview must not be sent',?)").bind(Date.now()).run();
 await f.DB.prepare("INSERT INTO notification_preferences(organization_id,actor_id,email,email_enabled_since) VALUES('qa','native-staff',1,?) ON CONFLICT(organization_id,actor_id) DO UPDATE SET email=1,email_enabled_since=excluded.email_enabled_since").bind(Date.now()-1000).run();
 return f;
}

test('email delivery is disabled by default and does not create provider side effects',async t=>{
 const f=await setup(t),calls=[];
 const result=await drainNotificationEmails({DB:f.DB,APP_ORIGIN:'https://hub.ashbi.ca'},async(...args)=>{calls.push(args);throw Error('provider must not be called');});
 assert.deepEqual(result,{enabled:false,configured:false,processed:0,sent:0,retried:0,failed:0,uncertain:0});assert.equal(calls.length,0);assert.equal(await f.DB.prepare('SELECT count(*) n FROM notification_email_deliveries').first().then(r=>r.n),0);
});

test('email delivery is tenant scoped, generic, idempotent and retryable',async t=>{
 const f=await setup(t),calls=[];let lose=true;
 const env={DB:f.DB,APP_ORIGIN:'https://hub.ashbi.ca',EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_FROM:'Ashbi <notifications@example.invalid>',EMAIL:{send:async message=>{calls.push(message);assert.deepEqual(message.to,'staff@example.invalid');assert.deepEqual(message.from,{email:'notifications@example.invalid',name:'Ashbi'});assert.equal(message.subject,'New activity in your Ashbi Inbox');assert.doesNotMatch(JSON.stringify(message),/Private preview/);if(lose){lose=false;throw Error('synthetic lost acknowledgement');}return {messageId:'email-provider-id'};}}};
 let result=await drainNotificationEmails(env);assert.deepEqual(result,{enabled:true,configured:true,processed:1,sent:0,retried:0,failed:0,uncertain:1});assert.equal(calls.length,1);
 await f.DB.prepare("UPDATE notification_email_deliveries SET status='RETRY',next_attempt_at=0 WHERE item_id='email-message'").run();result=await drainNotificationEmails(env);assert.deepEqual(result,{enabled:true,configured:true,processed:1,sent:1,retried:0,failed:0,uncertain:0});assert.equal(calls.length,2);
 result=await drainNotificationEmails(env);assert.deepEqual(result,{enabled:true,configured:true,processed:0,sent:0,retried:0,failed:0,uncertain:0});assert.equal(calls.length,2);
 const status=await emailNotificationRoute(new Request('https://hub.ashbi.ca/api/inbox/email'),env,actor,readBody,json);const payload=await status.json();assert.equal(status.status,200);assert.equal(payload.email,true);assert.equal(payload.available,true);assert.equal(payload.items[0].status,'ACCEPTED');assert.equal(payload.items[0].provider_id,'email-provider-id');
});

test('muting and revoking an account prevent pending delivery and preserve tenant boundaries',async t=>{
 const f=await setup(t),calls=[];const env={DB:f.DB,APP_ORIGIN:'https://hub.ashbi.ca',EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_FROM:'Ashbi <notifications@example.invalid>'};
 await f.DB.prepare("UPDATE notification_preferences SET email=0 WHERE organization_id='qa' AND actor_id='native-staff'").run();assert.equal((await drainNotificationEmails(env,()=>{calls.push(1);return {messageId:'should-not-send'};})).processed,0);assert.equal(calls.length,0);
 await f.DB.prepare("UPDATE notification_preferences SET email=1 WHERE organization_id='qa' AND actor_id='native-staff'").run();await f.DB.prepare("UPDATE actors SET active=0 WHERE id='native-staff'").run();assert.equal((await drainNotificationEmails(env,()=>{calls.push(1);return {messageId:'should-not-send'};})).processed,0);assert.equal(calls.length,0);
 await f.DB.prepare("INSERT INTO actors(id,email,organization_id,role,client_id,active) VALUES('other-staff','other@example.invalid','other-org','staff',NULL,1)").run();await f.DB.prepare("INSERT INTO notification_preferences(organization_id,actor_id,email) VALUES('other-org','other-staff',1)").run();assert.equal((await f.DB.prepare('SELECT count(*) n FROM notification_email_deliveries').first()).n,0);
});

test('email preference endpoint validates exact input and hides delivery provider secrets',async t=>{
 const f=await setup(t),env={DB:f.DB,APP_ORIGIN:'https://hub.ashbi.ca'};
 const get=await emailNotificationRoute(new Request('https://hub.ashbi.ca/api/inbox/email'),env,actor,readBody,json);assert.equal((await get.json()).available,false);
 const put=await emailNotificationRoute(new Request('https://hub.ashbi.ca/api/inbox/email',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({email:false})}),env,actor,readBody,json);assert.deepEqual(await put.json(),{email:false,available:false,emailEnabledSince:null});
 const enabledEnv={...env,EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_FROM:'Ashbi <notifications@example.invalid>',EMAIL:{send:async()=>{throw Error('historical unread must not be sent');}}};
 const enable=await emailNotificationRoute(new Request('https://hub.ashbi.ca/api/inbox/email',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({email:true})}),enabledEnv,actor,readBody,json);const enabledPayload=await enable.json();assert.equal(enabledPayload.email,true);assert.equal(enabledPayload.available,true);assert.equal(typeof enabledPayload.emailEnabledSince,'number');
 const result=await drainNotificationEmails(enabledEnv);assert.deepEqual(result,{enabled:true,configured:true,processed:0,sent:0,retried:0,failed:0,uncertain:0});
 await assert.rejects(()=>emailNotificationRoute(new Request('https://hub.ashbi.ca/api/inbox/email?after=bad'),env,actor,readBody,json),error=>error===400);
 await assert.rejects(()=>emailNotificationRoute(new Request('https://hub.ashbi.ca/api/inbox/email',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({email:false,secret:'x'})}),env,actor,readBody,json),error=>error===400);
});

test('bounded scans exclude accepted events and leases prevent parallel duplicate sends',async t=>{
 const f=await setup(t),calls=[];const env={DB:f.DB,APP_ORIGIN:'https://hub.ashbi.ca',EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_FROM:'Ashbi <notifications@example.invalid>'};
 for(let i=0;i<55;i++)await f.DB.prepare("INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at) VALUES(?,?,?,?,?,?,?)").bind(`fair-${i}`,'qa','email-project','native-client',`fair-request-${i}`,'generic',Date.now()+i).run();
 const send=async message=>{calls.push(message);return {messageId:'provider-'+calls.length};};
 await Promise.all([drainNotificationEmails(env,send),drainNotificationEmails(env,send)]);assert.ok(calls.length<=20);const accepted=await f.DB.prepare("SELECT count(*) n FROM notification_email_deliveries WHERE status='ACCEPTED'").first();assert.equal(accepted.n,calls.length);
 const third=await drainNotificationEmails(env,send);assert.ok(third.processed<=10);assert.equal((await f.DB.prepare("SELECT count(*) n FROM notification_email_deliveries WHERE status='ACCEPTED'").first()).n,calls.length);
});

test('expired and changed snapshots stop before provider transport',async t=>{
 const f=await setup(t),calls=[];const env={DB:f.DB,APP_ORIGIN:'https://hub.ashbi.ca',EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_FROM:'Ashbi <notifications@example.invalid>'};
 await f.DB.prepare("INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at) VALUES('expired-email','qa','email-project','native-client','expired-request','generic',?)").bind(Date.now()-emailNotificationInternals.EVENT_TTL_MS-1).run();
 await f.DB.prepare("UPDATE notification_preferences SET email_enabled_since=0 WHERE organization_id='qa' AND actor_id='native-staff'").run();
 const first=await drainNotificationEmails(env,async message=>{calls.push(message);throw Error('lost');});assert.equal(first.processed,1);assert.equal(calls.length,1);assert.equal((await f.DB.prepare("SELECT status FROM notification_email_deliveries WHERE item_id='expired-email'").first()).status,'FAILED');
 await f.DB.prepare("UPDATE notification_email_deliveries SET status='RETRY',attempts=4,next_attempt_at=0,lease_until=0 WHERE item_id='email-message'").run();const exhausted=await drainNotificationEmails(env,async message=>{calls.push(message);throw Error('attempt budget must stop transport');});assert.equal(exhausted.processed,0);assert.equal(calls.length,1);assert.deepEqual(await f.DB.prepare("SELECT status,error_code FROM notification_email_deliveries WHERE item_id='email-message'").first(),{status:'FAILED',error_code:'attempts_exhausted'});
 await f.DB.prepare("UPDATE notification_email_deliveries SET status='RETRY',attempts=1,next_attempt_at=0 WHERE item_id='email-message'").run();const changed=await drainNotificationEmails({...env,EMAIL_FROM:'Ashbi <changed@example.invalid>'},async message=>{calls.push(message);return {messageId:'no'};});assert.equal(changed.processed,0);assert.equal(calls.length,1);assert.equal((await f.DB.prepare("SELECT status FROM notification_email_deliveries WHERE item_id='email-message'").first()).status,'DISABLED');
});

test('global actor cursor reaches actors beyond the first hundred',async t=>{
 const f=await setup(t),calls=[];const env={DB:f.DB,APP_ORIGIN:'https://hub.ashbi.ca',EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_FROM:'Ashbi <notifications@example.invalid>'};
 for(let i=0;i<105;i++){
  const id=`actor-${String(i).padStart(3,'0')}`;await f.DB.prepare("INSERT INTO actors(id,email,organization_id,role,client_id,active) VALUES(?,?,?,?,NULL,1)").bind(id,`${id}@example.invalid`,'qa','staff').run();await f.DB.prepare("INSERT INTO notification_preferences(organization_id,actor_id,email,email_enabled_since) VALUES(?,?,1,0)").bind('qa',id).run();
 }
 await f.DB.prepare("INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at) VALUES('cursor-message','qa','email-project','native-client','cursor-request','generic',?)").bind(Date.now()).run();
 await f.DB.prepare("DELETE FROM project_messages WHERE id='email-message'").run();
 await f.DB.prepare("UPDATE notification_preferences SET email=0 WHERE actor_id LIKE 'actor-%' AND actor_id<>'actor-104'").run();
 await f.DB.prepare("UPDATE notification_preferences SET email=0 WHERE actor_id='native-staff'").run();
 await f.DB.prepare("INSERT INTO notification_email_scheduler(id,organization_id,actor_id,updated_at) VALUES(1,'qa','actor-099',0)").run();
 const result=await drainNotificationEmails(env,async message=>{calls.push(message.to);return {messageId:'cursor-provider'};});assert.equal(result.sent,1);assert.deepEqual(calls,['actor-104@example.invalid']);
});

test('unknown Cloudflare binding outcomes are uncertain and never automatically resent',async t=>{
 const f=await setup(t),env={DB:f.DB,APP_ORIGIN:'https://hub.ashbi.ca',EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_FROM:'Ashbi <notifications@example.invalid>'};
 const result=await drainNotificationEmails(env,async()=>{throw Error('transport outcome unknown');});assert.equal(result.uncertain,1);const row=await f.DB.prepare("SELECT status,error_code FROM notification_email_deliveries WHERE item_id='email-message'").first();assert.deepEqual(row,{status:'UNCERTAIN',error_code:'provider_unknown'});
 const again=await drainNotificationEmails(env,async()=>{throw Error('must not retry unknown outcome');});assert.equal(again.processed,0);
});

test('only allowlisted Cloudflare errors retry and expired claims become terminal uncertain',async t=>{
 const f=await setup(t),env={DB:f.DB,APP_ORIGIN:'https://hub.ashbi.ca',EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_FROM:'Ashbi <notifications@example.invalid>'};
 const transient=async()=>{const error=Error('rate limited');error.code='E_RATE_LIMIT_EXCEEDED';throw error;};
 const first=await drainNotificationEmails(env,transient);assert.equal(first.retried,1);assert.deepEqual(await f.DB.prepare("SELECT status,error_code FROM notification_email_deliveries WHERE item_id='email-message'").first(),{status:'RETRY',error_code:'rate_limit'});
 await f.DB.prepare("UPDATE notification_email_deliveries SET next_attempt_at=0").run();const terminal=async()=>{const error=Error('sender is not verified');error.code='E_SENDER_NOT_VERIFIED';throw error;};const second=await drainNotificationEmails(env,terminal);assert.equal(second.failed,1);assert.deepEqual(await f.DB.prepare("SELECT status,error_code FROM notification_email_deliveries WHERE item_id='email-message'").first(),{status:'FAILED',error_code:'sender_not_verified'});
 await f.DB.prepare("UPDATE notification_email_deliveries SET status='PENDING',attempts=1,lease_until=1,lease_token='expired',next_attempt_at=0").run();const expired=await drainNotificationEmails(env,async()=>{throw Error('expired lease must not send');});assert.equal(expired.processed,0);assert.deepEqual(await f.DB.prepare("SELECT status,error_code FROM notification_email_deliveries WHERE item_id='email-message'").first(),{status:'UNCERTAIN',error_code:'lease_expired'});
});

test('exact stale checks do not disable an eligible event outside the candidate scan window',async t=>{
 const f=await setup(t),env={DB:f.DB,APP_ORIGIN:'https://hub.ashbi.ca',EMAIL_NOTIFICATIONS_ENABLED:'true',EMAIL_FROM:'Ashbi <notifications@example.invalid>'};
 const base=Date.now();await f.DB.prepare("UPDATE notification_preferences SET email_enabled_since=0 WHERE organization_id='qa' AND actor_id='native-staff'").run();
 for(let i=0;i<501;i++)await f.DB.prepare("INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at) VALUES(?,?,?,?,?,?,?)").bind(`bulk-${String(i).padStart(3,'0')}`,'qa','email-project','native-client',`bulk-request-${i}`,'generic',base+i).run();
 await f.DB.prepare("INSERT INTO notification_email_deliveries(organization_id,actor_id,kind,item_id,idempotency_key,status,attempts,next_attempt_at,lease_until,recipient_email,sender,payload_fingerprint,created_at,updated_at) VALUES('qa','native-staff','message','bulk-000','inbox/qa/native-staff/message/bulk-000','RETRY',1,0,0,'staff@example.invalid','Ashbi <notifications@example.invalid>','v1|https://hub.ashbi.ca',?,?)").bind(base,base).run();
 await drainNotificationEmails(env,async()=>({messageId:'bulk-provider'}));
 assert.equal((await f.DB.prepare("SELECT status FROM notification_email_deliveries WHERE item_id='bulk-000'").first()).status,'RETRY');
});
