import {hasFinance} from './time-details.mjs';

const kinds={proposals:'PROPOSAL',templates:'TEMPLATE',contracts:'CONTRACT'};
const viewer=`WITH commercial_viewer AS (SELECT a.id FROM actors a JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='staff')`;
const authority='EXISTS(SELECT 1 FROM commercial_viewer)';
const max=Number.MAX_SAFE_INTEGER;
const integer=(v,min=0,limit=max)=>Number.isSafeInteger(v)&&v>=min&&v<=limit;
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const text=(v,limit,empty=false)=>typeof v==='string'&&(empty||v.trim().length>0)&&v.length<=limit&&!v.includes('\0');
function strict(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw 400;}
function query(url,keys){const seen=new Set();for(const key of url.searchParams.keys()){if(!keys.includes(key)||seen.has(key))throw 400;seen.add(key);}}
function safe(v){if(v<0n||v>BigInt(max))throw 400;return Number(v);}
async function hash(v){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)))),b=>b.toString(16).padStart(2,'0')).join('');}
function reference(v){strict(v,['id','revision']);if(!id(v.id)||!integer(v.revision,0,max-1))throw 400;return {id:v.id,revision:v.revision};}

function content(kind,value){
 if(kind!=='PROPOSAL'){
  strict(value,['text']);if(!text(value.text,20000))throw 400;return {text:value.text};
 }
 strict(value,['scope','schedule','terms','currency','charges','discountMinor','tax','depositMinor']);
 if(!text(value.scope,10000)||!text(value.schedule,4000,true)||!text(value.terms,10000,true)||!['CAD','USD','EUR','GBP'].includes(value.currency)||!Array.isArray(value.charges)||value.charges.length<1||value.charges.length>50||!integer(value.discountMinor))throw 400;
 strict(value.tax,['type','rateBps']);if(!['NONE','HST','GST','PST','TAX'].includes(value.tax.type)||!integer(value.tax.rateBps,0,5000)||(value.tax.type==='NONE'&&value.tax.rateBps!==0))throw 400;
 const charges=value.charges.map(row=>{strict(row,['description','quantity','unitMinor']);if(!text(row.description,500)||!integer(row.quantity,1,1000000)||!integer(row.unitMinor))throw 400;return {description:row.description,quantity:row.quantity,unitMinor:row.unitMinor,totalMinor:safe(BigInt(row.quantity)*BigInt(row.unitMinor))};});
 const subtotalMinor=safe(charges.reduce((sum,row)=>sum+BigInt(row.totalMinor),0n));if(value.discountMinor>subtotalMinor)throw 400;
 const taxableMinor=subtotalMinor-value.discountMinor,taxMinor=safe((BigInt(taxableMinor)*BigInt(value.tax.rateBps)*2n+10000n)/20000n),totalMinor=safe(BigInt(taxableMinor)+BigInt(taxMinor));
 if(!totalMinor||'depositMinor'in value&&(!integer(value.depositMinor,1)||value.depositMinor>=totalMinor))throw 400;
 return {scope:value.scope,schedule:value.schedule,terms:value.terms,currency:value.currency,charges,discountMinor:value.discountMinor,tax:{type:value.tax.type,rateBps:value.tax.rateBps},...('depositMinor'in value?{depositMinor:value.depositMinor}:{}),totals:{subtotalMinor,discountMinor:value.discountMinor,taxableMinor,taxMinor,totalMinor,balanceMinor:totalMinor-(value.depositMinor??0)}};
}

function normalize(kind,action,body){
 strict(body,action==='CREATE'?['requestId','title','content',...(kind==='TEMPLATE'?[]:['clientId','projectId']),...(kind==='CONTRACT'?['template','proposal']:[])]:action==='EDIT'?['requestId','revision','title','content']:['requestId','revision','reason']);
 if(!uuid(body.requestId))throw 400;
 const result={requestId:body.requestId.toLowerCase()};
 if(action!=='CREATE'){if(!integer(body.revision,0,max-1))throw 400;result.revision=body.revision;}
 if(['CREATE','EDIT'].includes(action)){
  if(!text(body.title,200))throw 400;result.title=body.title.trim();result.content=content(kind,body.content);
 }else{if(!text(body.reason,2000))throw 400;result.reason=body.reason.trim();}
 if(action==='CREATE'&&kind!=='TEMPLATE'){
  if(!id(body.clientId)||'projectId'in body&&!id(body.projectId))throw 400;result.clientId=body.clientId;result.projectId=body.projectId??null;
 }
 if('template'in body)result.template=reference(body.template);
 if('proposal'in body)result.proposal=reference(body.proposal);
 return result;
}

