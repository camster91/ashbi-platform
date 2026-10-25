import {hasFinance,validWorkedOn,timeBillingAudit} from './time-details.mjs';

const max=Number.MAX_SAFE_INTEGER,currencies=new Set(['CAD','USD','EUR','GBP']);
const viewer=`WITH invoice_viewer AS (SELECT a.id FROM actors a JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='staff')`;
const authority='EXISTS(SELECT 1 FROM invoice_viewer)';
const invoiceFields='id,organization_id,client_id,project_id,created_by,title,currency,origin,status,subtotal_minor,tax_minor,total_minor,snapshot_json,preview_fingerprint,created_at,revision,provider_state,stripe_invoice_id,paid_minor,voided_at,void_reason,released_at';
const sourceSelect=`d.id,d.revision,d.project_id,p.name AS project_name,p.revision AS project_revision,d.actor_id,u.email AS actor_email,t.seconds,t.started_at,t.ended_at,d.description,d.worked_on,d.source_kind,d.billable,d.review_status,d.reviewed_by,d.reviewed_at,d.currency,d.rate_minor,d.rate_reference,d.invoice_ref`;
const sourceFrom=`FROM time_details d JOIN time_entries t ON t.id=d.id AND t.organization_id=d.organization_id JOIN projects p ON p.id=d.project_id AND p.organization_id=d.organization_id JOIN actors u ON u.id=d.actor_id AND u.organization_id=d.organization_id`;
const available=`d.review_status='APPROVED' AND d.billable=1 AND d.invoice_ref IS NULL AND typeof(t.seconds)='integer' AND t.seconds>0 AND t.seconds<=9007199254740991 AND typeof(t.started_at)='integer' AND typeof(t.ended_at)='integer' AND t.ended_at>=t.started_at AND d.currency=? AND typeof(d.rate_minor)='integer' AND d.rate_minor>=0 AND date(d.worked_on)=d.worked_on`;
const sourceKeys={id:'id',revision:'revision',project_id:'projectId',project_name:'projectName',project_revision:'projectRevision',actor_id:'actorId',actor_email:'actorEmail',seconds:'seconds',started_at:'startedAt',ended_at:'endedAt',description:'description',worked_on:'workedOn',source_kind:'sourceKind',billable:'billable',review_status:'reviewStatus',reviewed_by:'reviewedBy',reviewed_at:'reviewedAt',currency:'currency',rate_minor:'rateMinor',rate_reference:'rateReference'};
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(value);
const text=(value,limit)=>typeof value==='string'&&value.trim().length>0&&value.length<=limit&&!value.includes('\0');
const integer=(value,min=0,limit=max)=>Number.isSafeInteger(value)&&value>=min&&value<=limit;
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function strict(object,keys){if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).some(key=>!keys.includes(key)))throw 400;}
function query(url,allowed){const seen=new Set();for(const key of url.searchParams.keys()){if(!allowed.includes(key)||seen.has(key))throw 400;seen.add(key);}}
function safe(big){if(big<0n||big>BigInt(max))throw 400;return Number(big);}
function rounded(numerator,denominator){return safe((numerator*2n+denominator)/(2n*denominator));}
function observedRevision(value){if(!integer(value,0,max-1))throw 400;}

