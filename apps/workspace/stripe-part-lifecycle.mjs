import {hasFinance} from './time-details.mjs';
import {invoiceClaimGuard} from './invoices.mjs';
import {loadSchedulePart,scheduleSourceGuard,scheduleProof} from './stripe-schedules.mjs';
import {loadPartIssuance} from './stripe-part-issuance.mjs';
import {stripeAuthoritativeSnapshot} from './stripe-lifecycle.mjs';

const json=JSON.stringify,sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(v),money=v=>Number.isSafeInteger(v)&&v>=0;
const services={loadSchedule:loadSchedulePart,sourceGuard:scheduleSourceGuard,proof:scheduleProof};
const finance="EXISTS(SELECT 1 FROM actors a JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='staff')";
const client="EXISTS(SELECT 1 FROM actors a WHERE a.id=? AND a.organization_id=i.organization_id AND a.active=1 AND a.role='client' AND a.client_id=i.client_id) AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects pr WHERE pr.id=i.project_id AND pr.organization_id=i.organization_id AND pr.client_id=i.client_id AND pr.client_visible=1))";
const projectionFields=['part_id','organization_id','invoice_id','schedule_id','creation_operation_id','issuance_operation_id','account_id','stripe_invoice_id'];
class PartError extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
function config(env){if(env.STRIPE_MODE!=='test'||!id(env.STRIPE_ORGANIZATION_ID)||!/^acct_[a-zA-Z0-9_]{1,100}$/.test(env.STRIPE_ACCOUNT_ID||''))throw 503;return {org:env.STRIPE_ORGANIZATION_ID,account:env.STRIPE_ACCOUNT_ID};}
function sameConfig(env,c){const current=config(env);if(current.org!==c.org||current.account!==c.account)throw 503;}
function tuple(alias,row){const fields=Object.keys(row);return {sql:'('+fields.map(k=>alias?alias+'.'+k:k).join(',')+') IS (SELECT '+fields.map(k=>"json_extract(value,'$."+k+"')").join(',')+' FROM json_each(?))',args:[json([row])]};}
function rowsGuard(table,scope,scopeArgs,rows){const fields=rows.length?Object.keys(rows[0]):[];return {sql:`(SELECT COUNT(*) FROM ${table} e WHERE ${scope})=?`+(fields.length?` AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM ${table} e WHERE (${fields.map(k=>'e.'+k).join(',')}) IS (${fields.map(k=>"json_extract(expected.value,'$."+k+"')").join(',')})))`:''),args:[...scopeArgs,rows.length,...(fields.length?[json(rows)]:[])]};}
function authority(actor,portal){return {sql:portal?client:finance,args:portal?[actor.id]:[actor.id,actor.organization_id]};}
async function currentReader(db,actor,portal){if(portal){if(!await db.prepare("SELECT id FROM actors WHERE id=? AND organization_id=? AND role='client' AND active=1 AND client_id=?").bind(actor.id,actor.organization_id,actor.client_id).first())throw 403;}else if(!await hasFinance(db,actor))throw 403;}
const snapshotTables=['stripe_installment_schedules','stripe_installment_parts','stripe_installment_events','stripe_part_operations','stripe_part_events','stripe_part_issuance_operations','stripe_part_issuance_events','stripe_part_projection','stripe_part_lifecycle_events'];
async function preload(db,org,chosen){
 if(chosen.length>1001)throw 409;
 const schema=await db.batch(snapshotTables.map(table=>db.prepare('PRAGMA table_info('+table+')'))),fields=schema.map(result=>result.results.map(row=>row.name));
 if(fields.some(list=>!list.length||list.some(name=>!/^[a-z_]+$/.test(name))))throw 503;
 const cte="WITH chosen AS (SELECT json_extract(value,'$.part_id') AS part_id FROM json_each(?)), schedule_ids AS (SELECT DISTINCT schedule_id FROM stripe_installment_parts WHERE organization_id=? AND id IN (SELECT part_id FROM chosen)) ";
 const scopes=snapshotTables.map((table,i)=>i===0?'e.id IN (SELECT schedule_id FROM schedule_ids)':i<5?'e.schedule_id IN (SELECT schedule_id FROM schedule_ids)':'e.part_id IN (SELECT part_id FROM chosen)');
 const byteQueries=snapshotTables.map((table,i)=>{
  const list=fields[i],overhead=2+list.reduce((sum,key)=>sum+json(key).length+2,0),bytes=list.map(key=>"length(CAST(json_quote(e."+key+") AS BLOB))").join('+');
  // Both children can parse the same schedule history. Charge those contexts
  // twice before loading rather than underestimating retained JSON copies.
  return 'SELECT COALESCE(SUM(('+overhead+'+'+bytes+')*'+(i<5?2:1)+'),0) AS bytes FROM '+table+' e WHERE e.organization_id=? AND '+scopes[i];
 });
 const budgetBody='SELECT ('+byteQueries.map(query=>'('+query+')').join('+')+') AS bytes',budgetSql=cte+budgetBody,budgetArgs=[json(chosen),org,...snapshotTables.map(()=>org)];
 const budget=await db.prepare(budgetSql).bind(...budgetArgs).first();
 if(!budget||!money(budget.bytes)||budget.bytes>2097152)throw 409;
 const boundedCte=cte.trimEnd()+', read_budget AS ('+budgetBody+') ';
 const loaded=await db.batch([db.prepare(budgetSql).bind(...budgetArgs),...snapshotTables.map((table,i)=>db.prepare(boundedCte+'SELECT e.* FROM '+table+' e WHERE e.organization_id=? AND '+scopes[i]+' AND (SELECT bytes FROM read_budget)<=2097152').bind(...budgetArgs,org))]);
 if(!loaded[0].results[0]||!money(loaded[0].results[0].bytes)||loaded[0].results[0].bytes>2097152)throw 409;
 const results=loaded.slice(1),tables=Object.fromEntries(snapshotTables.map((table,i)=>[table,results[i].results]));
 // Only the existing immutable validators' fixed SELECTs are supported. There
 // is deliberately no fallback to live queries or mutations on this adapter.
 function prepare(sql){let args=[];function read(){
  let rows;
  if(sql==='SELECT s.* FROM stripe_installment_schedules s JOIN stripe_installment_parts p ON p.schedule_id=s.id AND p.organization_id=s.organization_id WHERE s.invoice_id=? AND s.organization_id=? AND p.id=?'){
   const [invoiceId,organizationId,partId]=args,part=tables.stripe_installment_parts.find(p=>p.id===partId&&p.organization_id===organizationId);rows=part?tables.stripe_installment_schedules.filter(s=>s.id===part.schedule_id&&s.organization_id===organizationId&&s.invoice_id===invoiceId):[];
  }else{
   const match=sql.match(/^SELECT \* FROM ([a-z_]+) WHERE (schedule_id|part_id|operation_id|organization_id)=\? AND (organization_id|part_id)=\?(?: ORDER BY (ordinal|revision|id|operation_id,revision))?(?: LIMIT (\d+))?$/);
   if(!match||!Object.hasOwn(tables,match[1]))throw new Error('Unsupported immutable snapshot query');
   rows=tables[match[1]].filter(row=>row[match[2]]===args[0]&&row[match[3]]===args[1]);
   if(match[4]){const keys=match[4].split(',');rows=[...rows].sort((a,b)=>{for(const key of keys){if(a[key]!==b[key])return a[key]<b[key]?-1:1;}return 0;});}if(match[5])rows=rows.slice(0,Number(match[5]));
  }
  return {results:rows};
 }
 return {bind(...values){args=values;return this;},async all(){return read();},async first(){return read().results[0]??null;},_read:read};}
 const reader={prepare,async batch(statements){return statements.map(statement=>statement._read());}};
 return {db:reader};
}
async function context(db,org,invoiceId,partId,snapshot=null){const cached=snapshot??await preload(db,org,[{part_id:partId,invoice_id:invoiceId}]),loaded=await loadPartIssuance(cached.db,{organization_id:org},invoiceId,partId,services);if(!loaded.saved||loaded.saved.row.state!=='DONE'||loaded.saved.row.stage!=='DONE')throw new PartError('CREATION_INCOMPLETE');loaded.snapshot=cached;return loaded;}