async function read(db,actor,kind,draftId){return db.prepare(`${viewer} SELECT snapshot_json FROM commercial_drafts WHERE organization_id=? AND kind=? AND id=? AND ${authority}`).bind(actor.id,actor.organization_id,actor.organization_id,kind,draftId).first();}
async function receipt(db,actor,key,fingerprint){
 const row=await db.prepare(`${viewer} SELECT v.state_json,v.request_fingerprint,d.revision AS currentRevision FROM commercial_versions v JOIN commercial_drafts d ON d.id=v.draft_id AND d.organization_id=v.organization_id WHERE v.organization_id=? AND v.request_key=? AND ${authority}`).bind(actor.id,actor.organization_id,actor.organization_id,key).first();
 if(row&&fingerprint!==undefined&&row.request_fingerprint!==fingerprint)throw 409;
 if(row)return {state:'SAVED',record:JSON.parse(row.state_json),currentRevision:row.currentRevision};
 const cancelled=await db.prepare(`${viewer} SELECT actor_id,created_at FROM cancelled_commercial_requests WHERE organization_id=? AND request_key=? AND ${authority}`).bind(actor.id,actor.organization_id,actor.organization_id,key).first();
 return cancelled?{state:'CANCELLED',cancelledBy:cancelled.actor_id,cancelledAt:cancelled.created_at}:{state:'UNKNOWN'};
}
async function targets(db,actor,clientId,projectId){
 if(!clientId)return {client:null,project:null};
 const client=await db.prepare('SELECT id,name,revision FROM clients WHERE id=? AND organization_id=?').bind(clientId,actor.organization_id).first();
 const project=projectId?await db.prepare('SELECT id,name,revision FROM projects WHERE id=? AND organization_id=? AND client_id=?').bind(projectId,actor.organization_id,clientId).first():null;
 if(!client||projectId&&!project)throw 404;return {client,project};
}
async function sources(db,actor,input){
 const source={};
 for(const [key,kind]of [['template','TEMPLATE'],['proposal','PROPOSAL']]){
  if(!input[key])continue;
  const row=await read(db,actor,kind,input[key].id);if(!row)throw 404;
  const record=JSON.parse(row.snapshot_json);
  if(record.status!=='DRAFT'||record.revision!==input[key].revision||kind==='PROPOSAL'&&(record.clientId!==input.clientId||record.projectId&&record.projectId!==input.projectId))throw 409;
  source[key]={id:record.id,revision:record.revision,contentHash:record.contentHash};
 }
 return source;
}

