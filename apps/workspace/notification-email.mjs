import {feed} from './inbox.mjs';

const MAX_PER_RUN=50,PER_ACTOR_MAX=10,MAX_ATTEMPTS=4,LEASE_MS=120000,RETRY_BASE_MS=60000,RETRY_MAX_MS=6*60*60*1000,EVENT_TTL_MS=24*60*60*1000,RETRY_TTL_MS=23*60*60*1000,PROVIDER_TIMEOUT_MS=10000;
const kinds=new Set(['message','assignment','deadline','upload']);
const transientProviderCodes=new Map([['E_RATE_LIMIT_EXCEEDED','rate_limit'],['E_DAILY_LIMIT_EXCEEDED','daily_limit'],['E_DELIVERY_FAILED','delivery_failed'],['E_INTERNAL_SERVER_ERROR','provider_internal']]);
const terminalProviderCodes=new Map([
 ['E_VALIDATION_ERROR','validation_error'],['E_FIELD_MISSING','field_missing'],['E_TOO_MANY_RECIPIENTS','too_many_recipients'],['E_TOO_MANY_ATTACHMENTS','too_many_attachments'],
 ['E_SENDER_NOT_VERIFIED','sender_not_verified'],['E_RECIPIENT_NOT_ALLOWED','recipient_not_allowed'],['E_RECIPIENT_SUPPRESSED','recipient_suppressed'],['E_ACCOUNT_SUSPENDED','account_suspended'],
 ['E_SENDER_DOMAIN_NOT_AVAILABLE','sender_domain_unavailable'],['E_CONTENT_TOO_LARGE','content_too_large'],['E_HEADER_NOT_ALLOWED','header_not_allowed'],['E_HEADER_USE_API_FIELD','header_use_api_field'],
 ['E_HEADER_VALUE_INVALID','header_value_invalid'],['E_HEADER_VALUE_TOO_LONG','header_value_too_long'],['E_HEADER_NAME_INVALID','header_name_invalid'],['E_HEADERS_TOO_LARGE','headers_too_large'],['E_HEADERS_TOO_MANY','headers_too_many']
]);