function intent(body){
 strict(body,['clientId','projectId','title','currency','tax','dueOn','times','charges','deposit']);
 if(!id(body.clientId)||('projectId'in body&&!id(body.projectId))||!text(body.title,200)||typeof body.currency!=='string'||!currencies.has(body.currency.trim().toUpperCase())||!validWorkedOn(body.dueOn))throw 400;
 strict(body.tax,['type','rateBps']);if(!['NONE','HST','GST','PST','TAX'].includes(body.tax.type)||!integer(body.tax.rateBps,0,5000)||(body.tax.type==='NONE'&&body.tax.rateBps!==0))throw 400;
 const times=body.times??[],charges=body.charges??[];if(!Array.isArray(times)||times.length>50||!Array.isArray(charges)||charges.length>50||!times.length&&!charges.length)throw 400;
 for(const row of times){strict(row,['id','revision']);if(!id(row.id))throw 400;observedRevision(row.revision);}if(new Set(times.map(row=>row.id)).size!==times.length)throw 400;
 for(const row of charges){strict(row,['description','quantity','unitMinor']);if(!text(row.description,500)||!integer(row.quantity,1,1000000)||!integer(row.unitMinor))throw 400;}
 if('deposit'in body){strict(body.deposit,['amountMinor','dueOn']);if(!integer(body.deposit.amountMinor,1)||!validWorkedOn(body.deposit.dueOn)||body.deposit.dueOn>=body.dueOn)throw 400;}
 return {clientId:body.clientId,...(body.projectId?{projectId:body.projectId}:{}),title:body.title.trim(),currency:body.currency.trim().toUpperCase(),tax:{type:body.tax.type,rateBps:body.tax.rateBps},dueOn:body.dueOn,times:times.map(row=>({id:row.id,revision:row.revision})).sort((a,b)=>a.id.localeCompare(b.id,'en')),charges:charges.map(row=>({description:row.description,quantity:row.quantity,unitMinor:row.unitMinor})),...(body.deposit?{deposit:{amountMinor:body.deposit.amountMinor,dueOn:body.deposit.dueOn}}:{})};
}
async function targets(db,actor,clientId,projectId){
 const client=await db.prepare('SELECT id,name,revision FROM clients WHERE id=? AND organization_id=?').bind(clientId,actor.organization_id).first();if(!client)throw 404;
 const project=projectId?await db.prepare('SELECT id,name,revision FROM projects WHERE id=? AND organization_id=? AND client_id=?').bind(projectId,actor.organization_id,clientId).first():null;if(projectId&&!project)throw 404;return {client,project};
}
function source(row){return Object.fromEntries(Object.entries(sourceKeys).map(([column,key])=>[key,row[column]]));}
function eligible(row,currency){return row.review_status==='APPROVED'&&row.billable===1&&row.invoice_ref===null&&row.currency===currency&&integer(row.rate_minor)&&integer(row.seconds,1)&&integer(row.started_at)&&integer(row.ended_at)&&row.ended_at>=row.started_at&&validWorkedOn(row.worked_on);}
async function selected(db,actor,input){
 if(!input.times.length)return [];
 const rows=(await db.prepare(`${viewer} SELECT ${sourceSelect} ${sourceFrom} WHERE ${authority} AND d.organization_id=? AND d.id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND p.client_id=? ${input.projectId?'AND d.project_id=?':''}`)
 .bind(actor.id,actor.organization_id,actor.organization_id,JSON.stringify(input.times),input.clientId,...(input.projectId?[input.projectId]:[])).all()).results,map=new Map(rows.map(row=>[row.id,row]));
 return input.times.map(observed=>{const row=map.get(observed.id);if(!row||row.revision!==observed.revision||!eligible(row,input.currency))throw 409;return source(row);});
}
async function preview(db,actor,input){
 const scope=await targets(db,actor,input.clientId,input.projectId),times=await selected(db,actor,input);
 const lines=[...times.map(row=>({kind:'TIME',description:(row.description||'Approved time').slice(0,500),totalMinor:rounded(BigInt(row.seconds)*BigInt(row.rateMinor),3600n),source:row})),...input.charges.map(row=>({kind:'FIXED',...row,totalMinor:safe(BigInt(row.quantity)*BigInt(row.unitMinor))}))];
 const subtotalMinor=safe(lines.reduce((sum,line)=>sum+BigInt(line.totalMinor),0n)),taxMinor=rounded(BigInt(subtotalMinor)*BigInt(input.tax.rateBps),10000n),totalMinor=safe(BigInt(subtotalMinor)+BigInt(taxMinor));if(totalMinor===0||input.deposit&&input.deposit.amountMinor>=totalMinor)throw 400;
 const installments=input.deposit?[{kind:'DEPOSIT',amountMinor:input.deposit.amountMinor,dueOn:input.deposit.dueOn},{kind:'BALANCE',amountMinor:totalMinor-input.deposit.amountMinor,dueOn:input.dueOn}]:[{kind:'FULL',amountMinor:totalMinor,dueOn:input.dueOn}];
 const result={version:1,...scope,clientId:input.clientId,projectId:input.projectId??null,title:input.title,currency:input.currency,tax:input.tax,dueOn:input.dueOn,lines,subtotalMinor,taxMinor,totalMinor,installments,providerState:'NOT_CONNECTED',sendsMessage:false,chargesPayment:false};
 result.fingerprint=await sha(result);if(JSON.stringify(result).length>262144)throw 400;if(!await hasFinance(db,actor))throw 403;return result;
}
function publicInvoice(row){if(!row)return row;const result={...row,snapshot:JSON.parse(row.snapshot_json)};for(const key of ['snapshot_json','request_key','request_fingerprint','write_token'])delete result[key];return result;}
async function readInvoice(db,actor,invoiceId){return db.prepare(`${viewer} SELECT ${invoiceFields} FROM invoice_drafts WHERE organization_id=? AND id=? AND ${authority}`).bind(actor.id,actor.organization_id,actor.organization_id,invoiceId).first();}
async function readRequest(db,actor,key,fingerprint){const row=await db.prepare(`${viewer} SELECT ${invoiceFields},request_fingerprint FROM invoice_drafts WHERE organization_id=? AND request_key=? AND ${authority}`).bind(actor.id,actor.organization_id,actor.organization_id,key).first();if(row&&row.request_fingerprint!==fingerprint)throw 409;return row;}