function sourceGuard(loaded,{actor=null,portal=false}={}){
 const c=loaded.context,s=c.saved,r=s.row,source=s.source,fields=Object.keys(source).filter(k=>!['revision','write_token'].includes(k)),invoice=tuple('i',Object.fromEntries(fields.map(k=>[k,source[k]]))),creation=tuple('c',c.op),issuance=tuple('u',loaded.saved.row),mapping=JSON.parse(c.op.plan_json),auth=actor?authority(actor,portal):{sql:'1',args:[]};
 return {sql:`EXISTS(SELECT 1 FROM invoice_drafts i JOIN stripe_part_operations c ON c.invoice_id=i.id AND c.organization_id=i.organization_id JOIN stripe_part_issuance_operations u ON u.creation_operation_id=c.id AND u.organization_id=c.organization_id JOIN stripe_customer_links m ON m.id=c.mapping_id AND m.organization_id=c.organization_id WHERE ${invoice.sql} AND i.revision=? AND ${creation.sql} AND ${issuance.sql} AND i.status='DRAFT' AND i.provider_state='NOT_CONNECTED' AND i.stripe_invoice_id IS NULL AND i.paid_minor=0 AND i.released_at IS NULL AND m.client_id=i.client_id AND m.account_id=c.account_id AND m.customer_id=c.customer_id AND m.id=? AND m.account_id=? AND m.customer_id=? AND EXISTS(SELECT 1 FROM clients cl WHERE cl.id=i.client_id AND cl.organization_id=i.organization_id) AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.organization_id=i.organization_id AND p.client_id=i.client_id)) AND ${invoiceClaimGuard('i',{strictMetadata:false})} AND ${auth.sql})`,args:[...invoice.args,r.parent_revision,...creation.args,...issuance.args,mapping.mappingId,mapping.accountId,mapping.customer.id,...auth.args]};
}
function evidenceGuard(loaded){const c=loaded.context,s=c.saved,r=s.row,checks=[{sql:'EXISTS(SELECT 1 FROM stripe_installment_schedules s WHERE '+tuple('s',r).sql+')',args:tuple('s',r).args},rowsGuard('stripe_installment_parts','e.schedule_id=? AND e.organization_id=?',[r.id,r.organization_id],s.parts),rowsGuard('stripe_installment_events','e.schedule_id=? AND e.organization_id=?',[r.id,r.organization_id],s.events),rowsGuard('stripe_part_operations','e.schedule_id=? AND e.organization_id=?',[r.id,r.organization_id],s.activation.operations),rowsGuard('stripe_part_events','e.schedule_id=? AND e.organization_id=?',[r.id,r.organization_id],s.activation.events),rowsGuard('stripe_part_issuance_events','e.operation_id=? AND e.organization_id=?',[loaded.saved.row.id,r.organization_id],loaded.saved.events)];return {sql:checks.map(c=>'('+c.sql+')').join(' AND '),args:checks.flatMap(c=>c.args)};}
function eventImage(row,source,inboxId,actorId,snapshotHash){return {partId:row.part_id,invoiceId:row.invoice_id,scheduleId:row.schedule_id,creationOperationId:row.creation_operation_id,issuanceOperationId:row.issuance_operation_id,accountId:row.account_id,stripeInvoiceId:row.stripe_invoice_id,revision:row.revision,observedAt:row.observed_at,source,inboxId,actorId,snapshotHash};}
async function projection(db,loaded){
 const op=loaded.context.op,u=loaded.saved.row,row=await db.prepare('SELECT * FROM stripe_part_projection WHERE part_id=? AND organization_id=?').bind(op.part_id,op.organization_id).first();
 if(!row)return {row:null,events:[]};
 if(row.invoice_id!==op.invoice_id||row.schedule_id!==op.schedule_id||row.creation_operation_id!==op.id||row.issuance_operation_id!==u.id||row.account_id!==op.account_id||row.stripe_invoice_id!==op.stripe_invoice_id||!money(row.revision)||row.revision>1000)throw 503;
 const events=(await db.prepare('SELECT * FROM stripe_part_lifecycle_events WHERE part_id=? AND organization_id=? ORDER BY revision LIMIT 1002').bind(op.part_id,op.organization_id).all()).results;
 if(events.length!==row.revision||row.snapshot_json===null&&(row.revision!==0||row.snapshot_hash!==null||row.observed_at!==null))throw 503;
 for(let i=0;i<events.length;i++){const e=events[i];if(e.revision!==i+1||e.part_id!==row.part_id||e.invoice_id!==row.invoice_id||e.schedule_id!==row.schedule_id||e.account_id!==row.account_id||await sha(e.snapshot_json)!==e.snapshot_hash||e.state_json!==json(eventImage({...row,revision:e.revision,observed_at:e.observed_at},e.source,e.inbox_id,e.actor_id,e.snapshot_hash)))throw 503;}
 if(row.snapshot_json!==null){const latest=events.at(-1);if(!latest||latest.snapshot_json!==row.snapshot_json||latest.snapshot_hash!==row.snapshot_hash||latest.observed_at!==row.observed_at)throw 503;let value;try{value=JSON.parse(row.snapshot_json);}catch{throw 503;}const plan=JSON.parse(op.plan_json);if(value.partId!==op.part_id||value.invoiceId!==op.invoice_id||value.scheduleId!==op.schedule_id||value.kind!==op.kind||value.stripeInvoiceId!==op.stripe_invoice_id||value.currency!==plan.currency||value.totalMinor!==plan.totalMinor||value.subtotalMinor!==plan.subtotalMinor||value.taxMinor!==plan.taxMinor)throw 503;}
 return {row,events};
}
async function observe(env,fetcher,loaded,{actor=null,inbox=null,source='STAFF'}={}){
 const db=env.DB,c=config(env),op=loaded.context.op,u=loaded.saved.row;if(op.organization_id!==c.org||op.account_id!==c.account)throw 404;
 let previous=await projection(loaded.snapshot.db,loaded);if(inbox&&previous.events.some(e=>e.inbox_id===inbox.id))return;
 const guard=sourceGuard(loaded,{actor}),evidence=evidenceGuard(loaded),base={part_id:op.part_id,organization_id:op.organization_id,invoice_id:op.invoice_id,schedule_id:op.schedule_id,creation_operation_id:op.id,issuance_operation_id:u.id,account_id:op.account_id,stripe_invoice_id:op.stripe_invoice_id};
 await db.prepare(`INSERT INTO stripe_part_projection(${projectionFields.join(',')}) SELECT ${projectionFields.map(()=>'?').join(',')} WHERE ${guard.sql} AND ${evidence.sql} ON CONFLICT(part_id) DO NOTHING`).bind(...projectionFields.map(k=>base[k]),...guard.args,...evidence.args).run();
 const lease=crypto.randomUUID(),now=Date.now(),claimed=await db.prepare(`UPDATE stripe_part_projection SET lease_token=?,lease_until=? WHERE part_id=? AND organization_id=? AND lease_until<=? AND ${guard.sql} AND ${evidence.sql} RETURNING *`).bind(lease,now+300000,op.part_id,op.organization_id,now,...guard.args,...evidence.args).first();
 if(!claimed){if(actor)await currentReader(db,actor,false);throw 409;}
 try{
  previous=await projection((await preload(db,op.organization_id,[{part_id:op.part_id,invoice_id:op.invoice_id}])).db,loaded);const plan=JSON.parse(op.plan_json),snapshot=await stripeAuthoritativeSnapshot(env,fetcher,c,op,plan,{partId:op.part_id,scheduleId:op.schedule_id});
  if(!['open','paid','void','uncollectible'].includes(snapshot.status)||!money(snapshot.finalizedAt))throw new PartError('STATE_REGRESSION');
  Object.assign(snapshot,{partId:op.part_id,scheduleId:op.schedule_id,kind:op.kind});
  if(previous.row?.snapshot_json){const old=JSON.parse(previous.row.snapshot_json);if(['paid','void'].includes(old.status)&&snapshot.status!==old.status||old.status!=='draft'&&snapshot.status==='draft')throw new PartError('STATE_REGRESSION');}
  const serialized=json(snapshot);if(serialized.length>262144||claimed.revision>=1000)throw new PartError('READ_LIMIT');const snapshotHash=await sha(serialized),token=crypto.randomUUID(),observedAt=Date.now(),next={...claimed,snapshot_json:serialized,snapshot_hash:snapshotHash,observed_at:observedAt,revision:claimed.revision+1,last_error:null,last_attempt_at:observedAt,write_token:token},old=tuple('',claimed),retained=rowsGuard('stripe_part_lifecycle_events','e.part_id=? AND e.organization_id=?',[op.part_id,op.organization_id],previous.events),inboxGuard=inbox?" AND EXISTS(SELECT 1 FROM stripe_event_inbox b WHERE b.id=? AND b.organization_id=? AND b.account_id=? AND b.state='PROCESSING' AND b.lease_token=? AND b.lease_until>?)":'',inboxArgs=inbox?[inbox.id,c.org,c.account,inbox.lease_token,observedAt]:[];
  sameConfig(env,c);
  const first=db.prepare(`UPDATE stripe_part_projection SET snapshot_json=?,snapshot_hash=?,observed_at=?,revision=?,last_error=NULL,last_attempt_at=?,write_token=? WHERE part_id=? AND organization_id=? AND lease_token=? AND lease_until>? AND ${old.sql} AND ${guard.sql} AND ${evidence.sql} AND ${retained.sql}${inboxGuard} RETURNING part_id`).bind(serialized,snapshotHash,observedAt,next.revision,observedAt,token,op.part_id,op.organization_id,lease,observedAt,...old.args,...guard.args,...evidence.args,...retained.args,...inboxArgs);
  const state=json(eventImage(next,source,inbox?.id??null,actor?.id??null,snapshotHash)),journal=db.prepare(`INSERT INTO stripe_part_lifecycle_events(id,organization_id,invoice_id,schedule_id,part_id,account_id,inbox_id,actor_id,revision,observed_at,source,snapshot_json,snapshot_hash,state_json) SELECT ?,organization_id,invoice_id,schedule_id,part_id,account_id,?,?,revision,observed_at,?,snapshot_json,snapshot_hash,? FROM stripe_part_projection WHERE part_id=? AND organization_id=? AND write_token=? RETURNING id`).bind(token,inbox?.id??null,actor?.id??null,source,state,op.part_id,op.organization_id,token);
  const fence=db.prepare(`UPDATE stripe_part_projection SET write_token=CASE WHEN (SELECT COUNT(*) FROM stripe_part_lifecycle_events e WHERE e.part_id=stripe_part_projection.part_id AND e.organization_id=stripe_part_projection.organization_id)=? AND EXISTS(SELECT 1 FROM stripe_part_lifecycle_events e WHERE e.id=? AND e.organization_id=stripe_part_projection.organization_id AND e.part_id=stripe_part_projection.part_id AND e.revision=stripe_part_projection.revision AND e.snapshot_json=stripe_part_projection.snapshot_json AND e.snapshot_hash=stripe_part_projection.snapshot_hash AND e.state_json=? AND e.inbox_id IS ? AND e.actor_id IS ? AND e.source=? AND e.observed_at=stripe_part_projection.observed_at) THEN write_token ELSE NULL END WHERE part_id=? AND organization_id=? AND write_token=? RETURNING part_id`).bind(next.revision,token,state,inbox?.id??null,actor?.id??null,source,op.part_id,op.organization_id,token);
  const results=await db.batch([first,journal,fence]);if(!results[0].results.length){if(actor)await currentReader(db,actor,false);throw 409;}return snapshot;
 }catch(error){if(!actor||await hasFinance(db,actor))await db.prepare('UPDATE stripe_part_projection SET last_error=?,last_attempt_at=? WHERE part_id=? AND organization_id=? AND lease_token=?').bind(error.code??(typeof error==='number'?'CONFLICT':'PERSISTENCE'),Date.now(),op.part_id,op.organization_id,lease).run();throw error;}
 finally{await db.prepare('UPDATE stripe_part_projection SET lease_token=NULL,lease_until=0 WHERE part_id=? AND organization_id=? AND lease_token=?').bind(op.part_id,op.organization_id,lease).run();}
}
export async function observeStripePartNative(env,fetcher,nativeId,{actor=null,inbox=null,source='WEBHOOK',remote=null}={}){
 const c=config(env);let op=await env.DB.prepare(`SELECT id,invoice_id,part_id,organization_id,state,stage,stripe_invoice_id,customer_id,schedule_id,json_extract(plan_json,'$.fingerprint') AS fingerprint FROM stripe_part_operations WHERE organization_id=? AND account_id=? AND stripe_invoice_id=?`).bind(c.org,c.account,nativeId).first();
 if(!op&&remote?.metadata?.ashbi_operation)op=await env.DB.prepare(`SELECT id,invoice_id,part_id,organization_id,state,stage,stripe_invoice_id,customer_id,schedule_id,json_extract(plan_json,'$.fingerprint') AS fingerprint FROM stripe_part_operations WHERE id=? AND organization_id=? AND account_id=?`).bind(remote.metadata.ashbi_operation,c.org,c.account).first();
 if(!op)return null;
 if(remote&&(remote.customer!==op.customer_id||remote.metadata?.ashbi_schedule!==op.schedule_id||remote.metadata?.ashbi_part!==op.part_id||remote.metadata?.ashbi_invoice!==op.invoice_id||remote.metadata?.ashbi_plan!==op.fingerprint))throw new PartError('PROVIDER_MISMATCH');
 if(op.state!=='DONE'||op.stage!=='DONE'||op.stripe_invoice_id!==nativeId)throw new PartError('CREATION_INCOMPLETE');
 const loaded=await context(env.DB,c.org,op.invoice_id,op.part_id);await observe(env,fetcher,loaded,{actor,inbox,source});return {partId:op.part_id,invoiceId:op.invoice_id};
}
export async function stripePartInboxProof(env,partId,inboxId,actor=null){
 const c=config(env),op=await env.DB.prepare('SELECT invoice_id FROM stripe_part_operations WHERE part_id=? AND organization_id=? AND account_id=?').bind(partId,c.org,c.account).first();if(!op)throw 409;
 const loaded=await context(env.DB,c.org,op.invoice_id,partId),observed=await projection(loaded.snapshot.db,loaded);if(!observed.row||!observed.events.some(e=>e.inbox_id===inboxId))throw 409;
 const source=sourceGuard(loaded,{actor}),evidence=evidenceGuard(loaded),row=tuple('p',observed.row),events=rowsGuard('stripe_part_lifecycle_events','e.part_id=? AND e.organization_id=?',[partId,c.org],observed.events);
 return {sql:source.sql+' AND '+evidence.sql+' AND EXISTS(SELECT 1 FROM stripe_part_projection p WHERE '+row.sql+') AND '+events.sql,args:[...source.args,...evidence.args,...row.args,...events.args]};
}