function enabled(env){return env?.EMAIL_NOTIFICATIONS_ENABLED==='true';}
function canonicalOrigin(value){
 if(typeof value!=='string'||value.length>2048)return null;
 try{
  const url=new URL(value);
  if(url.username.length>0)return null;
  if(url.password.length>0)return null;
  if(url.protocol!=='https:'||url.port||url.pathname!=='/'||url.search||url.hash)return null;
  return url.origin;
 }catch{return null;}
}
function boundedEmail(value){return typeof value==='string'&&value.length>0&&value.length<=320&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
function parseSender(value){
 if(typeof value!=='string'||value.length>320)return null;
 const trimmed=value.trim(),named=trimmed.match(/^([^<>\r\n]{1,200})\s*<([^<>\s]+)>$/);
 if(named&&boundedEmail(named[2]))return {email:named[2],name:named[1].trim()||undefined};
 return boundedEmail(trimmed)?{email:trimmed}:null;
}
function configured(env,sendOverride){return enabled(env)&&Boolean(parseSender(env.EMAIL_FROM))&&Boolean(canonicalOrigin(env.APP_ORIGIN))&&(typeof sendOverride==='function'||typeof env?.EMAIL?.send==='function');}
function genericMessage(env){
 const origin=canonicalOrigin(env?.APP_ORIGIN);
 return {subject:'New activity in your Ashbi Inbox',text:`You have new activity in your Ashbi Inbox. Open Ashbi to review it${origin?`: ${origin}/#inbox`:'.'}.`};
}
function nowMs(clock){return typeof clock==='function'?clock():Date.now();}
function retryAt(now,attempts){return now+Math.min(RETRY_MAX_MS,RETRY_BASE_MS*2**Math.max(0,attempts-1));}
function snapshot(env,actor){return {recipientEmail:actor.email,sender:env.EMAIL_FROM,payloadFingerprint:`v1|${env.APP_ORIGIN||''}`};}
async function idempotencyKey(actor,row){
 const raw=`inbox/${actor.organization_id}/${actor.id}/${row.kind}/${row.id}`;
 if(raw.length<=200)return raw;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([actor.organization_id,actor.id,row.kind,row.id])));
 return `inbox/${Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}

async function candidatesFor(db,actor,limit=500,now=Date.now()){
 const {sql,args}=feed(actor);
 const rows=await db.prepare(sql+"SELECT kind,id,project_name,created_at,unread FROM candidates WHERE unread=1 AND NOT EXISTS (SELECT 1 FROM notification_email_deliveries d WHERE d.organization_id=? AND d.actor_id=? AND d.kind=candidates.kind AND d.item_id=candidates.id AND (d.status IN ('ACCEPTED','FAILED','DISABLED','UNCERTAIN') OR d.next_attempt_at>? OR d.lease_until>?)) ORDER BY created_at DESC,kind DESC,id DESC LIMIT ?").bind(...args,actor.organization_id,actor.id,now,now,limit).all();
 return rows.results.filter(row=>kinds.has(row.kind));
}

async function currentActor(db,actor){
 return db.prepare('SELECT a.id,a.organization_id,a.role,a.client_id,a.email actor_email,a.active,COALESCE(n.email,0) email_enabled,n.email_enabled_since FROM actors a LEFT JOIN notification_preferences n ON n.actor_id=a.id AND n.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=? AND a.role=? AND a.client_id IS ?').bind(actor.id,actor.organization_id,actor.role,actor.client_id??null).first();
}

async function eventEligible(db,actor,delivery,now){
 const current=await currentActor(db,actor);if(!current?.active||current.email_enabled!==1||current.actor_email!==delivery.recipient_email||current.email_enabled_since===null||Number(current.email_enabled_since)>Number(delivery.created_at))return false;
 const {sql,args}=feed({id:current.id,organization_id:current.organization_id,role:current.role,client_id:current.client_id});
 const exact=await db.prepare(sql+'SELECT 1 FROM candidates WHERE kind=? AND id=? AND unread=1 AND created_at>=? LIMIT 1').bind(...args,delivery.kind,delivery.item_id,current.email_enabled_since).first();
 return Boolean(exact)&&now-Number(delivery.created_at)<=EVENT_TTL_MS;
}

async function disableStale(db,actor,now){
 const rows=await db.prepare("SELECT * FROM notification_email_deliveries WHERE organization_id=? AND actor_id=? AND status IN ('PENDING','RETRY','UNCERTAIN') ORDER BY updated_at LIMIT 20").bind(actor.organization_id,actor.id).all();
 for(const row of rows.results){if(!await eventEligible(db,actor,row,now))await db.prepare("UPDATE notification_email_deliveries SET status='DISABLED',lease_until=0,lease_token=NULL,updated_at=? WHERE organization_id=? AND actor_id=? AND kind=? AND item_id=? AND status IN ('PENDING','RETRY','UNCERTAIN')").bind(now,actor.organization_id,actor.id,row.kind,row.item_id).run();}
}

async function createOrClaim(db,env,actor,row,now){
 const key=await idempotencyKey(actor,row);
 const current=snapshot(env,actor);
 await db.prepare("INSERT INTO notification_email_deliveries(organization_id,actor_id,kind,item_id,idempotency_key,status,attempts,next_attempt_at,created_at,updated_at,recipient_email,sender,payload_fingerprint) VALUES(?,?,?,?,?,'PENDING',0,?,?,?,?,?,?) ON CONFLICT(organization_id,actor_id,kind,item_id) DO NOTHING").bind(actor.organization_id,actor.id,row.kind,row.id,key,now,row.created_at,now,current.recipientEmail,current.sender,current.payloadFingerprint).run();
 const existing=await db.prepare('SELECT * FROM notification_email_deliveries WHERE organization_id=? AND actor_id=? AND kind=? AND item_id=?').bind(actor.organization_id,actor.id,row.kind,row.id).first();
 if(!existing||existing.status==='ACCEPTED'||existing.status==='FAILED'||existing.status==='DISABLED')return null;
 if(existing.recipient_email!==current.recipientEmail||existing.sender!==current.sender||existing.payload_fingerprint!==current.payloadFingerprint){await db.prepare("UPDATE notification_email_deliveries SET status='DISABLED',lease_until=0,lease_token=NULL,updated_at=?,error_code='snapshot_changed' WHERE organization_id=? AND actor_id=? AND kind=? AND item_id=? AND status IN ('PENDING','RETRY','UNCERTAIN')").bind(now,actor.organization_id,actor.id,row.kind,row.id).run();return null;}
 if(existing.status==='PENDING'&&Number(existing.attempts)>0&&Number(existing.lease_until)>0&&Number(existing.lease_until)<=now){await db.prepare("UPDATE notification_email_deliveries SET status='UNCERTAIN',lease_until=0,lease_token=NULL,updated_at=?,error_code='lease_expired' WHERE organization_id=? AND actor_id=? AND kind=? AND item_id=? AND status='PENDING'").bind(now,actor.organization_id,actor.id,row.kind,row.id).run();return null;}
 if(now-Number(existing.created_at)>=RETRY_TTL_MS){await db.prepare("UPDATE notification_email_deliveries SET status='FAILED',lease_until=0,lease_token=NULL,updated_at=?,error_code='expired' WHERE organization_id=? AND actor_id=? AND kind=? AND item_id=? AND status IN ('PENDING','RETRY','UNCERTAIN')").bind(now,actor.organization_id,actor.id,row.kind,row.id).run();return null;}
 if(Number(existing.attempts)>=MAX_ATTEMPTS){await db.prepare("UPDATE notification_email_deliveries SET status='FAILED',lease_until=0,lease_token=NULL,updated_at=?,error_code='attempts_exhausted' WHERE organization_id=? AND actor_id=? AND kind=? AND item_id=? AND status IN ('PENDING','RETRY','UNCERTAIN')").bind(now,actor.organization_id,actor.id,row.kind,row.id).run();return null;}
 const token=crypto.randomUUID(),until=now+LEASE_MS;
 const claimed=await db.prepare("UPDATE notification_email_deliveries SET status='PENDING',attempts=attempts+1,lease_until=?,lease_token=?,last_attempt_at=?,updated_at=? WHERE organization_id=? AND actor_id=? AND kind=? AND item_id=? AND status IN ('PENDING','RETRY') AND next_attempt_at<=? AND (lease_until=0 OR lease_until<?) AND attempts<? RETURNING *").bind(until,token,now,now,actor.organization_id,actor.id,row.kind,row.id,now,now,MAX_ATTEMPTS).first();
 return claimed?.lease_token===token?claimed:null;
}

async function sendEmail(env,sendFn,actor,delivery){
 const message=genericMessage(env),from=parseSender(delivery.sender);
 if(!from){const error=new Error('sender_invalid');error.providerCode='sender_invalid';throw error;}
 let timer;
 try{
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('provider_timeout');error.providerCode='provider_timeout';reject(error);},PROVIDER_TIMEOUT_MS);});
  const result=await Promise.race([Promise.resolve().then(()=>sendFn({to:delivery.recipient_email,from,subject:message.subject,text:message.text})),timeout]);
  if(typeof result?.messageId!=='string'||result.messageId.length<1||result.messageId.length>512||/[\u0000-\u001f\u007f]/.test(result.messageId)){const error=new Error('provider_missing_id');error.providerCode='provider_missing_id';throw error;}
  return {providerId:result.messageId};
 }finally{if(timer)clearTimeout(timer);}
}

function providerFailure(error){
 const providerCode=typeof error?.code==='string'?error.code:'';
 if(transientProviderCodes.has(providerCode))return {status:'RETRY',code:transientProviderCodes.get(providerCode)};
 if(terminalProviderCodes.has(providerCode))return {status:'FAILED',code:terminalProviderCodes.get(providerCode)};
 if(error?.providerCode==='sender_invalid')return {status:'FAILED',code:'sender_invalid'};
 if(error?.providerCode==='provider_missing_id')return {status:'UNCERTAIN',code:'provider_missing_id'};
 return {status:'UNCERTAIN',code:error?.providerCode==='provider_timeout'?'provider_timeout':'provider_unknown'};
}

async function deliverOne(env,db,sendFn,actor,delivery,now){
 // eligibility is checked again after claiming; age uses the injected job clock.
 if(now-Number(delivery.created_at)>=RETRY_TTL_MS||!await eventEligible(db,actor,delivery,now)){
  await db.prepare("UPDATE notification_email_deliveries SET status='DISABLED',lease_until=0,lease_token=NULL,error_code='eligibility_changed',updated_at=? WHERE organization_id=? AND actor_id=? AND kind=? AND item_id=? AND lease_token=?").bind(now,actor.organization_id,actor.id,delivery.kind,delivery.item_id,delivery.lease_token).run();return 'DISABLED';
 }
 try{
  const result=await sendEmail(env,sendFn,actor,delivery);
  await db.prepare("UPDATE notification_email_deliveries SET status='ACCEPTED',lease_until=0,lease_token=NULL,provider_id=?,error_code=NULL,updated_at=? WHERE organization_id=? AND actor_id=? AND kind=? AND item_id=? AND lease_token=?").bind(result.providerId,now,actor.organization_id,actor.id,delivery.kind,delivery.item_id,delivery.lease_token).run();
  return 'ACCEPTED';
 }catch(error){
  const attempts=Number(delivery.attempts)||1,expired=attempts>=MAX_ATTEMPTS||now-Number(delivery.created_at)>=RETRY_TTL_MS,classified=providerFailure(error),status=expired?'FAILED':classified.status;
  await db.prepare(`UPDATE notification_email_deliveries SET status=?,next_attempt_at=?,lease_until=0,lease_token=NULL,error_code=?,updated_at=? WHERE organization_id=? AND actor_id=? AND kind=? AND item_id=? AND lease_token=?`).bind(status,status==='RETRY'?retryAt(now,attempts):now,expired?'attempts_exhausted':classified.code,now,actor.organization_id,actor.id,delivery.kind,delivery.item_id,delivery.lease_token).run();
  return status;
 }
}

async function actorWindow(db){
 const cursor=await db.prepare('SELECT organization_id,actor_id FROM notification_email_scheduler WHERE id=1').first()||{organization_id:'',actor_id:''};
 const select="SELECT a.id,a.organization_id,a.role,a.client_id,a.email,n.email_enabled_since FROM actors a JOIN notification_preferences n ON n.actor_id=a.id AND n.organization_id=a.organization_id WHERE a.active=1 AND n.email=1 AND n.email_enabled_since IS NOT NULL AND (a.organization_id>? OR (a.organization_id=? AND a.id>?)) ORDER BY a.organization_id,a.id LIMIT ?";
 const forward=(await db.prepare(select).bind(cursor.organization_id||'',cursor.organization_id||'',cursor.actor_id||'',20).all()).results;
 if(forward.length===20||(!cursor.organization_id&&!cursor.actor_id))return forward;
 if(!forward.length){const first="SELECT a.id,a.organization_id,a.role,a.client_id,a.email,n.email_enabled_since FROM actors a JOIN notification_preferences n ON n.actor_id=a.id AND n.organization_id=a.organization_id WHERE a.active=1 AND n.email=1 AND n.email_enabled_since IS NOT NULL ORDER BY a.organization_id,a.id LIMIT 20";return (await db.prepare(first).all()).results;}
 const before="SELECT a.id,a.organization_id,a.role,a.client_id,a.email,n.email_enabled_since FROM actors a JOIN notification_preferences n ON n.actor_id=a.id AND n.organization_id=a.organization_id WHERE a.active=1 AND n.email=1 AND n.email_enabled_since IS NOT NULL AND (a.organization_id<? OR (a.organization_id=? AND a.id<?)) ORDER BY a.organization_id,a.id LIMIT ?";
 const wrapped=(await db.prepare(before).bind(cursor.organization_id,cursor.organization_id,cursor.actor_id,20-forward.length).all()).results;return forward.concat(wrapped);
}

export async function drainNotificationEmails(env,fetchOverride,clock){
 if(!configured(env,fetchOverride)||!env?.DB)return {enabled:enabled(env),configured:false,processed:0,sent:0,retried:0,failed:0,uncertain:0};
 const sendFn=fetchOverride||env.EMAIL.send.bind(env.EMAIL);
 const actors=await actorWindow(env.DB);let lastScanned=null;
 let processed=0,sent=0,retried=0,failed=0,uncertain=0;
 for(const actor of actors){
  if(processed>=MAX_PER_RUN)break;
  lastScanned=actor;
  await disableStale(env.DB,actor,nowMs(clock));
  const visible=(await candidatesFor(env.DB,actor,500,nowMs(clock))).filter(row=>Number(row.created_at)>=Number(actor.email_enabled_since));
  const active=visible.slice(0,PER_ACTOR_MAX);
  for(const row of active){if(processed>=MAX_PER_RUN)break;if(!boundedEmail(actor.email))continue;const delivery=await createOrClaim(env.DB,env,actor,row,nowMs(clock));if(!delivery)continue;processed++;const status=await deliverOne(env,env.DB,sendFn,actor,delivery,nowMs(clock));if(status==='ACCEPTED')sent++;else if(status==='RETRY')retried++;else if(status==='UNCERTAIN')uncertain++;else failed++;}
 }
 if(lastScanned)await env.DB.prepare('INSERT INTO notification_email_scheduler(id,organization_id,actor_id,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,actor_id=excluded.actor_id,updated_at=excluded.updated_at').bind(lastScanned.organization_id,lastScanned.id,nowMs(clock)).run();
 return {enabled:true,configured:true,processed,sent,retried,failed,uncertain};
}

export async function emailNotificationRoute(request,env,actor,readBody,json){
 const url=new URL(request.url),path=url.pathname;
 if(path!=='/api/inbox/email')throw 404;
 const identity=await env.DB.prepare('SELECT id,organization_id,role,client_id,active,email FROM actors WHERE id=? AND organization_id=? AND role=? AND client_id IS ? AND active=1').bind(actor.id,actor.organization_id,actor.role,actor.client_id??null).first();if(!identity)throw 403;
 if(request.method==='GET'){
  if([...url.searchParams.keys()].some(key=>key!=='after')||url.searchParams.getAll('after').length>1)throw 400;
  const prefs=await env.DB.prepare('SELECT COALESCE(email,0) email,email_enabled_since FROM notification_preferences WHERE organization_id=? AND actor_id=?').bind(identity.organization_id,identity.id).first()||{email:0,email_enabled_since:null};
  const after=url.searchParams.get('after');let cursor=[];
  if(after!==null){const match=after.match(/^(\d{1,16}):(message|assignment|deadline|upload):([a-zA-Z0-9-]{1,120})$/);if(!match||!Number.isSafeInteger(Number(match[1])))throw 400;cursor=[Number(match[1]),Number(match[1]),match[2],match[2],match[3]];}
  const rows=await env.DB.prepare("SELECT kind,item_id,status,attempts,last_attempt_at,provider_id,error_code,updated_at FROM notification_email_deliveries WHERE organization_id=? AND actor_id=?"+(cursor.length?' AND (updated_at<? OR (updated_at=? AND (kind<? OR (kind=? AND item_id<?))))':'')+" ORDER BY updated_at DESC,kind DESC,item_id DESC LIMIT 21").bind(identity.organization_id,identity.id,...cursor).all();
  const items=rows.results.slice(0,20).map(row=>({...row,provider_id:row.status==='ACCEPTED'?row.provider_id:null})),last=items.at(-1);return json({email:Boolean(prefs.email),available:configured(env),emailEnabledSince:prefs.email_enabled_since,items,nextCursor:rows.results.length>20?last.updated_at+':'+last.kind+':'+last.item_id:null});
 }
 if(request.method!=='PUT')throw 405;if(url.search)throw 400;
 const input=await readBody(request);if(Object.keys(input).length!==1||typeof input.email!=='boolean')throw 400;
 const timestamp=nowMs();
 const row=await env.DB.prepare("INSERT INTO notification_preferences(organization_id,actor_id,email,email_enabled_since) SELECT organization_id,id,?,CASE WHEN ?=1 THEN ? ELSE NULL END FROM actors WHERE id=? AND organization_id=? AND role=? AND client_id IS ? AND active=1 ON CONFLICT(organization_id,actor_id) DO UPDATE SET email=excluded.email,email_enabled_since=CASE WHEN excluded.email=1 AND notification_preferences.email=0 THEN excluded.email_enabled_since WHEN excluded.email=1 THEN COALESCE(notification_preferences.email_enabled_since,excluded.email_enabled_since) ELSE NULL END RETURNING email,email_enabled_since").bind(Number(input.email),Number(input.email),timestamp,identity.id,identity.organization_id,identity.role,identity.client_id??null).first();if(!row)throw 403;
 return json({email:Boolean(row.email),available:configured(env),emailEnabledSince:row.email_enabled_since});
}

export const emailNotificationInternals={configured,candidatesFor,genericMessage,canonicalOrigin,MAX_ATTEMPTS,EVENT_TTL_MS};