// Match the exact reviewed source image, not only its public revision counter.
const sourceColumn={id:'d.id',revision:'d.revision',projectId:'d.project_id',projectName:'p.name',projectRevision:'p.revision',actorId:'d.actor_id',actorEmail:'u.email',seconds:'t.seconds',startedAt:'t.started_at',endedAt:'t.ended_at',description:'d.description',workedOn:'d.worked_on',sourceKind:'d.source_kind',billable:'d.billable',reviewStatus:'d.review_status',reviewedBy:'d.reviewed_by',reviewedAt:'d.reviewed_at',currency:'d.currency',rateMinor:'d.rate_minor',rateReference:'d.rate_reference'};
function matches(ref){return Object.entries(sourceColumn).map(([key,column])=>`${column} IS json_extract(${ref},'$.${key}')`).join(' AND ');}
function selectionGuard(claimed=false){return `(SELECT COUNT(*) ${sourceFrom} JOIN json_each(?) selected ON d.id=json_extract(selected.value,'$.id') WHERE d.organization_id=? AND p.client_id=? AND ${matches('selected.value')} AND d.invoice_ref ${claimed?'=?':'IS NULL'})=?`;}
function selectionValues(rows,actor,clientId,invoiceId){return [JSON.stringify(rows),actor.organization_id,clientId,...(invoiceId?['workspace:'+invoiceId]:[]),rows.length];}
function safeExternal(){return `provider_state='NOT_CONNECTED' AND stripe_invoice_id IS NULL AND paid_minor=0`;}
// A successful no-op journal is also a failure: make the database roll back the batch.
function commitFence(db,actor,invoiceId,token){return db.prepare(`UPDATE invoice_drafts SET write_token=CASE WHEN EXISTS(SELECT 1 FROM invoice_events e WHERE e.id=? AND e.invoice_id=invoice_drafts.id AND e.organization_id=invoice_drafts.organization_id) THEN write_token ELSE NULL END WHERE id=? AND organization_id=? AND write_token=? RETURNING id`).bind(token,invoiceId,actor.organization_id,token);}
function invoiceAudit(db,actor,invoiceId,token,prefix,action,count){
 const active=action==='RELEASE'?`d.audit_token=?||d.id AND d.invoice_ref IS NULL`:`d.invoice_ref='workspace:'||i.id`;
 const expectedHistory=action==='VOID'?0:count;
 return db.prepare(`INSERT INTO invoice_events(id,invoice_id,organization_id,actor_id,recorded_at,revision,action,state_json,expected_count,actual_count,expected_history_count,actual_history_count)
 SELECT ?,i.id,i.organization_id,?,?,i.revision,?,json_object('status',i.status,'revision',i.revision,'voidedAt',i.voided_at,'voidReason',i.void_reason,'releasedAt',i.released_at,'providerState',i.provider_state,'stripeInvoiceId',i.stripe_invoice_id,'paidMinor',i.paid_minor,'snapshot',json(i.snapshot_json)),?,(SELECT COUNT(*) FROM time_details d WHERE d.organization_id=i.organization_id AND ${active}),?,(SELECT COUNT(*) FROM time_billing_events b WHERE b.organization_id=i.organization_id AND b.invoice_id=i.id AND b.id=?||b.time_id)
 FROM invoice_drafts i WHERE i.id=? AND i.organization_id=? AND i.write_token=? RETURNING id`)
 .bind(token,actor.id,Date.now(),action,count,...(action==='RELEASE'?[prefix]:[]),expectedHistory,prefix,invoiceId,actor.organization_id,token);
}
async function create(db,actor,body){
 strict(body,['clientId','projectId','title','currency','tax','dueOn','times','charges','deposit','requestId','fingerprint']);const {requestId,fingerprint,...raw}=body;if(!uuid(requestId)||!hash(fingerprint))throw 400;const input=intent(raw),key=requestId.toLowerCase(),requestFingerprint=await sha({input,fingerprint});
 const previous=await readRequest(db,actor,key,requestFingerprint);if(previous)return {row:previous,status:200};
 try{
  const p=await preview(db,actor,input);if(p.fingerprint!==fingerprint)throw 409;const invoiceId=crypto.randomUUID(),token=crypto.randomUUID(),prefix=token+':',rows=p.lines.filter(line=>line.kind==='TIME').map(line=>line.source);
  const first=db.prepare(`${viewer} INSERT INTO invoice_drafts(id,organization_id,client_id,project_id,created_by,title,currency,subtotal_minor,tax_minor,total_minor,snapshot_json,request_key,request_fingerprint,preview_fingerprint,created_at,write_token)
   SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${authority}
   AND EXISTS(SELECT 1 FROM clients WHERE id=? AND organization_id=? AND name=? AND revision=?)
   ${p.project?'AND EXISTS(SELECT 1 FROM projects WHERE id=? AND organization_id=? AND client_id=? AND name=? AND revision=?)':''}
   AND ${selectionGuard()} RETURNING id`)
   .bind(actor.id,actor.organization_id,invoiceId,actor.organization_id,input.clientId,input.projectId??null,actor.id,input.title,input.currency,p.subtotalMinor,p.taxMinor,p.totalMinor,JSON.stringify(p),key,requestFingerprint,fingerprint,Date.now(),token,input.clientId,actor.organization_id,p.client.name,p.client.revision,...(p.project?[p.project.id,actor.organization_id,input.clientId,p.project.name,p.project.revision]:[]),...selectionValues(rows,actor,input.clientId));
  const claim=db.prepare(`UPDATE time_details SET invoice_ref=?,revision=revision+1,audit_token=?||id WHERE organization_id=? AND id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND invoice_ref IS NULL AND review_status='APPROVED' AND EXISTS(SELECT 1 FROM invoice_drafts WHERE id=? AND organization_id=? AND write_token=?) RETURNING id`)
   .bind('workspace:'+invoiceId,prefix,actor.organization_id,JSON.stringify(rows),invoiceId,actor.organization_id,token);
  const result=await db.batch([first,claim,timeBillingAudit(db,actor,prefix,invoiceId,'CLAIM'),invoiceAudit(db,actor,invoiceId,token,prefix,'CREATE',rows.length),commitFence(db,actor,invoiceId,token)]);
  if(!result[0].results.length){if(!await hasFinance(db,actor))throw 403;throw 409;}if(!result[3].results.length)throw 503;
  const row=await readInvoice(db,actor,invoiceId);if(!row)throw 403;return {row,status:201};
 }catch(error){if(!await hasFinance(db,actor))throw 403;const row=await readRequest(db,actor,key,requestFingerprint);if(row)return {row,status:200};throw error;}
}