const unknownMoney=['paidMinor','dueMinor','remainingMinor','overpaidMinor','startingBalanceMinor','recordedPaymentMinor','unallocatedPaidMinor','preCreditMinor','postCreditMinor','balanceCreditMinor','outOfBandCreditMinor','creditRefundAllocatedMinor','reportedExternalRefundMinor','refundedMinor','pendingRefundMinor','failedRefundMinor','canceledRefundMinor'];
function dto(loaded,observed,portal){const op=loaded.context.op,plan=JSON.parse(op.plan_json),r=observed.row;let value=r?.snapshot_json?JSON.parse(r.snapshot_json):{version:1,partId:op.part_id,invoiceId:op.invoice_id,scheduleId:op.schedule_id,kind:op.kind,stripeInvoiceId:op.stripe_invoice_id,title:plan.title,client:plan.client,currency:plan.currency,totalMinor:plan.totalMinor,subtotalMinor:plan.subtotalMinor,taxMinor:plan.taxMinor,dueAt:plan.dueAt,status:null,finalizedAt:null,autoAdvance:null,hostedInvoiceUrl:null,invoicePdf:null,payments:[],credits:[],refunds:[],refundAllocationComplete:null,...Object.fromEntries(unknownMoney.map(k=>[k,null]))};
 if(portal){if(value.refundAllocationComplete!==true)value.refunds=[];value.payments=value.payments.map(({reference,...payment})=>payment);}
 return {...value,revision:r?.revision??0,observedAt:r?.observed_at??null,syncState:!r?.snapshot_json?'UNOBSERVED':r.last_error?(['PROVIDER_UNAVAILABLE','PERSISTENCE','CONFLICT','CREATION_INCOMPLETE'].includes(r.last_error)?'RETRY':'REVIEW_REQUIRED'):r.lease_until>Date.now()?'SYNC_PENDING':'OBSERVED',overdue:value.status==='open'&&value.remainingMinor>0&&value.dueAt*1000<Date.now(),...(!portal?{accountId:op.account_id,lastError:r?.last_error??null,lastAttemptAt:r?.last_attempt_at??null}:{})};}
