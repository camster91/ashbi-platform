import {hasFinance} from './time-details.mjs';

const authority="EXISTS(SELECT 1 FROM actors a JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='staff')";
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v),integer=v=>Number.isSafeInteger(v)&&v>=0,external=v=>typeof v==='string'&&/^in_[a-zA-Z0-9_]{1,100}$/.test(v),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const json=JSON.stringify,sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:json(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const retryWindow=23*3600000,leaseTime=300000;
const eventFields=['id','organization_id','invoice_id','schedule_id','part_id','operation_id','actor_id','recorded_at','revision','action','reason','state_json'];
function strict(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))throw 400;}
function reason(v){if(typeof v!=='string'||!v.trim()||v.length>2000||v.includes('\0'))throw 400;return v.trim();}
async function allowed(db,actor){if(!await hasFinance(db,actor))throw 403;}
function image(op){return {id:op.id,invoiceId:op.invoice_id,scheduleId:op.schedule_id,partId:op.part_id,kind:op.kind,mappingId:op.mapping_id,accountId:op.account_id,customerId:op.customer_id,actorId:op.actor_id,reason:op.reason,planHash:op.plan_hash,activationAt:op.activation_at,state:op.state,stage:op.stage,stripeInvoiceId:op.stripe_invoice_id,createAttemptAt:op.create_attempt_at,linesAttemptAt:op.lines_attempt_at,lastError:op.last_error,revision:op.revision,createdAt:op.created_at,updatedAt:op.updated_at};}
const dto=op=>({id:op.id,invoiceId:op.invoice_id,scheduleId:op.schedule_id,partId:op.part_id,kind:op.kind,accountId:op.account_id,customerId:op.customer_id,state:op.state,stage:op.stage,stripeInvoiceId:op.stripe_invoice_id,lastError:op.last_error,createAttemptAt:op.create_attempt_at,linesAttemptAt:op.lines_attempt_at,revision:op.revision,createdAt:op.created_at,updatedAt:op.updated_at,reason:op.reason,plan:JSON.parse(op.plan_json)});
function journal(op,actor,action,token,eventReason=null){return {id:action==='PREPARE'?op.id:token,organization_id:op.organization_id,invoice_id:op.invoice_id,schedule_id:op.schedule_id,part_id:op.part_id,operation_id:op.id,actor_id:actor.id,recorded_at:op.updated_at,revision:op.revision,action,reason:eventReason,state_json:json({...image(op),eventActorId:actor.id,eventAction:action,eventReason})};}