async function releasePreview(db,actor,row){
 if(row.status!=='VOID'||row.released_at!==null||row.provider_state!=='NOT_CONNECTED'||row.stripe_invoice_id!==null||row.paid_minor!==0||Date.now()-row.voided_at<10000)throw 409;
 const snapshot=JSON.parse(row.snapshot_json),original=snapshot.lines.filter(line=>line.kind==='TIME').map(line=>line.source);
 const rows=(await db.prepare(`${viewer} SELECT ${sourceSelect} ${sourceFrom} WHERE ${authority} AND d.organization_id=? AND d.invoice_ref=? AND p.client_id=? ORDER BY d.id`).bind(actor.id,actor.organization_id,actor.organization_id,'workspace:'+row.id,row.client_id).all()).results;
 if(rows.length!==original.length)throw 409;const byId=new Map(rows.map(r=>[r.id,source(r)]));for(const expected of original){const actual=byId.get(expected.id);if(!actual||Object.keys(expected).filter(key=>!['projectName','projectRevision','actorEmail'].includes(key)).some(key=>actual[key] !== (key==='revision'?expected[key]+1:expected[key])))throw 409;}
 const result={version:1,invoiceId:row.id,revision:row.revision,voidedAt:row.voided_at,currency:row.currency,totalMinor:row.total_minor,originalFingerprint:row.preview_fingerprint,sources:rows.map(source),retainsOriginalHistory:true,reopensInvoice:false,sendsMessage:false,chargesPayment:false};result.fingerprint=await sha(result);if(!await hasFinance(db,actor))throw 403;return result;
}
async function change(db,actor,row,action,body){
 strict(body,action==='void'?['revision','reason']:['revision','fingerprint']);observedRevision(body.revision);if(row.revision!==body.revision)throw 409;
 const token=crypto.randomUUID(),prefix=token+':',snapshot=JSON.parse(row.snapshot_json),count=snapshot.lines.filter(line=>line.kind==='TIME').length;let first,writes=[];
 if(action==='void'){
  if(!text(body.reason,2000))throw 400;
  first=db.prepare(`${viewer} UPDATE invoice_drafts SET status='VOID',voided_at=?,void_reason=?,revision=revision+1,write_token=? WHERE id=? AND organization_id=? AND revision=? AND status='DRAFT' AND ${safeExternal()} AND ${authority} RETURNING id`)
   .bind(actor.id,actor.organization_id,Date.now(),body.reason.trim(),token,row.id,actor.organization_id,body.revision);
 }else{
  if(!hash(body.fingerprint))throw 400;const p=await releasePreview(db,actor,row);if(p.fingerprint!==body.fingerprint)throw 409;
  first=db.prepare(`${viewer} UPDATE invoice_drafts SET released_at=?,revision=revision+1,write_token=? WHERE id=? AND organization_id=? AND revision=? AND status='VOID' AND released_at IS NULL AND voided_at<=? AND ${safeExternal()} AND ${authority} AND ${selectionGuard(true)} AND (SELECT COUNT(*) FROM time_details WHERE organization_id=? AND invoice_ref=?)=? RETURNING id`)
   .bind(actor.id,actor.organization_id,Date.now(),token,row.id,actor.organization_id,body.revision,Date.now()-10000,...selectionValues(p.sources,actor,row.client_id,row.id),actor.organization_id,'workspace:'+row.id,count);
  writes=[db.prepare(`UPDATE time_details SET invoice_ref=NULL,revision=revision+1,audit_token=?||id WHERE organization_id=? AND invoice_ref=? AND EXISTS(SELECT 1 FROM invoice_drafts WHERE id=? AND organization_id=? AND write_token=?) RETURNING id`).bind(prefix,actor.organization_id,'workspace:'+row.id,row.id,actor.organization_id,token),timeBillingAudit(db,actor,prefix,row.id,'RELEASE')];
 }
 const result=await db.batch([first,...writes,invoiceAudit(db,actor,row.id,token,prefix,action==='void'?'VOID':'RELEASE',count),commitFence(db,actor,row.id,token)]);if(!result[0].results.length){if(!await hasFinance(db,actor))throw 403;throw 409;}if(!result.at(-1).results.length)throw 503;const updated=await readInvoice(db,actor,row.id);if(!updated)throw 403;return updated;
}

