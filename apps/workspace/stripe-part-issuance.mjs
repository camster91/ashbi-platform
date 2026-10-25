import {hasFinance} from './time-details.mjs';
import {loadPartDraft,partDraftGuard,partDraftMappingGuard} from './stripe-part-drafts.mjs';

const json=JSON.stringify,sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:json(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const integer=v=>Number.isSafeInteger(v)&&v>=0,uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const retryWindow=23*3600000,leaseTime=300000,finalStates=['open','paid','void','uncollectible'];
const eventFields=['id','organization_id','invoice_id','schedule_id','part_id','operation_id','actor_id','recorded_at','revision','action','reason','state_json'];
function strict(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))throw 400;}
function reason(value){if(typeof value!=='string'||!value.trim()||value.length>2000||value.includes('\0'))throw 400;return value.trim();}
async function allowed(db,actor){if(!await hasFinance(db,actor))throw 403;}
function configured(env,actor,services,expected){if(typeof env.STRIPE_ORGANIZATION_ID!=='string'||!env.STRIPE_ORGANIZATION_ID)throw 503;if(env.STRIPE_ORGANIZATION_ID!==actor.organization_id)throw 404;const config=services.configuration(env);if(expected&&(config.accountId!==expected.accountId||config.key!==expected.key))throw 409;return config;}
function tuple(alias,row){const keys=Object.keys(row);return {sql:'('+keys.map(k=>alias?alias+'.'+k:k).join(',')+') IS (SELECT '+keys.map(k=>"json_extract(value,'$."+k+"')").join(',')+' FROM json_each(?))',args:[json([row])]};}
function image(op){return {id:op.id,invoiceId:op.invoice_id,scheduleId:op.schedule_id,partId:op.part_id,kind:op.kind,creationOperationId:op.creation_operation_id,creationRevision:op.creation_revision,accountId:op.account_id,customerId:op.customer_id,stripeInvoiceId:op.stripe_invoice_id,actorId:op.actor_id,reason:op.reason,planHash:op.plan_hash,state:op.state,stage:op.stage,attemptAt:op.attempt_at,lastError:op.last_error,finalizedAt:op.finalized_at,finalizedStatus:op.finalized_status,verifiedAt:op.verified_at,revision:op.revision,createdAt:op.created_at,updatedAt:op.updated_at};}
function journal(op,actor,action,token,eventReason=null){return {id:action==='PREPARE'?op.id:token,organization_id:op.organization_id,invoice_id:op.invoice_id,schedule_id:op.schedule_id,part_id:op.part_id,operation_id:op.id,actor_id:actor.id,recorded_at:op.updated_at,revision:op.revision,action,reason:eventReason,state_json:json({...image(op),eventActorId:actor.id,eventAction:action,eventReason})};}
const dto=op=>({id:op.id,invoiceId:op.invoice_id,scheduleId:op.schedule_id,partId:op.part_id,kind:op.kind,creationOperationId:op.creation_operation_id,creationRevision:op.creation_revision,accountId:op.account_id,customerId:op.customer_id,stripeInvoiceId:op.stripe_invoice_id,state:op.state,stage:op.stage,attemptAt:op.attempt_at,lastError:op.last_error,finalizedAt:op.finalized_at,finalizedStatus:op.finalized_status,verifiedAt:op.verified_at,canRetry:op.state!=='DONE'&&!['EXTERNAL_FINALIZATION','IDEMPOTENCY_EXPIRED'].includes(op.last_error)&&(op.attempt_at===null||Date.now()-op.attempt_at<retryWindow),revision:op.revision,createdAt:op.created_at,updatedAt:op.updated_at,reason:op.reason,plan:JSON.parse(op.plan_json)});
async function creation(db,actor,invoiceId,partId,services){const context=await loadPartDraft(db,actor,invoiceId,partId,services);if(!context.op||context.op.state!=='DONE'||context.op.stage!=='DONE')throw 409;return context;}
async function planImage(context){const op=context.op,plan=JSON.parse(op.plan_json),value={version:1,invoiceId:op.invoice_id,scheduleId:op.schedule_id,partId:op.part_id,kind:op.kind,creationOperationId:op.id,creationRevision:op.revision,stripeInvoiceId:op.stripe_invoice_id,accountId:op.account_id,client:plan.client,project:plan.project,customer:plan.customer,currency:plan.currency,title:plan.title,subtotalMinor:plan.subtotalMinor,taxMinor:plan.taxMinor,totalMinor:plan.totalMinor,tax:plan.tax,dueAt:plan.dueAt,lines:plan.lines,sourceFingerprint:plan.sourceFingerprint,creationFingerprint:plan.fingerprint,autoAdvance:false,sendsMessage:false,chargesPayment:false};value.fingerprint=await sha(value);return value;}
async function validate(db,row,context){
 let plan;try{plan=JSON.parse(row.plan_json);}catch{throw 503;}
 if(await sha(row.plan_json)!==row.plan_hash||json(await planImage(context))!==row.plan_json||row.invoice_id!==context.op.invoice_id||row.schedule_id!==context.op.schedule_id||row.part_id!==context.op.part_id||row.kind!==context.op.kind||row.creation_operation_id!==context.op.id||row.creation_revision!==context.op.revision||row.account_id!==context.op.account_id||row.customer_id!==context.op.customer_id||row.stripe_invoice_id!==context.op.stripe_invoice_id)throw 503;
 const events=(await db.prepare('SELECT * FROM stripe_part_issuance_events WHERE operation_id=? AND organization_id=? ORDER BY revision LIMIT 1002').bind(row.id,row.organization_id).all()).results;
 if(!integer(row.revision)||row.revision>1000||events.length!==row.revision+1)throw 503;
 const initial={...row,state:'PENDING',stage:'FINALIZE',attempt_at:null,last_error:null,finalized_at:null,finalized_status:null,verified_at:null,revision:0,updated_at:row.created_at};
 if(json(events[0])!==json(journal(initial,{id:row.actor_id},'PREPARE',row.id)))throw 503;
 let previous=image(initial);
 for(let i=1;i<events.length;i++){
  const e=events[i];let state;try{const {eventActorId,eventAction,eventReason,...business}=JSON.parse(e.state_json);state=business;if(eventActorId!==e.actor_id||eventAction!==e.action||eventReason!==e.reason)throw 503;}catch{throw 503;}
  if(e.organization_id!==row.organization_id||e.invoice_id!==row.invoice_id||e.schedule_id!==row.schedule_id||e.part_id!==row.part_id||e.operation_id!==row.id||e.revision!==i||state.revision!==i||!integer(state.updatedAt)||state.updatedAt<previous.updatedAt||e.recorded_at!==state.updatedAt||previous.attemptAt!==null&&state.attemptAt!==previous.attemptAt||state.attemptAt!==null&&(!integer(state.attemptAt)||state.attemptAt<row.created_at||state.attemptAt>state.updatedAt))throw 503;
  const reconstructed={...row,state:state.state,stage:state.stage,attempt_at:state.attemptAt,last_error:state.lastError,finalized_at:state.finalizedAt,finalized_status:state.finalizedStatus,verified_at:state.verifiedAt,revision:i,updated_at:state.updatedAt};
  if(e.state_json!==json({...image(reconstructed),eventActorId:e.actor_id,eventAction:e.action,eventReason:e.reason}))throw 503;
  if(e.action==='ATTEMPT_FINALIZE'){if(state.state!=='PENDING'||state.stage!=='FINALIZE'||state.attemptAt===null||state.lastError!==null||state.finalizedAt!==previous.finalizedAt||state.finalizedStatus!==previous.finalizedStatus||state.verifiedAt!==previous.verifiedAt)throw 503;}
  else if(e.action==='OBSERVED_FINALIZED'){if(state.state!=='DONE'||state.stage!=='DONE'||state.attemptAt===null||state.lastError!==null||!integer(state.finalizedAt)||state.finalizedAt===0||!finalStates.includes(state.finalizedStatus)||!integer(state.verifiedAt)||state.verifiedAt<state.createdAt||state.verifiedAt>state.updatedAt)throw 503;}
  else if(e.action==='UNCERTAIN'||e.action==='REVIEW_REQUIRED'){if(state.state!==(e.action==='UNCERTAIN'?'UNKNOWN':'REVIEW_REQUIRED')||state.stage!=='FINALIZE'||typeof state.lastError!=='string'||!state.lastError||state.attemptAt!==previous.attemptAt)throw 503;}
  else throw 503;
  previous=state;
 }
 if(json(previous)!==json(image(row)))throw 503;
 return {row,events,plan,context};
}
async function load(db,actor,invoiceId,partId,services){const context=await creation(db,actor,invoiceId,partId,services),row=await db.prepare('SELECT * FROM stripe_part_issuance_operations WHERE organization_id=? AND part_id=?').bind(actor.organization_id,partId).first();return {context,saved:row?await validate(db,row,context):null};}
function source(context,actor,services,{authorize=true,strictMetadata=authorize,mapping=authorize}={}){const guard=partDraftGuard(context.saved,actor,services,{strictMetadata,outcome:!authorize}),op=tuple('c',context.op),link=partDraftMappingGuard(context.op);return {sql:guard.sql+' AND EXISTS(SELECT 1 FROM stripe_part_operations c WHERE '+op.sql+')'+(mapping?' AND '+link.sql:''),args:[...guard.args,...op.args,...(mapping?link.args:[])]};}
async function finalProof(db,actor,loaded,services,{strict=false}={}){
 const c=loaded.context,r=c.saved.row,guard=source(c,actor,services,{authorize:true,strictMetadata:strict,mapping:strict}),rows=await db.batch([
  db.prepare('SELECT 1 AS valid WHERE '+guard.sql).bind(...guard.args),
  db.prepare('SELECT * FROM stripe_installment_schedules WHERE id=? AND organization_id=?').bind(r.id,r.organization_id),
  db.prepare('SELECT * FROM stripe_installment_parts WHERE schedule_id=? AND organization_id=? ORDER BY ordinal').bind(r.id,r.organization_id),
  db.prepare('SELECT * FROM stripe_installment_events WHERE schedule_id=? AND organization_id=? ORDER BY revision').bind(r.id,r.organization_id),
  db.prepare('SELECT * FROM stripe_part_operations WHERE schedule_id=? AND organization_id=? ORDER BY id LIMIT 3').bind(r.id,r.organization_id),
  db.prepare('SELECT * FROM stripe_part_events WHERE schedule_id=? AND organization_id=? ORDER BY operation_id,revision LIMIT 2003').bind(r.id,r.organization_id),
  db.prepare('SELECT * FROM stripe_part_issuance_operations WHERE part_id=? AND organization_id=?').bind(c.part.id,r.organization_id),
  db.prepare('SELECT * FROM stripe_part_issuance_events WHERE part_id=? AND organization_id=? ORDER BY revision LIMIT 1002').bind(c.part.id,r.organization_id)
 ]);
 if(!rows[0].results.length){await allowed(db,actor);throw 409;}
 if(json(rows[1].results[0])!==json(r)||json(rows[2].results)!==json(c.saved.parts)||json(rows[3].results)!==json(c.saved.events)||json(rows[4].results)!==json(c.saved.activation.operations)||json(rows[5].results)!==json(c.saved.activation.events)||json(rows[6].results)!==json(loaded.saved?[loaded.saved.row]:[])||json(rows[7].results)!==json(loaded.saved?.events??[]))throw 503;
 // Even local receipts require a current grant and canonical source scope in
 // this same final SQL snapshot, without requiring provider configuration.

}
async function present(db,actor,invoiceId,partId,services){const loaded=await load(db,actor,invoiceId,partId,services);if(!loaded.saved)throw 404;const value=dto(loaded.saved.row);await finalProof(db,actor,loaded,services);return value;}
async function remote(env,actor,context,services,config,{draft=false}={}){
 const op=context.op,plan=JSON.parse(op.plan_json);if(config.accountId!==op.account_id)throw 409;
 const customer=await services.customer(env,op.customer_id);if(json(customer)!==json(plan.customer))throw 409;
 const value=await services.read(env,'invoices/'+op.stripe_invoice_id),lines=await services.lines(env,op.stripe_invoice_id,plan.lines.length);
 if(draft){services.baseMatches(value,op,plan);if(!services.exact(value,lines,op,plan))throw 409;}
 else{services.finalIdentity(value,op,plan);if(!services.finalExact(value,lines,op,plan))throw 409;}
 return value;
}
async function preview(env,actor,invoiceId,partId,services){const config=configured(env,actor,services),context=await creation(env.DB,actor,invoiceId,partId,services);await remote(env,actor,context,services,config,{draft:true});const plan=await planImage(context),loaded=await load(env.DB,actor,invoiceId,partId,services);if(json(await planImage(loaded.context))!==json(plan))throw 409;await finalProof(env.DB,actor,loaded,services,{strict:true});configured(env,actor,services,config);return plan;}
function eventInsert(db,op,e,token){return db.prepare(`INSERT INTO stripe_part_issuance_events(${eventFields.join(',')}) SELECT ${eventFields.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM stripe_part_issuance_operations WHERE id=? AND organization_id=? AND write_token=?) RETURNING id`).bind(...eventFields.map(k=>e[k]),op.id,op.organization_id,token);}
function projection(db,op,token){return db.prepare('UPDATE invoice_drafts SET write_token=? WHERE id=? AND organization_id=? AND EXISTS(SELECT 1 FROM stripe_part_issuance_operations WHERE id=? AND organization_id=? AND write_token=?) RETURNING id').bind(token,op.invoice_id,op.organization_id,op.id,op.organization_id,token);}
function retained(sqlTable,fields){return `NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM ${sqlTable} e WHERE (${fields.map(k=>'e.'+k).join(',')}) IS (${fields.map(k=>"json_extract(expected.value,'$."+k+"')").join(',')})))`;}
function fence(db,op,events,token,context){
 const scheduleFields=['id','organization_id','schedule_id','invoice_id','actor_id','revision','action','state_json','recorded_at'];
 return db.prepare(`UPDATE stripe_part_issuance_operations SET write_token=CASE WHEN (SELECT COUNT(*) FROM stripe_part_issuance_events e WHERE e.operation_id=stripe_part_issuance_operations.id AND e.organization_id=stripe_part_issuance_operations.organization_id)=? AND ${retained('stripe_part_issuance_events',eventFields)} AND ${retained('stripe_installment_events',scheduleFields)} AND ${retained('stripe_part_events',eventFields)} AND EXISTS(SELECT 1 FROM invoice_drafts i JOIN stripe_installment_schedules s ON s.invoice_id=i.id AND s.organization_id=i.organization_id WHERE s.id=stripe_part_issuance_operations.schedule_id AND s.organization_id=stripe_part_issuance_operations.organization_id AND s.state='FROZEN' AND s.activated_at IS NOT NULL AND i.revision=s.parent_revision AND i.write_token=?) THEN write_token ELSE NULL END WHERE id=? AND organization_id=? AND write_token=? RETURNING id`).bind(op.revision+1,json(events),json(context.saved.events),json(context.saved.activation.events),token,op.id,op.organization_id,token);
}
async function receipt(env,actor,invoiceId,partId,key,services){
 const loaded=await load(env.DB,actor,invoiceId,partId,services),rows=await env.DB.batch([env.DB.prepare('SELECT * FROM stripe_part_issuance_operations WHERE organization_id=? AND request_key=?').bind(actor.organization_id,key),env.DB.prepare('SELECT * FROM cancelled_stripe_part_issuance_requests WHERE organization_id=? AND request_key=?').bind(actor.organization_id,key)]),op=rows[0].results[0],stop=rows[1].results[0];
 if(op){if(op.invoice_id!==invoiceId||op.part_id!==partId)throw 409;return {state:'SAVED',operation:await present(env.DB,actor,invoiceId,partId,services)};}
 if(stop&&(stop.invoice_id!==invoiceId||stop.part_id!==partId))throw 409;
 const value=stop?{state:'CANCELLED',cancelledBy:stop.actor_id,cancelledAt:stop.created_at}:{state:'UNKNOWN'};await finalProof(env.DB,actor,loaded,services);return value;
}
async function begin(env,actor,invoiceId,partId,body,services){
 strict(body,['requestId','revision','fingerprint','reason']);if(!uuid(body.requestId)||!integer(body.revision)||!hash(body.fingerprint))throw 400;const why=reason(body.reason),key=body.requestId.toLowerCase(),requestHash=await sha({invoiceId,partId,revision:body.revision,fingerprint:body.fingerprint,reason:why}),old=await receipt(env,actor,invoiceId,partId,key,services);
 if(old.state==='CANCELLED')throw 409;
 if(old.state==='SAVED'){const loaded=await load(env.DB,actor,invoiceId,partId,services);if(loaded.saved.row.request_fingerprint!==requestHash)throw 409;return {op:loaded.saved.row,status:200};}
 const config=configured(env,actor,services),plan=await preview(env,actor,invoiceId,partId,services);if(plan.creationRevision!==body.revision||plan.fingerprint!==body.fingerprint)throw 409;
 const loaded=await load(env.DB,actor,invoiceId,partId,services);if(loaded.saved)throw 409;if(json(await planImage(loaded.context))!==json(plan))throw 409;
 const now=Date.now(),token=crypto.randomUUID(),c=loaded.context.op,op={id:crypto.randomUUID(),organization_id:actor.organization_id,invoice_id:invoiceId,schedule_id:c.schedule_id,part_id:partId,kind:c.kind,creation_operation_id:c.id,creation_revision:c.revision,account_id:c.account_id,customer_id:c.customer_id,stripe_invoice_id:c.stripe_invoice_id,actor_id:actor.id,reason:why,request_key:key,request_fingerprint:requestHash,plan_json:json(plan),plan_hash:await sha(plan),state:'PENDING',stage:'FINALIZE',attempt_at:null,last_error:null,finalized_at:null,finalized_status:null,verified_at:null,revision:0,created_at:now,updated_at:now,lease_token:null,lease_until:0,write_token:token},guard=source(loaded.context,actor,services),keys=Object.keys(op),e=journal(op,actor,'PREPARE',token);
 configured(env,actor,services,config);
 const first=env.DB.prepare(`INSERT INTO stripe_part_issuance_operations(${keys.join(',')}) SELECT ${keys.map(()=>'?').join(',')} WHERE ${guard.sql} AND NOT EXISTS(SELECT 1 FROM cancelled_stripe_part_issuance_requests WHERE organization_id=? AND request_key=?) RETURNING id`).bind(...keys.map(k=>op[k]),...guard.args,actor.organization_id,key);
 try{const result=await env.DB.batch([first,projection(env.DB,op,token),eventInsert(env.DB,op,e,token),fence(env.DB,op,[e],token,loaded.context)]);if(!result[0].results.length){await allowed(env.DB,actor);throw 409;}}
 catch(error){await allowed(env.DB,actor);const winner=await env.DB.prepare('SELECT * FROM stripe_part_issuance_operations WHERE organization_id=? AND request_key=?').bind(actor.organization_id,key).first();if(winner&&winner.part_id===partId&&winner.invoice_id===invoiceId&&winner.request_fingerprint===requestHash)return {op:winner,status:200};throw 409;}
 return {op,status:201};
}
async function change(env,actor,original,lease,values,action,services,{authorize=false}={}){
 const loaded=await load(env.DB,actor,original.invoice_id,original.part_id,services),old=loaded.saved?.row;if(!old||old.id!==original.id||old.lease_token!==lease)throw 409;
 const token=crypto.randomUUID(),op={...old,...values,revision:old.revision+1,updated_at:Date.now(),write_token:token};if(!integer(op.revision)||op.revision>1000)throw 409;
 const guard=source(loaded.context,actor,services,{authorize}),before=tuple('',old),keys=Object.keys(values),e=journal(op,actor,action,token),events=[...loaded.saved.events,e];
 const first=env.DB.prepare(`UPDATE stripe_part_issuance_operations SET ${keys.map(k=>k+'=?').join(',')},revision=?,updated_at=?,write_token=? WHERE id=? AND organization_id=? AND lease_token=? AND ${before.sql} AND ${guard.sql} RETURNING id`).bind(...keys.map(k=>values[k]),op.revision,op.updated_at,token,op.id,op.organization_id,lease,...before.args,...guard.args);
 const result=await env.DB.batch([first,projection(env.DB,op,token),eventInsert(env.DB,op,e,token),fence(env.DB,op,events,token,loaded.context)]);if(!result[0].results.length){await allowed(env.DB,actor);throw 409;}return op;
}
async function prePost(env,actor,op,lease,services,config){const loaded=await load(env.DB,actor,op.invoice_id,op.part_id,services),row=loaded.saved?.row;if(!row||row.id!==op.id||row.revision!==op.revision||row.lease_token!==lease||row.lease_until<=Date.now()||row.attempt_at===null||Date.now()-row.attempt_at>=retryWindow)throw 409;await finalProof(env.DB,actor,loaded,services,{strict:true});if(row.lease_until<=Date.now()||Date.now()-row.attempt_at>=retryWindow)throw 409;configured(env,actor,services,config);}
async function execute(env,actor,original,services,allowPost){
 if(original.state==='DONE')return original;
 const config=configured(env,actor,services),loaded=await load(env.DB,actor,original.invoice_id,original.part_id,services),guard=source(loaded.context,actor,services),lease=crypto.randomUUID(),now=Date.now();
 if(config.accountId!==original.account_id)throw 409;
 let op=await env.DB.prepare(`UPDATE stripe_part_issuance_operations SET lease_token=?,lease_until=? WHERE id=? AND organization_id=? AND state!='DONE' AND lease_until<=? AND ${guard.sql} RETURNING *`).bind(lease,now+leaseTime,original.id,actor.organization_id,now,...guard.args).first();
 if(!op){await allowed(env.DB,actor);return (await load(env.DB,actor,original.invoice_id,original.part_id,services)).saved.row;}
 try{
  const context=(await load(env.DB,actor,op.invoice_id,op.part_id,services)).context,value=await remote(env,actor,context,services,config);
  if(value.status!=='draft'){
   if(!finalStates.includes(value.status)||!integer(value.status_transitions?.finalized_at)||value.status_transitions.finalized_at===0)throw 409;
   const effect={finalized_at:value.status_transitions.finalized_at,finalized_status:value.status,verified_at:Date.now()};
   if(op.attempt_at===null)return await change(env,actor,op,lease,{...effect,state:'REVIEW_REQUIRED',last_error:'EXTERNAL_FINALIZATION'},'REVIEW_REQUIRED',services);
   return await change(env,actor,op,lease,{...effect,state:'DONE',stage:'DONE',last_error:null},'OBSERVED_FINALIZED',services);
  }
  if(!allowPost||op.last_error==='EXTERNAL_FINALIZATION')return op;
  if(op.attempt_at!==null&&Date.now()-op.attempt_at>=retryWindow)return await change(env,actor,op,lease,{state:'REVIEW_REQUIRED',last_error:'IDEMPOTENCY_EXPIRED'},'REVIEW_REQUIRED',services);
  op=await change(env,actor,op,lease,{state:'PENDING',last_error:null,attempt_at:op.attempt_at??Date.now()},'ATTEMPT_FINALIZE',services,{authorize:true});
  await prePost(env,actor,op,lease,services,config);
  const response=await services.finalize(env,op.stripe_invoice_id,'ashbi:'+op.id+':finalize'),plan=JSON.parse(context.op.plan_json);
  services.finalIdentity(response,context.op,plan);if(!finalStates.includes(response.status)||!integer(response.status_transitions?.finalized_at)||response.status_transitions.finalized_at===0)throw services.error('PROVIDER_MISMATCH');
  // Confirm the durable native invoice independently of the POST response.
  const fresh=await services.read(env,'invoices/'+op.stripe_invoice_id),lines=await services.lines(env,op.stripe_invoice_id,plan.lines.length);
  services.finalIdentity(fresh,context.op,plan);
  if(!finalStates.includes(fresh.status)||!integer(fresh.status_transitions?.finalized_at)||fresh.status_transitions.finalized_at===0||!services.finalExact(response,lines,context.op,plan)||!services.finalExact(fresh,lines,context.op,plan))throw services.error('PROVIDER_MISMATCH');
  op=await change(env,actor,op,lease,{state:'DONE',stage:'DONE',last_error:null,finalized_at:fresh.status_transitions.finalized_at,finalized_status:fresh.status,verified_at:Date.now()},'OBSERVED_FINALIZED',services);
  return op;
 }catch(error){if(Number.isInteger(error))throw error;const code=error?.code??'LOCAL_RECOVERY_REQUIRED',uncertain=['PROVIDER_UNAVAILABLE','LOCAL_RECOVERY_REQUIRED'].includes(code);return await change(env,actor,op,lease,{state:uncertain?'UNKNOWN':'REVIEW_REQUIRED',last_error:code},uncertain?'UNCERTAIN':'REVIEW_REQUIRED',services);}
 finally{await env.DB.prepare('UPDATE stripe_part_issuance_operations SET lease_token=NULL,lease_until=0 WHERE id=? AND organization_id=? AND lease_token=?').bind(original.id,actor.organization_id,lease).run();}
}
export async function stripePartIssuanceRoute(request,env,actor,readBody,respond,services){
 await allowed(env.DB,actor);const url=new URL(request.url);if(url.search)throw 400;
 const match=url.pathname.match(/^\/api\/stripe\/schedules\/([a-zA-Z0-9-]{1,100})\/parts\/([a-zA-Z0-9-]{1,100})\/finalize(-preview|\/retry|\/reconcile|\/requests\/([^/]+)(\/cancel)?)?$/);if(!match)throw 404;
 const invoiceId=match[1],partId=match[2],action=match[3]??'',key=match[4];
 if(key){if(!uuid(key))throw 400;if(request.method!==(match[5]?'POST':'GET'))throw 405;if(match[5]){strict(await readBody(request),[]);const loaded=await load(env.DB,actor,invoiceId,partId,services),guard=source(loaded.context,actor,services,{authorize:true,strictMetadata:false,mapping:false});await allowed(env.DB,actor);const finance="EXISTS(SELECT 1 FROM actors a JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=? AND a.role='staff' AND a.active=1)";await env.DB.prepare(`INSERT INTO cancelled_stripe_part_issuance_requests(id,organization_id,invoice_id,part_id,request_key,actor_id,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} AND ${finance} AND NOT EXISTS(SELECT 1 FROM stripe_part_issuance_operations WHERE organization_id=? AND request_key=?) ON CONFLICT(organization_id,request_key) DO NOTHING`).bind(crypto.randomUUID(),actor.organization_id,invoiceId,partId,key.toLowerCase(),actor.id,Date.now(),...guard.args,actor.id,actor.organization_id,actor.organization_id,key.toLowerCase()).run();}return respond(await receipt(env,actor,invoiceId,partId,key.toLowerCase(),services));}
 if(request.method==='GET'){if(action)throw 405;return respond(await present(env.DB,actor,invoiceId,partId,services));}
 if(request.method!=='POST')throw 405;
 const body=await readBody(request);if(action==='-preview'){strict(body,[]);return respond(await preview(env,actor,invoiceId,partId,services));}
 let op,status=200;if(action){strict(body,[]);const loaded=await load(env.DB,actor,invoiceId,partId,services);if(!loaded.saved)throw 404;op=loaded.saved.row;}else{const prepared=await begin(env,actor,invoiceId,partId,body,services);op=prepared.op;status=prepared.status;if(status===200)return respond(await present(env.DB,actor,invoiceId,partId,services));}
 await execute(env,actor,op,services,action!=='/reconcile');const value=await present(env.DB,actor,invoiceId,partId,services);return respond(value,value.state==='DONE'||action==='/reconcile'?status:202);
}