// This is shared with schedule receipts. Activation is proved by the original
// PREPARE image, not by an arbitrary operation's continued existence.
export async function validatePartOperations(db,actor,saved){
 const r=saved.row,results=await db.batch([
  db.prepare('SELECT * FROM stripe_part_operations WHERE schedule_id=? AND organization_id=? ORDER BY id LIMIT 3').bind(r.id,actor.organization_id),
  db.prepare('SELECT * FROM stripe_part_events WHERE schedule_id=? AND organization_id=? ORDER BY operation_id,revision LIMIT 2003').bind(r.id,actor.organization_id)
 ]),operations=results[0].results,events=results[1].results;
 if(operations.length>2||events.length>2002||r.activated_at===null&&operations.length||r.activated_at!==null&&(!operations.length||r.state!=='FROZEN'||!integer(r.activated_at)))throw 503;
 if(events.some(e=>!operations.some(o=>o.id===e.operation_id)))throw 503;
 let anchored=false;
 for(const op of operations){
  const part=saved.parts.find(p=>p.id===op.part_id),list=events.filter(e=>e.operation_id===op.id);
  if(!part||op.invoice_id!==r.invoice_id||op.kind!==part.kind||op.plan_json!==part.plan_json||op.plan_hash!==part.plan_hash||await sha(op.plan_json)!==op.plan_hash||op.activation_at!==r.activated_at||op.created_at<op.activation_at||!integer(op.revision)||op.revision>1000||list.length!==op.revision+1)throw 503;
  let plan;try{plan=JSON.parse(op.plan_json);}catch{throw 503;}
  if(op.mapping_id!==plan.mappingId||op.account_id!==plan.accountId||op.customer_id!==plan.customer?.id)throw 503;
  const initial={...op,state:'PENDING',stage:'CREATE',stripe_invoice_id:null,create_attempt_at:null,lines_attempt_at:null,last_error:null,revision:0,updated_at:op.created_at};
  if(json(list[0])!==json(journal(initial,{id:op.actor_id},'PREPARE',op.id)))throw 503;
  if(op.created_at===r.activated_at)anchored=true;
  let previous=image(initial);
  for(let i=1;i<list.length;i++){
   const e=list[i];let state,audit;try{audit=JSON.parse(e.state_json);const {eventActorId,eventAction,eventReason,...business}=audit;state=business;if(eventActorId!==e.actor_id||eventAction!==e.action||eventReason!==e.reason)throw 503;}catch{throw 503;}
   if(!state||typeof state!=='object'||e.revision!==i||e.organization_id!==r.organization_id||e.invoice_id!==r.invoice_id||e.schedule_id!==r.id||e.part_id!==part.id||e.operation_id!==op.id||e.recorded_at!==state.updatedAt||!integer(state.updatedAt)||state.updatedAt<previous.updatedAt||state.revision!==i)throw 503;
   const reconstructed={...op,state:state.state,stage:state.stage,stripe_invoice_id:state.stripeInvoiceId,create_attempt_at:state.createAttemptAt,lines_attempt_at:state.linesAttemptAt,last_error:state.lastError,revision:i,updated_at:state.updatedAt};
   if(e.state_json!==json({...image(reconstructed),eventActorId:e.actor_id,eventAction:e.action,eventReason:e.reason})||previous.createAttemptAt!==null&&state.createAttemptAt!==previous.createAttemptAt||previous.linesAttemptAt!==null&&state.linesAttemptAt!==previous.linesAttemptAt||previous.stripeInvoiceId!==null&&state.stripeInvoiceId!==previous.stripeInvoiceId)throw 503;
   if(state.createAttemptAt!==null&&(!integer(state.createAttemptAt)||state.createAttemptAt<op.created_at||state.createAttemptAt>state.updatedAt)||state.linesAttemptAt!==null&&(!integer(state.linesAttemptAt)||state.linesAttemptAt<op.created_at||state.linesAttemptAt>state.updatedAt))throw 503;
   if(e.action==='ATTEMPT_CREATE'){if(state.state!=='PENDING'||state.stage!=='CREATE'||state.stripeInvoiceId!==null||state.createAttemptAt===null||state.linesAttemptAt!==null)throw 503;}
   else if(e.action==='CREATED'||e.action==='ADOPT'){if(state.state!=='PENDING'||state.stage!=='LINES'||!external(state.stripeInvoiceId)||state.createAttemptAt!==previous.createAttemptAt||state.linesAttemptAt!==previous.linesAttemptAt||e.action==='ADOPT'&&!e.reason)throw 503;}
   else if(e.action==='ATTEMPT_LINES'){if(state.state!=='PENDING'||state.stage!=='LINES'||!external(state.stripeInvoiceId)||state.linesAttemptAt===null||state.createAttemptAt!==previous.createAttemptAt)throw 503;}
   else if(e.action==='COMPLETE'){if(state.state!=='DONE'||state.stage!=='DONE'||!external(state.stripeInvoiceId)||state.lastError!==null||state.createAttemptAt!==previous.createAttemptAt||state.linesAttemptAt!==previous.linesAttemptAt)throw 503;}
   else if(e.action==='UNCERTAIN'||e.action==='REVIEW_REQUIRED'){if(state.state!==(e.action==='UNCERTAIN'?'UNKNOWN':'REVIEW_REQUIRED')||state.stage!==previous.stage||state.stripeInvoiceId!==previous.stripeInvoiceId||state.createAttemptAt!==previous.createAttemptAt||state.linesAttemptAt!==previous.linesAttemptAt||typeof state.lastError!=='string'||!state.lastError)throw 503;}
   else throw 503;
   previous=state;
  }
  if(json(previous)!==json(image(op)))throw 503;
 }
 if(r.activated_at!==null&&!anchored)throw 503;
 return {operations,events};
}

