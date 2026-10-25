export const timeColumns='id,organization_id,project_id,actor_id,started_at,ended_at,seconds';
const columns=alias=>timeColumns.split(',').map(c=>alias+'.'+c).join(',');
const fields=['source_kind','description','worked_on','billable','review_status','reviewed_by','reviewed_at','rejection_reason','revision','created_at'];
const money=['currency','rate_minor','rate_reference','invoice_ref'];
const viewer=`WITH viewer AS (SELECT a.id,EXISTS(SELECT 1 FROM actor_finance_access f WHERE f.id=a.id AND f.organization_id=a.organization_id) AS finance
 FROM actors a WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='staff')`;
const metadata=alias=>fields.map(c=>alias+'.'+c).join(',');
const financial=alias=>money.map(c=>`CASE WHEN v.finance THEN ${alias}.${c} ELSE NULL END AS ${c}`).join(',');
const readColumns=`${columns('t')},p.name AS project_name,u.email AS actor_email,${metadata('d')},${financial('d')},d.invoice_ref IS NOT NULL AS invoiced,v.finance AS viewer_finance`;
const readFrom=`FROM time_details d JOIN time_entries t ON t.id=d.id AND t.organization_id=d.organization_id
 JOIN projects p ON p.id=t.project_id AND p.organization_id=t.organization_id JOIN actors u ON u.id=t.actor_id AND u.organization_id=t.organization_id CROSS JOIN viewer v`;
const visible='d.organization_id=? AND (d.actor_id=v.id OR v.finance)';
const idPattern=/^[a-zA-Z0-9-]{1,100}$/;
const currencies=new Set(['CAD','USD','EUR','GBP']);
export function validWorkedOn(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T12:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;}
export function todayWorkedOn(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Date.now())).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;}
export async function hasFinance(db,actor){if(actor.role!=='staff')return false;return Boolean((await db.prepare(viewer+' SELECT finance FROM viewer').bind(actor.id,actor.organization_id).first())?.finance);}
export function publicTime(row){if(!row)return row;const result={...row};delete result.viewer_finance;if(!row.viewer_finance)for(const key of money)delete result[key];if('invoiced'in result)result.invoiced=Boolean(result.invoiced);return result;}
async function readDetail(db,actor,id){return db.prepare(`${viewer} SELECT ${readColumns} ${readFrom} WHERE ${visible} AND d.id=?`).bind(actor.id,actor.organization_id,actor.organization_id,id).first();}
function audit(db,actor,token,action){return db.prepare(`INSERT INTO time_detail_events(id,time_id,organization_id,project_id,owner_actor_id,actor_id,recorded_at,action,${fields.join(',')},${money.join(',')},started_at,ended_at,seconds)
 SELECT d.audit_token,d.id,d.organization_id,d.project_id,d.actor_id,?,?,?,${metadata('d')},${money.map(c=>'d.'+c).join(',')},t.started_at,t.ended_at,t.seconds
 FROM time_details d JOIN time_entries t ON t.id=d.id AND t.organization_id=d.organization_id WHERE d.audit_token=? AND d.organization_id=? RETURNING id`)
 .bind(actor.id,Date.now(),action,token,actor.organization_id);}

// Only the base-row writer's random token can create/update metadata and capture its event.
export async function commitTimeWrite(db,actor,statement,token,{sourceKind,description='',workedOn,billable=true}={}){
 const create=sourceKind!==undefined;
 const detail=create?db.prepare(`INSERT INTO time_details(id,organization_id,project_id,actor_id,source_kind,description,worked_on,billable,created_at,audit_token)
 SELECT id,organization_id,project_id,actor_id,?,?,?,?,?,? FROM time_entries WHERE write_token=? AND organization_id=? AND actor_id=? RETURNING id`)
 .bind(sourceKind,description,workedOn??todayWorkedOn(),Number(billable),Date.now(),token,token,actor.organization_id,actor.id)
 :db.prepare(`INSERT INTO time_details(id,organization_id,project_id,actor_id,audit_token)
 SELECT id,organization_id,project_id,actor_id,? FROM time_entries WHERE write_token=? AND organization_id=? AND actor_id=?
 ON CONFLICT(id) DO UPDATE SET revision=time_details.revision+1,audit_token=excluded.audit_token
 WHERE time_details.review_status!='APPROVED' AND time_details.invoice_ref IS NULL RETURNING id`)
 .bind(token,token,actor.organization_id,actor.id);
 const results=await db.batch([statement,detail,audit(db,actor,token,create?'CREATE':'STOP')]);
 const row=results[0].results[0];if(row&&(!results[1].results.length||!results[2].results.length))throw 503;return row||null;
}

