import {hasFinance} from './time-details.mjs';
import {invoiceClaimGuard,invoiceHistoricalClaimGuard} from './invoices.mjs';
const authority="EXISTS(SELECT 1 FROM actors a JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='staff')";
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(v),uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),integer=v=>Number.isSafeInteger(v)&&v>=0;
const serialize=JSON.stringify,digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:serialize(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const columns='id,organization_id,client_id,project_id,created_by,title,currency,origin,status,subtotal_minor,tax_minor,total_minor,snapshot_json,request_key,request_fingerprint,preview_fingerprint,created_at,provider_state,stripe_invoice_id,paid_minor,voided_at,void_reason,released_at'.split(',');
function strict(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))throw 400;}
function reason(value){if(typeof value!=='string'||!value.trim()||value.length>2000||value.includes('\0'))throw 400;return value.trim();}
async function allowed(db,actor){if(!await hasFinance(db,actor))throw 403;}
function config(env,actor,expected){if(env.STRIPE_MODE!=='test'||!id(env.STRIPE_ORGANIZATION_ID)||!/^acct_[a-zA-Z0-9_]{1,100}$/.test(env.STRIPE_ACCOUNT_ID||'')||!/^sk_test_[a-zA-Z0-9_]+$/.test(env.STRIPE_SECRET_KEY||''))throw 503;if(env.STRIPE_ORGANIZATION_ID!==actor.organization_id)throw 404;const c={account:env.STRIPE_ACCOUNT_ID,key:env.STRIPE_SECRET_KEY};if(expected&&(c.account!==expected.account||c.key!==expected.key))throw 409;return c;}
const scope="EXISTS(SELECT 1 FROM clients c WHERE c.id=i.client_id AND c.organization_id=i.organization_id) AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.organization_id=i.organization_id AND p.client_id=i.client_id))";
function invoiceStatement(db,actor,invoiceId,extra='',args=[]){return db.prepare(`SELECT i.* FROM invoice_drafts i WHERE i.id=? AND i.organization_id=? AND ${scope} AND ${authority} ${extra}`).bind(invoiceId,actor.organization_id,actor.id,actor.organization_id,...args);}
async function invoice(db,actor,invoiceId){const row=await invoiceStatement(db,actor,invoiceId).first();if(!row){await allowed(db,actor);throw 404;}return row;}
function sourceGuard(source,revision,actor,{strictMetadata=true,historical=false}={}){
 const fields=historical?columns.filter(k=>!['status','provider_state','stripe_invoice_id','paid_minor','voided_at','void_reason','released_at'].includes(k)):columns;
 const args=[source.id,source.organization_id,...fields.map(k=>source[k]),revision,actor.id,actor.organization_id];
 const metadata=strictMetadata?" AND EXISTS(SELECT 1 FROM clients c WHERE c.id=i.client_id AND c.organization_id=i.organization_id AND c.name=json_extract(i.snapshot_json,'$.client.name') AND c.revision=json_extract(i.snapshot_json,'$.client.revision')) AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.organization_id=i.organization_id AND p.client_id=i.client_id AND p.name=json_extract(i.snapshot_json,'$.project.name') AND p.revision=json_extract(i.snapshot_json,'$.project.revision')))":'';
 const active=historical?' AND '+invoiceHistoricalClaimGuard('i'):" AND i.status='DRAFT' AND i.provider_state='NOT_CONNECTED' AND i.stripe_invoice_id IS NULL AND i.paid_minor=0 AND i.released_at IS NULL AND "+invoiceClaimGuard('i',{strictMetadata});
 return {sql:'EXISTS(SELECT 1 FROM invoice_drafts i WHERE i.id=? AND i.organization_id=? AND ('+fields.map(k=>'i.'+k).join(',')+') IS ('+fields.map(()=>'?').join(',')+') AND i.revision'+(historical?'>=':'=')+'? AND '+scope+' AND '+authority+metadata+active+')',args};
}
const get=(db,actor,scheduleId)=>db.prepare('SELECT * FROM stripe_installment_schedules WHERE id=? AND organization_id=?').bind(scheduleId,actor.organization_id).first();
async function read(db,actor,row){
 if(!row)throw 404;
 const [parts,events]=await Promise.all([db.prepare('SELECT * FROM stripe_installment_parts WHERE schedule_id=? AND organization_id=? ORDER BY ordinal').bind(row.id,actor.organization_id).all(),db.prepare('SELECT * FROM stripe_installment_events WHERE schedule_id=? AND organization_id=? ORDER BY revision').bind(row.id,actor.organization_id).all()]);
 let plan,source;try{plan=JSON.parse(row.plan_json);source=JSON.parse(row.source_image_json);}catch{throw 503;}
 if(await digest(row.plan_json)!==row.plan_hash||await digest(row.source_image_json)!==row.source_hash||plan.invoiceId!==row.invoice_id||plan.client?.id!==row.client_id||(plan.project?.id??null)!==row.project_id||source.id!==row.invoice_id||source.organization_id!==row.organization_id||source.client_id!==row.client_id||source.project_id!==row.project_id||parts.results.length!==2||!Array.isArray(plan.installments)||plan.installments.length!==2)throw 503;
 const {fingerprint,...parent}=plan;if(!hash(fingerprint)||await digest(parent)!==fingerprint)throw 503;
 for(let i=0;i<2;i++){const part=parts.results[i],expected=plan.installments[i];let parsed;try{parsed=JSON.parse(part.plan_json);}catch{throw 503;}const {fingerprint,...child}=parsed;if(part.ordinal!==i||part.kind!==['DEPOSIT','BALANCE'][i]||part.kind!==expected.kind||part.created_at!==row.created_at||part.plan_json!==serialize(expected)||await digest(part.plan_json)!==part.plan_hash||await digest(child)!==fingerprint)throw 503;}
 const saved={row,plan,source,parts:parts.results,events:events.results};
 if(saved.events.length!==row.revision+1||saved.events.some((e,i)=>e.revision!==i||e.invoice_id!==row.invoice_id||e.action!==['FREEZE','ABANDON'][i]))throw 503;
 for(const e of saved.events){let image;try{image=JSON.parse(e.state_json);}catch{throw 503;}if(image.planHash!==row.plan_hash||image.sourceHash!==row.source_hash||serialize(image.parts)!==serialize(saved.parts.map(p=>({id:p.id,kind:p.kind,planHash:p.plan_hash}))))throw 503;}
 const first=saved.events[0],initial={...saved,row:{...row,state:'FROZEN',revision:0,parent_revision:source.revision+1,activated_at:null,updated_at:row.created_at,abandoned_at:null,abandoned_by:null,abandonment_reason:null}};
 if(!integer(source.revision)||row.parent_revision!==source.revision+1+row.revision||first.actor_id!==row.actor_id||first.recorded_at!==row.created_at||first.state_json!==serialize(eventState(initial)))throw 503;
 const latest=saved.events.at(-1);if(latest.state_json!==serialize(eventState(saved))||latest.actor_id!==(row.state==='ABANDONED'?row.abandoned_by:row.actor_id)||latest.recorded_at!==row.updated_at)throw 503;
 return saved;
}
function dto(saved){const r=saved.row;return {id:r.id,invoiceId:r.invoice_id,state:r.state,revision:r.revision,plan:saved.plan,parts:saved.parts.map(p=>({id:p.id,kind:p.kind,plan:JSON.parse(p.plan_json)})),createdBy:r.actor_id,createdAt:r.created_at,updatedAt:r.updated_at,reason:r.reason,abandonedAt:r.abandoned_at,abandonedBy:r.abandoned_by,abandonmentReason:r.abandonment_reason};}
function eventState(saved){const r=saved.row;return {id:r.id,invoiceId:r.invoice_id,clientId:r.client_id,projectId:r.project_id,state:r.state,revision:r.revision,parentRevision:r.parent_revision,activatedAt:r.activated_at,actorId:r.actor_id,reason:r.reason,createdAt:r.created_at,updatedAt:r.updated_at,abandonedAt:r.abandoned_at,abandonedBy:r.abandoned_by,abandonmentReason:r.abandonment_reason,planHash:r.plan_hash,sourceHash:r.source_hash,parts:saved.parts.map(p=>({id:p.id,kind:p.kind,planHash:p.plan_hash}))};}
async function proof(db,actor,saved){
 const r=saved.row,guard=sourceGuard(saved.source,r.parent_revision,actor,{strictMetadata:false,historical:r.state==='ABANDONED'});
 // Historical abandoned receipts allow newer local schedule revisions, while
 // retaining the same immutable invoice/source image and current claim audit.
 const sql=guard.sql;
 const results=await db.batch([db.prepare('SELECT 1 AS valid WHERE '+sql).bind(...guard.args),db.prepare('SELECT * FROM stripe_installment_schedules WHERE id=? AND organization_id=?').bind(r.id,actor.organization_id),db.prepare('SELECT * FROM stripe_installment_parts WHERE schedule_id=? AND organization_id=? ORDER BY ordinal').bind(r.id,actor.organization_id),db.prepare('SELECT * FROM stripe_installment_events WHERE schedule_id=? AND organization_id=? ORDER BY revision').bind(r.id,actor.organization_id)]);
 if(!results[0].results.length){await allowed(db,actor);throw 409;}
 if(serialize(results[1].results[0])!==serialize(r)||serialize(results[2].results)!==serialize(saved.parts)||serialize(results[3].results)!==serialize(saved.events))throw 503;
}
async function present(db,actor,row){const saved=await read(db,actor,row),value=dto(saved);await proof(db,actor,saved);return value;}
function journal(db,saved,token,actor,action){const r=saved.row;return db.prepare('INSERT INTO stripe_installment_events(id,organization_id,schedule_id,invoice_id,actor_id,revision,action,state_json,recorded_at) SELECT ?,organization_id,id,invoice_id,?,?,?,?,? FROM stripe_installment_schedules WHERE id=? AND organization_id=? AND write_token=? RETURNING id').bind(token,actor.id,r.revision,action,serialize(eventState(saved)),r.updated_at,r.id,r.organization_id,token);}
function fence(db,saved,token){
 const r=saved.row,eventFields=['id','organization_id','schedule_id','invoice_id','actor_id','revision','action','state_json','recorded_at'];
 const events=[...saved.events,{id:token,organization_id:r.organization_id,schedule_id:r.id,invoice_id:r.invoice_id,actor_id:r.state==='ABANDONED'?r.abandoned_by:r.actor_id,revision:r.revision,action:r.state==='ABANDONED'?'ABANDON':'FREEZE',state_json:serialize(eventState(saved)),recorded_at:r.updated_at}];
 return db.prepare(`UPDATE stripe_installment_schedules SET write_token=CASE WHEN (SELECT COUNT(*) FROM stripe_installment_events e WHERE e.schedule_id=stripe_installment_schedules.id AND e.organization_id=stripe_installment_schedules.organization_id)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM stripe_installment_events e WHERE e.schedule_id=stripe_installment_schedules.id AND e.organization_id=stripe_installment_schedules.organization_id AND (${eventFields.map(k=>'e.'+k).join(',')}) IS (${eventFields.map(k=>"json_extract(expected.value,'$."+k+"')").join(',')}))) AND (SELECT COUNT(*) FROM stripe_installment_parts p WHERE p.schedule_id=stripe_installment_schedules.id AND p.organization_id=stripe_installment_schedules.organization_id)=2 AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM stripe_installment_parts p WHERE p.id=json_extract(expected.value,'$.id') AND p.schedule_id=stripe_installment_schedules.id AND p.organization_id=stripe_installment_schedules.organization_id AND p.kind=json_extract(expected.value,'$.kind') AND p.ordinal=json_extract(expected.value,'$.ordinal') AND p.plan_json=json_extract(expected.value,'$.plan_json') AND p.plan_hash=json_extract(expected.value,'$.plan_hash') AND p.created_at=stripe_installment_schedules.created_at)) AND EXISTS(SELECT 1 FROM invoice_drafts i WHERE i.id=stripe_installment_schedules.invoice_id AND i.organization_id=stripe_installment_schedules.organization_id AND i.revision=stripe_installment_schedules.parent_revision AND i.write_token=?) THEN write_token ELSE NULL END WHERE id=? AND organization_id=? AND write_token=? RETURNING id`).bind(r.revision+1,serialize(events),serialize(saved.parts),token,r.id,r.organization_id,token);
}
async function requestReceipt(db,actor,invoiceId,key){
 const results=await db.batch([invoiceStatement(db,actor,invoiceId),db.prepare('SELECT * FROM stripe_installment_schedules WHERE organization_id=? AND request_key=?').bind(actor.organization_id,key),db.prepare('SELECT * FROM cancelled_stripe_schedule_requests WHERE organization_id=? AND request_key=?').bind(actor.organization_id,key)]);
 if(!results[0].results.length){await allowed(db,actor);throw 404;}
 const row=results[1].results[0],stopped=results[2].results[0];if(row){if(row.invoice_id!==invoiceId)throw 409;return {state:'SAVED',schedule:await present(db,actor,row)};}if(stopped&&stopped.invoice_id!==invoiceId)throw 409;return stopped?{state:'CANCELLED',cancelledBy:stopped.actor_id,cancelledAt:stopped.created_at}:{state:'UNKNOWN'};
}
async function freeze(env,actor,invoiceId,body,preview){
 strict(body,['requestId','revision','fingerprint','reason']);if(!uuid(body.requestId)||!integer(body.revision)||!hash(body.fingerprint))throw 400;const why=reason(body.reason),key=body.requestId.toLowerCase(),requestHash=await digest({invoiceId,revision:body.revision,fingerprint:body.fingerprint,reason:why}),db=env.DB;
 const old=await db.prepare('SELECT * FROM stripe_installment_schedules WHERE organization_id=? AND request_key=?').bind(actor.organization_id,key).first();if(old){if(old.invoice_id!==invoiceId||old.request_fingerprint!==requestHash)throw 409;return {value:await present(db,actor,old),status:200};}
 const stopped=await requestReceipt(db,actor,invoiceId,key);if(stopped.state==='CANCELLED')throw 409;if(stopped.state==='SAVED'){const saved=await get(db,actor,stopped.schedule.id);if(saved.request_fingerprint!==requestHash)throw 409;return {value:await present(db,actor,saved),status:200};}
 const configured=config(env,actor),plan=await preview(invoiceId);if(plan.invoiceId!==invoiceId||plan.invoiceRevision!==body.revision||plan.fingerprint!==body.fingerprint||plan.accountId!==configured.account||!Array.isArray(plan.installments)||plan.installments.length!==2)throw 409;
 const source=await invoice(db,actor,invoiceId);if(source.revision!==body.revision||source.preview_fingerprint!==plan.sourceFingerprint||source.client_id!==plan.client?.id||(plan.project?.id??null)!==source.project_id||source.revision===Number.MAX_SAFE_INTEGER)throw 409;
 const now=Date.now(),token=crypto.randomUUID(),r={id:crypto.randomUUID(),organization_id:actor.organization_id,invoice_id:invoiceId,client_id:source.client_id,project_id:source.project_id,request_key:key,request_fingerprint:requestHash,plan_json:serialize(plan),plan_hash:await digest(plan),source_image_json:serialize(source),source_hash:await digest(source),actor_id:actor.id,reason:why,state:'FROZEN',revision:0,parent_revision:source.revision+1,activated_at:null,created_at:now,updated_at:now,abandoned_at:null,abandoned_by:null,abandonment_reason:null,write_token:token};
 const parts=[];for(let i=0;i<2;i++){const child=plan.installments[i];parts.push({id:crypto.randomUUID(),organization_id:actor.organization_id,schedule_id:r.id,kind:child.kind,ordinal:i,plan_json:serialize(child),plan_hash:await digest(child),created_at:now});}const saved={row:r,plan,source,parts,events:[]},guard=sourceGuard(source,source.revision,actor);
 if(r.plan_json.length>524288||r.source_image_json.length>524288||serialize(eventState(saved)).length>1048576)throw 409;config(env,actor,configured);
 const fields=Object.keys(r),first=db.prepare(`INSERT INTO stripe_installment_schedules(${fields.join(',')}) SELECT ${fields.map(()=>'?').join(',')} WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM stripe_customer_links m WHERE m.id=? AND m.organization_id=? AND m.client_id=? AND m.account_id=? AND m.customer_id=?) AND NOT EXISTS(SELECT 1 FROM cancelled_stripe_schedule_requests WHERE organization_id=? AND request_key=?) RETURNING id`).bind(...fields.map(k=>r[k]),...guard.args,plan.mappingId,actor.organization_id,source.client_id,plan.accountId,plan.customer.id,actor.organization_id,key);
 const statements=[first,...parts.map(p=>db.prepare('INSERT INTO stripe_installment_parts(id,organization_id,schedule_id,kind,ordinal,plan_json,plan_hash,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM stripe_installment_schedules WHERE id=? AND organization_id=? AND write_token=?) RETURNING id').bind(p.id,p.organization_id,p.schedule_id,p.kind,p.ordinal,p.plan_json,p.plan_hash,p.created_at,r.id,r.organization_id,token)),db.prepare(`UPDATE invoice_drafts SET revision=revision+1,write_token=? WHERE id=? AND organization_id=? AND ${guard.sql} AND EXISTS(SELECT 1 FROM stripe_installment_schedules WHERE id=? AND organization_id=? AND write_token=?) RETURNING id`).bind(token,invoiceId,actor.organization_id,...guard.args,r.id,r.organization_id,token),journal(db,saved,token,actor,'FREEZE'),fence(db,saved,token)];
 try{const result=await db.batch(statements);if(!result[0].results.length){await allowed(db,actor);throw 409;}}catch(e){await allowed(db,actor);const winner=await db.prepare('SELECT * FROM stripe_installment_schedules WHERE organization_id=? AND request_key=?').bind(actor.organization_id,key).first();if(winner&&winner.invoice_id===invoiceId&&winner.request_fingerprint===requestHash)return {value:await present(db,actor,winner),status:200};throw 409;}
 return {value:await present(db,actor,await get(db,actor,r.id)),status:201};
}
async function abandon(db,actor,invoiceId,scheduleId,body){
 strict(body,['revision','reason']);if(!integer(body.revision))throw 400;const why=reason(body.reason),old=await get(db,actor,scheduleId);if(!old||old.invoice_id!==invoiceId)throw 404;if(old.activated_at!==null)throw 409;const saved=await read(db,actor,old);await proof(db,actor,saved);if(old.state!=='FROZEN'||old.revision!==body.revision||old.parent_revision===Number.MAX_SAFE_INTEGER)throw 409;
 const token=crypto.randomUUID(),now=Date.now(),r={...old,state:'ABANDONED',revision:old.revision+1,parent_revision:old.parent_revision+1,updated_at:now,abandoned_at:now,abandoned_by:actor.id,abandonment_reason:why,write_token:token},next={...saved,row:r},guard=sourceGuard(saved.source,old.parent_revision,actor,{strictMetadata:false});
 const oldFields=Object.keys(old);
 const first=db.prepare(`UPDATE stripe_installment_schedules SET state='ABANDONED',revision=revision+1,parent_revision=parent_revision+1,updated_at=?,abandoned_at=?,abandoned_by=?,abandonment_reason=?,write_token=? WHERE id=? AND organization_id=? AND invoice_id=? AND state='FROZEN' AND revision=? AND activated_at IS NULL AND (${oldFields.join(',')}) IS (${oldFields.map(()=>'?').join(',')}) AND ${guard.sql} RETURNING id`).bind(now,now,actor.id,why,token,scheduleId,actor.organization_id,invoiceId,body.revision,...oldFields.map(k=>old[k]),...guard.args);
 const result=await db.batch([first,db.prepare(`UPDATE invoice_drafts SET revision=revision+1,write_token=? WHERE id=? AND organization_id=? AND ${guard.sql} AND EXISTS(SELECT 1 FROM stripe_installment_schedules WHERE id=? AND organization_id=? AND write_token=?) RETURNING id`).bind(token,invoiceId,actor.organization_id,...guard.args,scheduleId,actor.organization_id,token),journal(db,next,token,actor,'ABANDON'),fence(db,next,token)]).catch(async()=>{await allowed(db,actor);throw 409;});if(!result[0].results.length){await allowed(db,actor);throw 409;}return present(db,actor,await get(db,actor,scheduleId));
}
export async function stripeSchedulesRoute(request,env,actor,readBody,json,preview){
 const db=env.DB;await allowed(db,actor);const url=new URL(request.url);if(url.search)throw 400;const match=url.pathname.match(/^\/api\/stripe\/schedules\/([a-zA-Z0-9-]{1,100})(?:\/requests\/([^/]+)(\/cancel)?|\/([a-zA-Z0-9-]{1,100})\/abandon)?$/);if(!match)throw 404;
 const invoiceId=match[1];await invoice(db,actor,invoiceId);
 if(match[2]){if(!uuid(match[2]))throw 400;const key=match[2].toLowerCase();if(request.method!==(match[3]?'POST':'GET'))throw 405;if(match[3]){strict(await readBody(request),[]);await db.prepare(`INSERT INTO cancelled_stripe_schedule_requests(id,organization_id,invoice_id,request_key,actor_id,created_at) SELECT ?,?,?,?,?,? WHERE ${authority} AND NOT EXISTS(SELECT 1 FROM stripe_installment_schedules WHERE organization_id=? AND request_key=?) ON CONFLICT(organization_id,request_key) DO NOTHING`).bind(crypto.randomUUID(),actor.organization_id,invoiceId,key,actor.id,Date.now(),actor.id,actor.organization_id,actor.organization_id,key).run();}return json(await requestReceipt(db,actor,invoiceId,key));}
 if(match[4]){if(request.method!=='POST')throw 405;return json(await abandon(db,actor,invoiceId,match[4],await readBody(request)));}
 if(request.method==='GET'){const row=await db.prepare("SELECT * FROM stripe_installment_schedules WHERE invoice_id=? AND organization_id=? ORDER BY parent_revision DESC LIMIT 1").bind(invoiceId,actor.organization_id).first();return json(await present(db,actor,row));}
 if(request.method!=='POST')throw 405;const result=await freeze(env,actor,invoiceId,await readBody(request),preview);return json(result.value,result.status);
}