function rowTuple(alias,row){const keys=Object.keys(row);return {sql:'('+keys.map(k=>alias?alias+'.'+k:k).join(',')+') IS (SELECT '+keys.map(k=>"json_extract(value,'$."+k+"')").join(',')+' FROM json_each(?))',args:[json([row])]};}
function currentGuard(saved,actor,services,{strictMetadata=true,outcome=false}={}){
 const r=saved.row,source=outcome?{sql:'1',args:[]}:services.sourceGuard(saved.source,r.parent_revision,actor,{strictMetadata}),tuple=rowTuple('s',r),parts=saved.parts;
 return {sql:source.sql+` AND EXISTS(SELECT 1 FROM stripe_installment_schedules s WHERE s.id=? AND s.organization_id=? AND s.state='FROZEN' AND ${tuple.sql}) AND (SELECT COUNT(*) FROM stripe_installment_parts p WHERE p.schedule_id=? AND p.organization_id=?)=2 AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM stripe_installment_parts p WHERE (p.id,p.organization_id,p.schedule_id,p.kind,p.ordinal,p.plan_json,p.plan_hash,p.created_at) IS (json_extract(expected.value,'$.id'),json_extract(expected.value,'$.organization_id'),json_extract(expected.value,'$.schedule_id'),json_extract(expected.value,'$.kind'),json_extract(expected.value,'$.ordinal'),json_extract(expected.value,'$.plan_json'),json_extract(expected.value,'$.plan_hash'),json_extract(expected.value,'$.created_at'))))`,args:[...source.args,r.id,r.organization_id,...tuple.args,r.id,r.organization_id,json(parts)]};
}
function mappingGuard(op){return {sql:'EXISTS(SELECT 1 FROM stripe_customer_links m WHERE (m.id,m.organization_id,m.client_id,m.account_id,m.customer_id) IS (?,?,?,?,?))',args:[op.mapping_id,op.organization_id,JSON.parse(op.plan_json).client.id,op.account_id,op.customer_id]};}
async function load(db,actor,invoiceId,partId,services){
 const saved=await services.loadSchedule(db,actor,invoiceId,partId);
 const part=saved.parts.find(p=>p.id===partId);if(!part)throw 404;
 return {saved,part,op:saved.activation.operations.find(o=>o.part_id===partId)??null};
}
function configuration(env,actor,services,expected){if(typeof env.STRIPE_ORGANIZATION_ID!=='string'||!env.STRIPE_ORGANIZATION_ID)throw 503;if(env.STRIPE_ORGANIZATION_ID!==actor.organization_id)throw 404;const c=services.configuration(env);if(expected&&(c.accountId!==expected.accountId||c.key!==expected.key))throw 409;return c;}
function eventInsert(db,op,e,token){return db.prepare(`INSERT INTO stripe_part_events(${eventFields.join(',')}) SELECT ${eventFields.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM stripe_part_operations WHERE id=? AND organization_id=? AND write_token=?) RETURNING id`).bind(...eventFields.map(k=>e[k]),op.id,op.organization_id,token);}
function commitFence(db,op,events,token,saved,activation=false){
 const retainedScheduleEvents=saved.events,retainedPrepare=saved.activation.events.filter(e=>e.action==='PREPARE');
 return db.prepare(`UPDATE stripe_part_operations SET write_token=CASE WHEN (SELECT COUNT(*) FROM stripe_part_events e WHERE e.operation_id=stripe_part_operations.id AND e.organization_id=stripe_part_operations.organization_id)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM stripe_part_events e WHERE e.operation_id=stripe_part_operations.id AND e.organization_id=stripe_part_operations.organization_id AND (${eventFields.map(k=>'e.'+k).join(',')}) IS (${eventFields.map(k=>"json_extract(expected.value,'$."+k+"')").join(',')}))) AND EXISTS(SELECT 1 FROM stripe_installment_schedules s WHERE s.id=stripe_part_operations.schedule_id AND s.organization_id=stripe_part_operations.organization_id AND s.state='FROZEN' AND s.revision=0 AND s.activated_at=stripe_part_operations.activation_at${activation?' AND s.write_token=?':''}) AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM stripe_installment_events e WHERE (e.id,e.organization_id,e.schedule_id,e.invoice_id,e.actor_id,e.revision,e.action,e.state_json,e.recorded_at) IS (json_extract(expected.value,'$.id'),json_extract(expected.value,'$.organization_id'),json_extract(expected.value,'$.schedule_id'),json_extract(expected.value,'$.invoice_id'),json_extract(expected.value,'$.actor_id'),json_extract(expected.value,'$.revision'),json_extract(expected.value,'$.action'),json_extract(expected.value,'$.state_json'),json_extract(expected.value,'$.recorded_at')))) AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM stripe_part_events e WHERE (${eventFields.map(k=>'e.'+k).join(',')}) IS (${eventFields.map(k=>"json_extract(expected.value,'$."+k+"')").join(',')}))) AND EXISTS(SELECT 1 FROM invoice_drafts i JOIN stripe_installment_schedules s ON s.invoice_id=i.id AND s.organization_id=i.organization_id WHERE s.id=stripe_part_operations.schedule_id AND s.organization_id=stripe_part_operations.organization_id AND i.revision=s.parent_revision AND i.write_token=?) THEN write_token ELSE NULL END WHERE id=? AND organization_id=? AND write_token=? RETURNING id`).bind(op.revision+1,json(events),...(activation?[token]:[]),json(retainedScheduleEvents),json(retainedPrepare),token,op.id,op.organization_id,token);
}
function parentProjection(db,op,token){return db.prepare(`UPDATE invoice_drafts SET write_token=? WHERE id=? AND organization_id=? AND EXISTS(SELECT 1 FROM stripe_part_operations o WHERE o.id=? AND o.organization_id=? AND o.write_token=?) RETURNING id`).bind(token,op.invoice_id,op.organization_id,op.id,op.organization_id,token);}
async function present(db,actor,invoiceId,partId,services){const loaded=await load(db,actor,invoiceId,partId,services);if(!loaded.op)throw 404;const value=dto(loaded.op);await services.proof(db,actor,loaded.saved);return value;}
async function receipt(db,actor,invoiceId,partId,key,services){
 const loaded=await load(db,actor,invoiceId,partId,services),rows=await db.batch([db.prepare('SELECT * FROM stripe_part_operations WHERE organization_id=? AND request_key=?').bind(actor.organization_id,key),db.prepare('SELECT * FROM cancelled_stripe_part_requests WHERE organization_id=? AND request_key=?').bind(actor.organization_id,key)]),op=rows[0].results[0],stopped=rows[1].results[0];
 if(op){if(op.invoice_id!==invoiceId||op.part_id!==partId)throw 409;return {state:'SAVED',operation:await present(db,actor,invoiceId,partId,services)};}
 if(stopped&&(stopped.invoice_id!==invoiceId||stopped.part_id!==partId))throw 409;
 const value=stopped?{state:'CANCELLED',cancelledBy:stopped.actor_id,cancelledAt:stopped.created_at}:{state:'UNKNOWN'};await services.proof(db,actor,loaded.saved);return value;
}
async function prepare(env,actor,invoiceId,partId,body,services){
 strict(body,['requestId','revision','fingerprint','reason']);if(!uuid(body.requestId)||!integer(body.revision)||!hash(body.fingerprint))throw 400;
 const why=reason(body.reason),key=body.requestId.toLowerCase(),requestHash=await sha({invoiceId,partId,revision:body.revision,fingerprint:body.fingerprint,reason:why}),db=env.DB;
 let {saved,part,op}=await load(db,actor,invoiceId,partId,services);
 const prior=await receipt(db,actor,invoiceId,partId,key,services);if(prior.state==='CANCELLED')throw 409;
 if(op){if(op.request_key!==key||op.request_fingerprint!==requestHash)throw 409;return {op,status:200};}
 if(prior.state==='SAVED')throw 409;
 const configured=configuration(env,actor,services),plan=JSON.parse(part.plan_json);
 if(saved.row.state!=='FROZEN'||saved.row.revision!==body.revision||body.revision!==0||plan.fingerprint!==body.fingerprint||plan.accountId!==configured.accountId||plan.dueAt*1000<=Date.now())throw 409;
 const providerCustomer=await services.customer(env,plan.customer.id);if(json(providerCustomer)!==json(plan.customer))throw 409;
 ({saved,part,op}=await load(db,actor,invoiceId,partId,services));if(op){if(op.request_key===key&&op.request_fingerprint===requestHash)return {op,status:200};throw 409;}
 const now=Date.now(),token=crypto.randomUUID(),r=saved.row;
 op={id:crypto.randomUUID(),organization_id:actor.organization_id,invoice_id:invoiceId,schedule_id:r.id,part_id:partId,kind:part.kind,mapping_id:plan.mappingId,account_id:plan.accountId,customer_id:plan.customer.id,actor_id:actor.id,reason:why,request_key:key,request_fingerprint:requestHash,plan_json:part.plan_json,plan_hash:part.plan_hash,activation_at:r.activated_at??now,state:'PENDING',stage:'CREATE',stripe_invoice_id:null,create_attempt_at:null,lines_attempt_at:null,last_error:null,revision:0,created_at:now,updated_at:now,lease_token:null,lease_until:0,write_token:token};
 const guard=currentGuard(saved,actor,services),mapping=mappingGuard(op),keys=Object.keys(op),e=journal(op,actor,'PREPARE',token);
 configuration(env,actor,services,configured);
 const first=db.prepare(`INSERT INTO stripe_part_operations(${keys.join(',')}) SELECT ${keys.map(()=>'?').join(',')} WHERE ${guard.sql} AND ${mapping.sql} AND NOT EXISTS(SELECT 1 FROM cancelled_stripe_part_requests WHERE organization_id=? AND request_key=?) RETURNING id`).bind(...keys.map(k=>op[k]),...guard.args,...mapping.args,actor.organization_id,key);
 const activation=db.prepare(`UPDATE stripe_installment_schedules SET activated_at=COALESCE(activated_at,?),write_token=? WHERE id=? AND organization_id=? AND state='FROZEN' AND revision=0 AND activated_at IS ? AND EXISTS(SELECT 1 FROM stripe_part_operations WHERE id=? AND organization_id=? AND write_token=?) RETURNING id`).bind(op.activation_at,token,r.id,r.organization_id,r.activated_at,op.id,op.organization_id,token);
 try{const results=await db.batch([first,activation,parentProjection(db,op,token),eventInsert(db,op,e,token),commitFence(db,op,[e],token,saved,true)]);if(!results[0].results.length){await allowed(db,actor);throw 409;}}
 catch(error){await allowed(db,actor);const winner=await db.prepare('SELECT * FROM stripe_part_operations WHERE organization_id=? AND request_key=?').bind(actor.organization_id,key).first();if(winner&&winner.part_id===partId&&winner.invoice_id===invoiceId&&winner.request_fingerprint===requestHash)return {op:winner,status:200};throw 409;}
 return {op,status:201};
}
async function change(env,actor,op,lease,changes,action,services,{authorize=false,eventReason=null}={}){
 const db=env.DB,loaded=await load(db,actor,op.invoice_id,op.part_id,services),current=loaded.op;if(!current||current.id!==op.id||current.lease_token!==lease)throw 409;
 const token=crypto.randomUUID(),next={...current,...changes,revision:current.revision+1,updated_at:Date.now(),write_token:token};if(!integer(next.revision)||next.revision>1000)throw 409;
 const old=rowTuple('',current),guard=currentGuard(loaded.saved,actor,services,{strictMetadata:authorize,outcome:!authorize}),mapping=mappingGuard(next),fields=Object.keys(changes),e=journal(next,actor,action,token,eventReason),events=[...loaded.saved.activation.events.filter(x=>x.operation_id===op.id),e];
 const first=db.prepare(`UPDATE stripe_part_operations SET ${fields.map(k=>k+'=?').join(',')},revision=?,updated_at=?,write_token=? WHERE id=? AND organization_id=? AND lease_token=? AND ${old.sql} AND ${guard.sql}${authorize?' AND '+mapping.sql:''} RETURNING id`).bind(...fields.map(k=>changes[k]),next.revision,next.updated_at,token,op.id,op.organization_id,lease,...old.args,...guard.args,...(authorize?mapping.args:[]));
 const results=await db.batch([first,parentProjection(db,next,token),eventInsert(db,next,e,token),commitFence(db,next,events,token,loaded.saved)]);if(!results[0].results.length){await allowed(db,actor);throw 409;}return next;
}
async function prePost(env,actor,op,lease,services,configured){
 const {saved,op:current}=await load(env.DB,actor,op.invoice_id,op.part_id,services);if(!current||current.id!==op.id||current.revision!==op.revision||current.lease_token!==lease||current.lease_until<=Date.now())throw 409;
 const guard=currentGuard(saved,actor,services),mapping=mappingGuard(op),tuple=rowTuple('o',current),r=saved.row;
 // All retained evidence and current authority share the last SQL snapshot.
 // A denial after a POST would be too late to protect an unjournalled request.
 const proof=await env.DB.batch([
  env.DB.prepare('SELECT 1 AS valid WHERE '+guard.sql+' AND '+mapping.sql+' AND EXISTS(SELECT 1 FROM stripe_part_operations o WHERE '+tuple.sql+')').bind(...guard.args,...mapping.args,...tuple.args),
  env.DB.prepare('SELECT * FROM stripe_installment_schedules WHERE id=? AND organization_id=?').bind(r.id,r.organization_id),
  env.DB.prepare('SELECT * FROM stripe_installment_parts WHERE schedule_id=? AND organization_id=? ORDER BY ordinal').bind(r.id,r.organization_id),
  env.DB.prepare('SELECT * FROM stripe_installment_events WHERE schedule_id=? AND organization_id=? ORDER BY revision').bind(r.id,r.organization_id),
  env.DB.prepare('SELECT * FROM stripe_part_operations WHERE schedule_id=? AND organization_id=? ORDER BY id LIMIT 3').bind(r.id,r.organization_id),
  env.DB.prepare('SELECT * FROM stripe_part_events WHERE schedule_id=? AND organization_id=? ORDER BY operation_id,revision LIMIT 2003').bind(r.id,r.organization_id)
 ]);
 if(!proof[0].results.length){await allowed(env.DB,actor);throw 409;}
 if(json(proof[1].results[0])!==json(r)||json(proof[2].results)!==json(saved.parts)||json(proof[3].results)!==json(saved.events)||json(proof[4].results)!==json(saved.activation.operations)||json(proof[5].results)!==json(saved.activation.events))throw 503;
 configuration(env,actor,services,configured);
}
async function execute(env,actor,original,services,{adoption=null,eventReason=null}={}){
 const db=env.DB;if(original.state==='DONE')return original;
 const configured=configuration(env,actor,services);if(configured.accountId!==original.account_id)throw 409;
 const before=await load(db,actor,original.invoice_id,original.part_id,services),guard=currentGuard(before.saved,actor,services),mapping=mappingGuard(original),lease=crypto.randomUUID(),now=Date.now();
 const locked=await db.prepare(`UPDATE stripe_part_operations SET lease_token=?,lease_until=? WHERE id=? AND organization_id=? AND state!='DONE' AND lease_until<=? AND ${guard.sql} AND ${mapping.sql} RETURNING *`).bind(lease,now+leaseTime,original.id,actor.organization_id,now,...guard.args,...mapping.args).first();
 if(!locked){await allowed(db,actor);return (await load(db,actor,original.invoice_id,original.part_id,services)).op;}
 let op=locked;const plan=JSON.parse(op.plan_json);
 try{
  const c=await services.customer(env,op.customer_id);if(json(c)!==json(plan.customer))throw services.error('PROVIDER_MISMATCH');
  let remote;
  if(adoption){remote=await services.read(env,'invoices/'+adoption);services.baseMatches(remote,op,plan);if(op.stripe_invoice_id&&op.stripe_invoice_id!==adoption)throw 409;await prePost(env,actor,op,lease,services,configured);op=await change(env,actor,op,lease,{state:'PENDING',stripe_invoice_id:adoption,stage:'LINES',last_error:null},'ADOPT',services,{authorize:true,eventReason});}
  if(!op.stripe_invoice_id){
   if(op.create_attempt_at!==null&&Date.now()-op.create_attempt_at>=retryWindow)throw services.error('IDEMPOTENCY_EXPIRED');
   op=await change(env,actor,op,lease,{state:'PENDING',last_error:null,create_attempt_at:op.create_attempt_at??Date.now()},'ATTEMPT_CREATE',services,{authorize:true});
   await prePost(env,actor,op,lease,services,configured);remote=await services.create(env,op,plan,'ashbi:'+op.id+':create');services.baseMatches(remote,op,plan);
   op=await change(env,actor,op,lease,{stripe_invoice_id:remote.id,stage:'LINES'},'CREATED',services);
  }
  remote=await services.read(env,'invoices/'+op.stripe_invoice_id);services.baseMatches(remote,op,plan);let lines=await services.lines(env,op.stripe_invoice_id,plan.lines.length);
  if(!services.exact(remote,lines,op,plan)){
   if(lines.length||remote.subtotal!==0||remote.total!==0)throw services.error('PROVIDER_MISMATCH');
   if(op.lines_attempt_at!==null&&Date.now()-op.lines_attempt_at>=retryWindow)throw services.error('IDEMPOTENCY_EXPIRED');
   op=await change(env,actor,op,lease,{state:'PENDING',last_error:null,lines_attempt_at:op.lines_attempt_at??Date.now()},'ATTEMPT_LINES',services,{authorize:true});
   await prePost(env,actor,op,lease,services,configured);await services.addLines(env,op,plan,'ashbi:'+op.id+':lines');
   remote=await services.read(env,'invoices/'+op.stripe_invoice_id);services.baseMatches(remote,op,plan);lines=await services.lines(env,op.stripe_invoice_id,plan.lines.length);if(!services.exact(remote,lines,op,plan))throw services.error('PROVIDER_MISMATCH');
  }
  op=await change(env,actor,op,lease,{state:'DONE',stage:'DONE',last_error:null},'COMPLETE',services);
 }catch(error){
  // Provider results remain durable even if access is revoked after the POST.
  // A lost grant must never authorize another POST on this execution.
  if(Number.isInteger(error))throw error;
  const code=error?.code??'LOCAL_RECOVERY_REQUIRED',uncertain=['PROVIDER_UNAVAILABLE','LOCAL_RECOVERY_REQUIRED'].includes(code);
  op=await change(env,actor,op,lease,{state:uncertain?'UNKNOWN':'REVIEW_REQUIRED',last_error:code},uncertain?'UNCERTAIN':'REVIEW_REQUIRED',services);
 }finally{await db.prepare('UPDATE stripe_part_operations SET lease_token=NULL,lease_until=0 WHERE id=? AND organization_id=? AND lease_token=?').bind(op.id,actor.organization_id,lease).run();}
 return op;
}
export async function stripePartDraftsRoute(request,env,actor,readBody,respond,services){
 await allowed(env.DB,actor);const url=new URL(request.url);if(url.search)throw 400;
 const match=url.pathname.match(/^\/api\/stripe\/schedules\/([a-zA-Z0-9-]{1,100})\/parts\/([a-zA-Z0-9-]{1,100})\/draft(?:\/(retry|reconcile)|\/requests\/([^/]+)(\/cancel)?)?$/);if(!match)throw 404;
 const invoiceId=match[1],partId=match[2],db=env.DB;
 if(match[4]){
  if(!uuid(match[4]))throw 400;const key=match[4].toLowerCase();if(request.method!==(match[5]?'POST':'GET'))throw 405;
  if(match[5]){strict(await readBody(request),[]);const {saved}=await load(db,actor,invoiceId,partId,services),guard=currentGuard(saved,actor,services,{strictMetadata:false});await db.prepare(`INSERT INTO cancelled_stripe_part_requests(id,organization_id,invoice_id,part_id,request_key,actor_id,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} AND NOT EXISTS(SELECT 1 FROM stripe_part_operations WHERE organization_id=? AND request_key=?) ON CONFLICT(organization_id,request_key) DO NOTHING`).bind(crypto.randomUUID(),actor.organization_id,invoiceId,partId,key,actor.id,Date.now(),...guard.args,actor.organization_id,key).run();}
  return respond(await receipt(db,actor,invoiceId,partId,key,services));
 }
 if(request.method==='GET'&&!match[3])return respond(await present(db,actor,invoiceId,partId,services));
 if(request.method!=='POST')throw 405;
 const body=await readBody(request);let op,status=200,adoption=null,eventReason=null;
 if(match[3]){
  if(match[3]==='retry')strict(body,[]);else{strict(body,['stripeInvoiceId','revision','reason']);if(!external(body.stripeInvoiceId)||!integer(body.revision))throw 400;adoption=body.stripeInvoiceId;eventReason=reason(body.reason);}
  const loaded=await load(db,actor,invoiceId,partId,services);op=loaded.op;if(!op)throw 404;if(adoption&&(op.revision!==body.revision||op.stripe_invoice_id!==null&&op.stripe_invoice_id!==adoption))throw 409;
 }else{const prepared=await prepare(env,actor,invoiceId,partId,body,services);op=prepared.op;status=prepared.status;if(status===200)return respond(await present(db,actor,invoiceId,partId,services));}
 await execute(env,actor,op,services,{adoption,eventReason});const value=await present(db,actor,invoiceId,partId,services);return respond(value,value.state==='DONE'?status:202);
}

// Shared local proof primitives; no provider transport or effects are exported.
export {load as loadPartDraft,currentGuard as partDraftGuard,mappingGuard as partDraftMappingGuard};