export function timeExportStatement(db,actor,table){
 const events=table==='time_detail_events',identity=events?'id,time_id,organization_id,project_id,owner_actor_id,actor_id,recorded_at,action,started_at,ended_at,seconds':'id,organization_id,project_id,actor_id';
 return db.prepare(`${viewer} SELECT ${identity.split(',').map(c=>'d.'+c).join(',')},${metadata('d')},${financial('d')},v.finance AS viewer_finance
 FROM ${table} d CROSS JOIN viewer v WHERE d.organization_id=? AND (d.${events?'owner_actor_id':'actor_id'}=v.id OR v.finance) ORDER BY d.id LIMIT 1001`)
 .bind(actor.id,actor.organization_id,actor.organization_id);
}
function query(url,allowed){const seen=new Set();for(const key of url.searchParams.keys()){if(!allowed.includes(key)||seen.has(key))throw 400;seen.add(key);}}
function revision(input){if(!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER)throw 400;}
function text(value,max,empty=true){return typeof value==='string'&&value.length<=max&&!value.includes('\0')&&(empty||value.trim().length>0);}
function rates(input){
 if(!('currency'in input)&&!('rateMinor'in input)&&!('rateReference'in input))return null;
 if(!('currency'in input)||!('rateMinor'in input))throw 400;
 const currency=typeof input.currency==='string'?input.currency.trim().toUpperCase():input.currency,rate=input.rateMinor,reference=input.rateReference??null;
 if(currency===null&&rate===null){if(reference!==null)throw 400;return {currency:null,rate_minor:null,rate_reference:null};}
 if(!currencies.has(currency)||!Number.isSafeInteger(rate)||rate<0||(reference!==null&&!text(reference,200,false)))throw 400;
 return {currency,rate_minor:rate,rate_reference:reference};
}
async function list(request,db,actor,json){
 const url=new URL(request.url);query(url,['after','scope','actorId','projectId','reviewStatus','billable','invoiced','currency','from','to']);const p=url.searchParams,scope=p.get('scope')||'own';if(!['own','team'].includes(scope))throw 400;
 if(scope==='team'&&!await hasFinance(db,actor))throw 403;if(scope==='own'&&p.has('actorId'))throw 400;
 const clauses=[visible],values=[actor.id,actor.organization_id,actor.organization_id];
 if(scope==='own'){clauses.push('d.actor_id=?');values.push(actor.id);}else clauses.push('v.finance=1');
 for(const [key,column,table] of [['projectId','d.project_id','projects'],['actorId','d.actor_id','actors']])if(p.has(key)){const id=p.get(key);if(!idPattern.test(id))throw 400;if(!await db.prepare(`SELECT id FROM ${table} WHERE id=? AND organization_id=?`).bind(id,actor.organization_id).first())throw 404;clauses.push(column+'=?');values.push(id);}
 if(p.has('reviewStatus')){const value=p.get('reviewStatus');if(!['PENDING','APPROVED','REJECTED'].includes(value))throw 400;clauses.push('d.review_status=?');values.push(value);}
 if(p.has('billable')){const value=p.get('billable');if(!['true','false','unknown'].includes(value))throw 400;if(value==='unknown')clauses.push('d.billable IS NULL');else{clauses.push('d.billable=?');values.push(Number(value==='true'));}}
 if(p.has('invoiced')){const value=p.get('invoiced');if(!['true','false'].includes(value))throw 400;clauses.push('d.invoice_ref IS '+(value==='true'?'NOT NULL':'NULL'));}
 if(p.has('currency')){const value=p.get('currency').trim().toUpperCase();if(!currencies.has(value))throw 400;if(!await hasFinance(db,actor))throw 403;clauses.push('v.finance=1','d.currency=?');values.push(value);}
 for(const [key,operator] of [['from','>='],['to','<=']])if(p.has(key)){if(!validWorkedOn(p.get(key)))throw 400;clauses.push('d.worked_on'+operator+'?');values.push(p.get(key));}if(p.has('from')&&p.has('to')&&p.get('from')>p.get('to'))throw 400;
 if(p.has('after')){const value=p.get('after');if(!idPattern.test(value))throw 400;clauses.push('d.id>?');values.push(value);}
 const rows=(await db.prepare(`${viewer} SELECT ${readColumns} ${readFrom} WHERE ${clauses.join(' AND ')} ORDER BY d.id LIMIT 51`).bind(...values).all()).results;
 if((scope==='team'||p.has('currency'))&&!await hasFinance(db,actor))throw 403;const items=rows.slice(0,50).map(publicTime);return json({items,nextCursor:rows.length>50?items.at(-1).id:null});
}
export async function timeDetailsRoute(request,db,actor,id,action,readBody,json){
 if(actor.role!=='staff')throw 403;
 if(!id){if(request.method!=='GET')throw 405;return list(request,db,actor,json);}
 const url=new URL(request.url);query(url,action==='history'?['before']:[]);
 if(action==='history'){
  if(request.method!=='GET')throw 405;if(!await readDetail(db,actor,id))throw 404;
  const before=url.searchParams.get('before');if(before!==null&&(!/^\d{1,16}$/.test(before)||!Number.isSafeInteger(Number(before))))throw 400;
  const rows=(await db.prepare(`${viewer} SELECT d.id,d.time_id,d.organization_id,d.project_id,d.owner_actor_id,d.actor_id,d.recorded_at,d.action,d.started_at,d.ended_at,d.seconds,${metadata('d')},${financial('d')},v.finance AS viewer_finance
   FROM time_detail_events d CROSS JOIN viewer v WHERE d.organization_id=? AND d.time_id=? AND (d.owner_actor_id=v.id OR v.finance) ${before!==null?'AND d.revision<?':''} ORDER BY d.revision DESC LIMIT 51`)
   .bind(actor.id,actor.organization_id,actor.organization_id,id,...(before!==null?[Number(before)]:[])).all()).results;
  const items=rows.slice(0,50).map(publicTime);return json({items,nextCursor:rows.length>50?String(items.at(-1).revision):null});
 }
 if(!action&&request.method==='GET'){const row=await readDetail(db,actor,id);if(!row)throw 404;return json(publicTime(row));}
 if(request.method!==(action?'POST':'PATCH'))throw 405;
 const finance=await hasFinance(db,actor);if(action&&!finance)throw 403;
 const input=await readBody(request);revision(input);
 const allowed=action==='approve'?['revision','currency','rateMinor','rateReference']:action==='reject'?['revision','reason']:['revision','description','workedOn','seconds','billable','currency','rateMinor','rateReference'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw 400;
 const pricing=action==='reject'?null:rates(input);if(pricing&&!finance)throw 403;
 const before=await readDetail(db,actor,id);if(!before)throw 404;if(before.invoiced||before.revision!==input.revision)throw 409;
 const changes={};let privileged=Boolean(action||pricing);
 if(!action){
  if(before.review_status==='APPROVED')throw 409;if(Object.keys(input).length===1)throw 400;
  if('description'in input){if(!text(input.description,2000))throw 400;changes.description=input.description;}
  if('workedOn'in input){if(!validWorkedOn(input.workedOn))throw 400;changes.worked_on=input.workedOn;}
  if('seconds'in input){if(!Number.isSafeInteger(input.seconds)||input.seconds<1||input.seconds>86400)throw 400;if(before.ended_at===null)throw 409;}
  if('billable'in input){if(typeof input.billable!=='boolean')throw 400;changes.billable=Number(input.billable);}
  Object.assign(changes,pricing||{},{review_status:'PENDING',reviewed_by:null,reviewed_at:null,rejection_reason:null});
 }else if(action==='approve'){
  if(before.review_status==='APPROVED'||!Number.isSafeInteger(before.ended_at)||!Number.isSafeInteger(before.started_at)||!Number.isSafeInteger(before.seconds)||before.seconds<0||!validWorkedOn(before.worked_on)||before.billable===null||(before.billable&&before.seconds<=0))throw 409;
  const effective=pricing||before;if(before.billable&&(effective.currency==null||effective.rate_minor==null))throw 409;
  Object.assign(changes,pricing||{},{review_status:'APPROVED',reviewed_by:actor.id,reviewed_at:Date.now(),rejection_reason:null});
 }else{
  if(!text(input.reason,2000,false))throw 400;Object.assign(changes,{review_status:'REJECTED',reviewed_by:actor.id,reviewed_at:Date.now(),rejection_reason:input.reason.trim()});
 }
 const token=crypto.randomUUID(),entries=Object.entries(changes),duration='seconds'in input,guard=action==='approve'?"review_status!='APPROVED' AND EXISTS(SELECT 1 FROM time_entries t WHERE t.id=time_details.id AND t.organization_id=time_details.organization_id AND t.ended_at IS NOT NULL AND (time_details.billable=0 OR t.seconds>0))":!action?"review_status!='APPROVED'":'1';
 const statement=db.prepare(`${viewer} UPDATE time_details SET ${entries.map(([k])=>k+'=?').join(',')},revision=revision+1,audit_token=?
 WHERE organization_id=? AND id=? AND revision=? AND invoice_ref IS NULL AND ${guard} ${duration?'AND EXISTS(SELECT 1 FROM time_entries t WHERE t.id=time_details.id AND t.write_token=?)':''}
 AND EXISTS(SELECT 1 FROM viewer v WHERE (time_details.actor_id=v.id OR v.finance) ${privileged?'AND v.finance=1':''}) RETURNING id`)
 .bind(actor.id,actor.organization_id,...entries.map(([,v])=>v),token,actor.organization_id,id,input.revision,...(duration?[token]:[]));
 const writes=[];if(duration)writes.push(db.prepare(`${viewer} UPDATE time_entries SET seconds=?,write_token=? WHERE id=? AND organization_id=? AND ended_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM time_details d CROSS JOIN viewer v WHERE d.id=time_entries.id AND d.organization_id=time_entries.organization_id AND d.revision=? AND d.review_status!='APPROVED' AND d.invoice_ref IS NULL AND (d.actor_id=v.id OR v.finance) ${privileged?'AND v.finance=1':''}) RETURNING id`)
 .bind(actor.id,actor.organization_id,input.seconds,token,id,actor.organization_id,input.revision));
 writes.push(statement,audit(db,actor,token,action?action.toUpperCase():'EDIT'));const results=await db.batch(writes),offset=duration?1:0;
 if(!results[offset].results.length){if(privileged&&!await hasFinance(db,actor))throw 403;throw 409;}
 if(!results[offset+1].results.length)throw 503;const updated=await readDetail(db,actor,id);if(!updated)throw 404;return json(publicTime(updated));
}