// All guards and the immutable version are committed in one D1 batch. A missing
// journal (including a no-op insertion) violates the final NOT NULL fence.
async function write(db,actor,kind,draftId,action,input){
 const {requestId,...intent}=input,fingerprint=await hash({kind,draftId:draftId??null,action,...intent});
 const prior=await receipt(db,actor,requestId,fingerprint);if(prior.state==='SAVED')return {record:prior.record,replayed:true};
 let old=null;
 if(draftId){const row=await read(db,actor,kind,draftId);if(!row)throw 404;old=JSON.parse(row.snapshot_json);if(old.revision!==input.revision||old.status!==(action==='REOPEN'?'ARCHIVED':'DRAFT'))throw 409;}
 const scope=await targets(db,actor,old?.clientId??input.clientId,old?.projectId??input.projectId),source=old?.source??await sources(db,actor,input);
 const now=Date.now(),token=crypto.randomUUID(),record={id:old?.id??crypto.randomUUID(),kind,status:action==='ARCHIVE'?'ARCHIVED':'DRAFT',revision:old?old.revision+1:0,title:input.title??old?.title,clientId:old?.clientId??input.clientId??null,projectId:old?.projectId??input.projectId??null,content:input.content??old?.content,targets:scope,source,createdBy:old?.createdBy??actor.id,createdAt:old?.createdAt??now,updatedAt:now};
 record.contentHash=await hash({kind,title:record.title,content:record.content,targets:scope,source});
 const snapshot=JSON.stringify(record);if(snapshot.length>262144)throw 400;
 const guards=[authority,'NOT EXISTS(SELECT 1 FROM commercial_versions WHERE organization_id=? AND request_key=?)'],values=[actor.id,actor.organization_id,actor.organization_id,requestId];
 guards.push('NOT EXISTS(SELECT 1 FROM cancelled_commercial_requests WHERE organization_id=? AND request_key=?)');values.push(actor.organization_id,requestId);
 if(scope.client){guards.push('EXISTS(SELECT 1 FROM clients WHERE id=? AND organization_id=? AND name=? AND revision=?)');values.push(scope.client.id,actor.organization_id,scope.client.name,scope.client.revision);}
 if(scope.project){guards.push('EXISTS(SELECT 1 FROM projects WHERE id=? AND organization_id=? AND client_id=? AND name=? AND revision=?)');values.push(scope.project.id,actor.organization_id,scope.client.id,scope.project.name,scope.project.revision);}
 if(!old)for(const ref of Object.values(source)){guards.push("EXISTS(SELECT 1 FROM commercial_drafts WHERE id=? AND organization_id=? AND revision=? AND content_hash=? AND status='DRAFT')");values.push(ref.id,actor.organization_id,ref.revision,ref.contentHash);}
 const statement=old?db.prepare(`${viewer} UPDATE commercial_drafts SET title=?,status=?,revision=?,content_hash=?,snapshot_json=?,updated_at=?,write_token=? WHERE ${guards.join(' AND ')} AND id=? AND organization_id=? AND kind=? AND revision=? AND status=? RETURNING id`).bind(...values.slice(0,2),record.title,record.status,record.revision,record.contentHash,snapshot,now,token,...values.slice(2),old.id,actor.organization_id,kind,old.revision,old.status):db.prepare(`${viewer} INSERT INTO commercial_drafts(id,organization_id,kind,client_id,project_id,title,status,revision,content_hash,snapshot_json,created_at,updated_at,write_token) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guards.join(' AND ')} RETURNING id`).bind(...values.slice(0,2),record.id,actor.organization_id,kind,record.clientId,record.projectId,record.title,record.status,record.revision,record.contentHash,snapshot,record.createdAt,now,token,...values.slice(2));
 const journal=db.prepare(`INSERT INTO commercial_versions(id,draft_id,organization_id,actor_id,recorded_at,revision,action,reason,state_json,request_key,request_fingerprint) SELECT write_token,id,organization_id,?,?,revision,?,?,snapshot_json,?,? FROM commercial_drafts WHERE organization_id=? AND write_token=? RETURNING id`).bind(actor.id,now,action,input.reason??null,requestId,fingerprint,actor.organization_id,token);
 const fence=db.prepare('UPDATE commercial_drafts SET write_token=CASE WHEN EXISTS(SELECT 1 FROM commercial_versions v WHERE v.id=? AND v.draft_id=commercial_drafts.id AND v.organization_id=commercial_drafts.organization_id) THEN write_token ELSE NULL END WHERE organization_id=? AND write_token=? RETURNING id').bind(token,actor.organization_id,token);
 let result;try{result=await db.batch([statement,journal,fence]);}catch(error){const saved=await receipt(db,actor,requestId,fingerprint);if(saved.state==='SAVED')return {record:saved.record,replayed:true};throw error;}
 if(!await hasFinance(db,actor))throw 403;
 if(!result[0].results.length){const saved=await receipt(db,actor,requestId,fingerprint);if(saved.state==='SAVED')return {record:saved.record,replayed:true};throw 409;}
 return {record,replayed:false};
}

function summary(record){return {id:record.id,kind:record.kind,title:record.title,status:record.status,revision:record.revision,clientId:record.clientId,projectId:record.projectId,updatedAt:record.updatedAt,...(record.kind==='PROPOSAL'?{currency:record.content.currency,totalMinor:record.content.totals.totalMinor}:{})};}
export function commercialExportStatement(db,actor,table){const columns=table==='commercial_drafts'?'id,organization_id,kind,client_id,project_id,title,status,revision,content_hash,snapshot_json,created_at,updated_at':table==='cancelled_commercial_requests'?'id,organization_id,request_key,actor_id,created_at':'id,draft_id,organization_id,actor_id,recorded_at,revision,action,reason,state_json';return db.prepare(`${viewer} SELECT ${columns} FROM ${table} WHERE organization_id=? AND ${authority} ORDER BY id LIMIT 1001`).bind(actor.id,actor.organization_id,actor.organization_id);}