async function readOne(db,actor,invoiceId,partId,portal,snapshot=null){const loaded=await context(db,actor.organization_id,invoiceId,partId,snapshot),observed=await projection(loaded.snapshot.db,loaded);return {loaded,observed,value:dto(loaded,observed,portal)};}
function readProofs(db,actor,records,portal){
 const statements=[];for(const {loaded,observed} of records){const g=sourceGuard(loaded,{actor,portal}),e=evidenceGuard(loaded),p=rowsGuard('stripe_part_projection','e.part_id=? AND e.organization_id=?',[loaded.context.op.part_id,actor.organization_id],observed.row?[observed.row]:[]),h=rowsGuard('stripe_part_lifecycle_events','e.part_id=? AND e.organization_id=?',[loaded.context.op.part_id,actor.organization_id],observed.events);statements.push(db.prepare('SELECT 1 AS valid WHERE '+g.sql+' AND '+e.sql+' AND '+p.sql+' AND '+h.sql).bind(...g.args,...e.args,...p.args,...h.args));}return statements;
}
async function finalRead(db,actor,records,portal,selection){
 const initial=portal?db.prepare("SELECT 1 AS valid FROM actors WHERE id=? AND organization_id=? AND role='client' AND active=1 AND client_id=?").bind(actor.id,actor.organization_id,actor.client_id):db.prepare('SELECT 1 AS valid WHERE '+finance).bind(actor.id,actor.organization_id);
 const statements=[initial,...readProofs(db,actor,records,portal)];
 if(selection)statements.push(selection.statement());const results=await db.batch(statements);if(!results[0].results.length)throw 403;if(results.slice(1,records.length+1).some(r=>!r.results.length)){await currentReader(db,actor,portal);throw 409;}if(selection&&json(results.at(-1).results)!==json(selection.rows))throw 409;
}
function query(url,keys){const seen=new Set();for(const key of url.searchParams.keys()){if(!keys.includes(key)||seen.has(key))throw 400;seen.add(key);}}
function selection(db,actor,portal,{partId=null,invoiceId=null,limit=25,cursor=null,status=null,currency=null,dashboard=null}={}){const auth=authority(actor,portal),filters=["u.organization_id=?","u.state='DONE'","u.stage='DONE'",auth.sql],args=[actor.organization_id,...auth.args];if(partId){filters.push('u.part_id=?');args.push(partId);}if(invoiceId){filters.push('u.invoice_id=?');args.push(invoiceId);}if(cursor){filters.push('u.part_id>?');args.push(cursor);}if(currency){filters.push("json_extract(c.plan_json,'$.currency')=?");args.push(currency);}if(status){filters.push("json_extract(p.snapshot_json,'$.status')=?");args.push(status);}if(dashboard){filters.push("p.snapshot_json IS NOT NULL AND json_extract(p.snapshot_json,'$.remainingMinor')>0 AND json_extract(p.snapshot_json,'$.finalizedAt') IS NOT NULL AND i.status='DRAFT' AND i.provider_state='NOT_CONNECTED' AND i.stripe_invoice_id IS NULL AND i.paid_minor=0 AND i.released_at IS NULL");for(const [key,column]of [['clientId','i.client_id'],['projectId','i.project_id']])if(dashboard[key]){filters.push(column+'=?');args.push(dashboard[key]);}if(dashboard.due==='overdue'){filters.push("json_extract(p.snapshot_json,'$.dueAt') IS NOT NULL AND json_extract(p.snapshot_json,'$.dueAt')*1000<?");args.push(dashboard.now);}}const sql=`SELECT u.part_id,u.invoice_id FROM stripe_part_issuance_operations u JOIN stripe_part_operations c ON c.id=u.creation_operation_id AND c.organization_id=u.organization_id JOIN invoice_drafts i ON i.id=u.invoice_id AND i.organization_id=u.organization_id LEFT JOIN stripe_part_projection p ON p.part_id=u.part_id AND p.organization_id=u.organization_id WHERE ${filters.join(' AND ')} ORDER BY u.part_id LIMIT ?`;return {statement:()=>db.prepare(sql).bind(...args,limit),rows:null};}
export function partDashboardSelection(db,actor,filters,now){return selection(db,actor,actor.role==='client',{status:'open',currency:filters.currency,limit:1001,dashboard:{...filters,now}});}
export async function partDashboardSnapshot(env,actor,selected){
 const db=env.DB,portal=actor.role==='client',chosen=selected.rows,records=[];
 let snapshot;try{snapshot=chosen.length?await preload(db,actor.organization_id,chosen):null;}catch(error){if(error!==409)throw error;throw {code:'DASHBOARD_INVOICE_READ_LIMIT',status:409};}
 for(const row of chosen)records.push(await readOne(db,actor,row.invoice_id,row.part_id,portal,snapshot));
 const values=records.map(({value,loaded})=>({...value,project:JSON.parse(loaded.context.op.plan_json).project??null})),proofs=readProofs(db,actor,records,portal).map(statement=>({statement,rows:[{valid:1}]}));
 return {values,proofs};
}