// Ordinary finance exports retain business plans and audit history, not replay
// credentials. source_hash identifies the private original image retained by the
// native backup; the original invoice snapshot is exported via invoice_drafts.
export function scheduleExport(db,actor,table){
 const fields={
  stripe_installment_schedules:'id,organization_id,invoice_id,client_id,project_id,plan_json,plan_hash,source_hash,actor_id,reason,state,revision,parent_revision,activated_at,created_at,updated_at,abandoned_at,abandoned_by,abandonment_reason',
  stripe_installment_parts:'id,organization_id,schedule_id,kind,ordinal,plan_json,plan_hash,created_at',
  stripe_installment_events:'id,organization_id,schedule_id,invoice_id,actor_id,revision,action,state_json,recorded_at',
  cancelled_stripe_schedule_requests:'id,organization_id,invoice_id,actor_id,created_at'
 }[table];
 if(!fields)throw 500;
 // Measure the serialized whitelist, including UTF-8 and JSON string escaping,
 // before returning large values to the Worker. The CTE carries byte counts,
 // not an aggregate of JSON images. Budget and data gate share one SQL snapshot.
 const encoded='json_object('+fields.split(',').map(field=>"'"+field+"',"+field).join(',')+')';
 return db.prepare(`WITH export_budget AS (
  SELECT COALESCE(SUM(row_bytes+1),0)+2 AS bytes FROM (
   SELECT length(CAST(${encoded} AS BLOB)) AS row_bytes FROM ${table}
   WHERE organization_id=? AND ${authority} ORDER BY id LIMIT 1001
  )
 ), export_rows AS (
  SELECT ${fields},0 AS __export_overflow FROM ${table}
  WHERE organization_id=? AND ${authority} AND (SELECT bytes FROM export_budget)<=2097152 ORDER BY id LIMIT 1001
 ) SELECT * FROM export_rows UNION ALL
 SELECT ${fields.split(',').map(()=>'NULL').join(',')},1 AS __export_overflow WHERE (SELECT bytes FROM export_budget)>2097152`)
 .bind(actor.organization_id,actor.id,actor.organization_id,actor.organization_id,actor.id,actor.organization_id);
}