async function candidates(db,actor,url){
 query(url,['clientId','projectId','currency','after']);const p=url.searchParams,clientId=p.get('clientId'),projectId=p.get('projectId'),currency=p.get('currency')?.trim().toUpperCase(),after=p.get('after');if(!id(clientId)||projectId!==null&&!id(projectId)||!currencies.has(currency)||after!==null&&!id(after))throw 400;await targets(db,actor,clientId,projectId);
 const rows=(await db.prepare(`${viewer} SELECT ${sourceSelect} ${sourceFrom} WHERE ${authority} AND d.organization_id=? AND p.client_id=? AND ${available} ${projectId?'AND d.project_id=?':''} ${after?'AND d.id>?':''} ORDER BY d.id LIMIT 51`)
 .bind(actor.id,actor.organization_id,actor.organization_id,clientId,currency,...(projectId?[projectId]:[]),...(after?[after]:[])).all()).results;
 if(rows.some(row=>!eligible(row,currency)))throw 409;if(!await hasFinance(db,actor))throw 403;const items=rows.slice(0,50).map(row=>({id:row.id,...source(row)}));return {items,nextCursor:rows.length>50?items.at(-1).id:null};
}
async function list(db,actor,url){
 query(url,['clientId','projectId','currency','status','after']);const params=url.searchParams,conditions=['organization_id=?',authority],values=[actor.id,actor.organization_id,actor.organization_id];
 for(const [key,column] of [['clientId','client_id'],['projectId','project_id'],['currency','currency'],['status','status'],['after','id']])if(params.has(key)){let value=params.get(key);if(key==='currency'){value=value.trim().toUpperCase();if(!currencies.has(value))throw 400;}else if(key==='status'){if(!['DRAFT','VOID'].includes(value))throw 400;}else if(!id(value))throw 400;conditions.push(column+(key==='after'?'>':'=')+'?');values.push(value);}
 const summaryFields=invoiceFields.split(',').filter(field=>field!=='snapshot_json').join(',');
 const rows=(await db.prepare(`${viewer} SELECT ${summaryFields},json_extract(snapshot_json,'$.client.name') AS client_name,json_extract(snapshot_json,'$.project.name') AS project_name,json_extract(snapshot_json,'$.dueOn') AS due_on FROM invoice_drafts WHERE ${conditions.join(' AND ')} ORDER BY id LIMIT 51`).bind(...values).all()).results;
 if(!await hasFinance(db,actor))throw 403;const items=rows.slice(0,50);return {items,nextCursor:rows.length>50?items.at(-1).id:null};
}
export function invoiceExportStatement(db,actor,table){const columns=table==='invoice_drafts'?invoiceFields:'id,invoice_id,organization_id,actor_id,recorded_at,revision,action,state_json';return db.prepare(`${viewer} SELECT ${columns} FROM ${table} WHERE organization_id=? AND ${authority} ORDER BY id LIMIT 1001`).bind(actor.id,actor.organization_id,actor.organization_id);}
export async function invoicesRoute(request,db,actor,readBody,json){
 if(!await hasFinance(db,actor))throw 403;const url=new URL(request.url),path=url.pathname;
 if(path==='/api/invoices/candidates'){if(request.method!=='GET')throw 405;return json(await candidates(db,actor,url));}
 if(path==='/api/invoices/preview'){query(url,[]);if(request.method!=='POST')throw 405;return json(await preview(db,actor,intent(await readBody(request))));}
 if(path==='/api/invoices'){if(request.method==='GET')return json(await list(db,actor,url));query(url,[]);if(request.method!=='POST')throw 405;const result=await create(db,actor,await readBody(request));return json(publicInvoice(result.row),result.status);}
 const match=path.match(/^\/api\/invoices\/([a-zA-Z0-9-]{1,100})(?:\/(history|void|release-preview|release))?$/);if(!match)throw 404;const [,invoiceId,action]=match;query(url,action==='history'?['before']:[]);const row=await readInvoice(db,actor,invoiceId);if(!row)throw 404;
 if(!action){if(request.method!=='GET')throw 405;return json(publicInvoice(row));}
 if(action==='history'){
  if(request.method!=='GET')throw 405;const before=url.searchParams.get('before');if(before!==null&&(!/^\d{1,16}$/.test(before)||!integer(Number(before))))throw 400;
  const rows=(await db.prepare(`${viewer} SELECT id,invoice_id,organization_id,actor_id,recorded_at,revision,action,state_json FROM invoice_events WHERE organization_id=? AND invoice_id=? AND ${authority} ${before!==null?'AND revision<?':''} ORDER BY revision DESC LIMIT 51`).bind(actor.id,actor.organization_id,actor.organization_id,invoiceId,...(before!==null?[Number(before)]:[])).all()).results;const items=rows.slice(0,50).map(({state_json,...row})=>({...row,state:JSON.parse(state_json)}));if(!await hasFinance(db,actor))throw 403;return json({items,nextCursor:rows.length>50?String(items.at(-1).revision):null});
 }
 if(action==='release-preview'){if(request.method!=='GET')throw 405;return json(await releasePreview(db,actor,row));}
 if(request.method!=='POST')throw 405;return json(publicInvoice(await change(db,actor,row,action,await readBody(request))));
}