function addMoney(group,key,value){if(group[key]===null||value===null){group[key]=null;return;}if(key==='startingBalanceMinor'?!Number.isSafeInteger(value):!money(value))throw 503;const sum=BigInt(group[key]??0)+BigInt(value);if(sum>BigInt(Number.MAX_SAFE_INTEGER)||sum< -BigInt(Number.MAX_SAFE_INTEGER))throw 409;group[key]=Number(sum);}
export async function stripePartLifecycleRoute(request,env,actor,readBody,respond,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname,portal=path.startsWith('/api/portal/invoice-parts');await currentReader(env.DB,actor,portal);
 const summary=path==='/api/billing/parts/summary'||path==='/api/portal/invoice-parts/summary',detail=summary?null:portal?path.match(/^\/api\/portal\/invoice-parts\/([a-zA-Z0-9-]{1,100})$/):path.match(/^\/api\/invoices\/([a-zA-Z0-9-]{1,100})\/parts\/([a-zA-Z0-9-]{1,100})\/billing(\/reconcile)?$/);
 if(!summary&&!detail&&!['/api/billing/parts','/api/portal/invoice-parts'].includes(path))throw 404;
 if(detail){query(url,[]);const partId=portal?detail[1]:detail[2],selected=selection(env.DB,actor,portal,{partId,invoiceId:portal?null:detail[1],limit:1});selected.rows=(await selected.statement().all()).results;if(!selected.rows.length)throw 404;
  if(!portal&&detail[3]){if(request.method!=='POST')throw 405;const body=await readBody(request);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw 400;const c=config(env);if(c.org!==actor.organization_id)throw 404;const loaded=await context(env.DB,c.org,selected.rows[0].invoice_id,partId);try{await observe(env,fetcher,loaded,{actor,source:'STAFF'});}catch(e){if(e.status)throw e.status;if(e.code)throw e.code==='PROVIDER_UNAVAILABLE'?503:409;throw e;}}
  else if(request.method!=='GET')throw 405;
  const record=await readOne(env.DB,actor,selected.rows[0].invoice_id,partId,portal);await finalRead(env.DB,actor,[record],portal,selected);return respond(record.value);
 }
 if(request.method!=='GET')throw 405;query(url,summary?[]:['limit','cursor','status','currency']);const raw=url.searchParams.get('limit')??'25',cursor=url.searchParams.get('cursor'),status=url.searchParams.get('status'),currency=url.searchParams.get('currency');if(!/^[1-9]\d?$/.test(raw)||Number(raw)>50||cursor!==null&&!id(cursor)||status!==null&&!['open','paid','void','uncollectible'].includes(status)||currency!==null&&!['CAD','USD','EUR','GBP'].includes(currency))throw 400;
 const limit=summary?1000:Number(raw),selected=selection(env.DB,actor,portal,{limit:limit+1,cursor,status,currency});selected.rows=(await selected.statement().all()).results;if(summary&&selected.rows.length>1000)throw 409;
 const chosen=selected.rows.slice(0,limit),records=[],snapshot=chosen.length?await preload(env.DB,actor.organization_id,chosen):null;for(const row of chosen)records.push(await readOne(env.DB,actor,row.invoice_id,row.part_id,portal,snapshot));await finalRead(env.DB,actor,records,portal,selected);
 if(!summary)return respond({items:records.map(r=>r.value),nextCursor:selected.rows.length>limit?chosen.at(-1).part_id:null});
 const currencies={};for(const {value} of records){const group=currencies[value.currency]??={partCount:0,statusCounts:{},unobservedCount:0,overdueCount:0};group.partCount++;if(value.status===null)group.unobservedCount++;else group.statusCounts[value.status]=(group.statusCounts[value.status]??0)+1;if(value.overdue)group.overdueCount++;for(const key of ['totalMinor',...unknownMoney])addMoney(group,key,value[key]);}return respond({currencies});
}