export async function commercialRoute(request,db,actor,readBody,json){
 if(!await hasFinance(db,actor))throw 403;
 const url=new URL(request.url),path=url.pathname;
 const key=path.match(/^\/api\/commercial\/requests\/([^/]+)(\/cancel)?$/);
 if(key){
  if(request.method!==(key[2]?'POST':'GET'))throw 405;if(url.search||!uuid(key[1]))throw 400;
  if(key[2]){strict(await readBody(request),[]);await db.prepare(`${viewer} INSERT INTO cancelled_commercial_requests(id,organization_id,request_key,actor_id,created_at) SELECT ?,?,?,?,? WHERE ${authority} AND NOT EXISTS(SELECT 1 FROM commercial_versions WHERE organization_id=? AND request_key=?) ON CONFLICT(organization_id,request_key) DO NOTHING RETURNING id`).bind(actor.id,actor.organization_id,crypto.randomUUID(),actor.organization_id,key[1].toLowerCase(),actor.id,Date.now(),actor.organization_id,key[1].toLowerCase()).all();}
  const result=await receipt(db,actor,key[1].toLowerCase());if(!await hasFinance(db,actor))throw 403;return json(result);
 }
 const match=path.match(/^\/api\/commercial\/(proposals|templates|contracts)(?:\/([a-zA-Z0-9-]{1,100})(?:\/(history|archive|reopen)(?:\/(\d{1,16}))?)?)?$/);if(!match)throw 404;
 const kind=kinds[match[1]],draftId=match[2],operation=match[3],version=match[4];
 if(version!==undefined&&operation!=='history')throw 404;
 if(request.method==='GET'){
  if(operation&&operation!=='history')throw 405;
  if(!draftId){
   query(url,['status','after',...(kind==='TEMPLATE'?[]:['clientId','projectId'])]);const status=url.searchParams.get('status'),after=url.searchParams.get('after'),client=url.searchParams.get('clientId'),project=url.searchParams.get('projectId');
   if(status&&!['DRAFT','ARCHIVED'].includes(status)||status===''||after!==null&&!id(after)||client!==null&&!id(client)||project!==null&&!id(project))throw 400;
   const filters=['organization_id=?','kind=?',authority],params=[actor.id,actor.organization_id,actor.organization_id,kind];for(const [column,value,op]of [['status',status,'='],['id',after,'>'],['client_id',client,'='],['project_id',project,'=']])if(value!==null){filters.push(`${column}${op}?`);params.push(value);}
   const rows=(await db.prepare(`${viewer} SELECT snapshot_json FROM commercial_drafts WHERE ${filters.join(' AND ')} ORDER BY id LIMIT 51`).bind(...params).all()).results;
   const items=rows.slice(0,50).map(row=>summary(JSON.parse(row.snapshot_json)));return json({items,nextCursor:rows.length>50?items.at(-1).id:null});
  }
  const row=await read(db,actor,kind,draftId);if(!row){if(!await hasFinance(db,actor))throw 403;throw 404;}
  if(!operation){if(url.search)throw 400;return json(JSON.parse(row.snapshot_json));}
  query(url,version===undefined?['before']:[]);const before=url.searchParams.get('before');if(before!==null&&(!/^\d{1,16}$/.test(before)||!integer(Number(before)))||version!==undefined&&!integer(Number(version)))throw 400;
  const rows=(await db.prepare(`${viewer} SELECT state_json,actor_id,recorded_at,revision,action,reason FROM commercial_versions WHERE organization_id=? AND draft_id=? AND ${authority} ${version!==undefined?'AND revision=?':before!==null?'AND revision<?':''} ORDER BY revision DESC LIMIT 51`).bind(actor.id,actor.organization_id,actor.organization_id,draftId,...(version!==undefined?[Number(version)]:before!==null?[Number(before)]:[])).all()).results;
  if(version!==undefined){if(!rows[0])throw 404;return json({...JSON.parse(rows[0].state_json),actorId:rows[0].actor_id,recordedAt:rows[0].recorded_at,action:rows[0].action,reason:rows[0].reason});}
  const items=rows.slice(0,50).map(v=>({revision:v.revision,actorId:v.actor_id,recordedAt:v.recorded_at,action:v.action,reason:v.reason,title:JSON.parse(v.state_json).title,status:JSON.parse(v.state_json).status}));return json({items,currentRevision:JSON.parse(row.snapshot_json).revision,nextCursor:rows.length>50?String(items.at(-1).revision):null});
 }
 if(url.search)throw 400;
 const action=request.method==='POST'&&!draftId?'CREATE':request.method==='PATCH'&&draftId&&!operation?'EDIT':request.method==='POST'&&draftId&&['archive','reopen'].includes(operation)?operation.toUpperCase():null;
 if(!action)throw 405;
 const result=await write(db,actor,kind,draftId,action,normalize(kind,action,await readBody(request)));
 return json(result.record,action==='CREATE'&&!result.replayed?201:200);
}
