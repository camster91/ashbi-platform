import {hasFinance} from './time-details.mjs';

const id=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const revision=v=>Number.isSafeInteger(v)&&v>=0&&v<Number.MAX_SAFE_INTEGER;
const reason=v=>typeof v==='string'&&v.trim().length>0&&v.length<=2000&&!v.includes('\0');
function strict(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))throw 400;}
function query(url,keys){const seen=new Set();for(const key of url.searchParams.keys()){if(!keys.includes(key)||seen.has(key))throw 400;seen.add(key);}}
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const viewer=client=>`WITH publication_viewer AS (SELECT a.id,a.email,a.client_id FROM actors a ${client?'':'JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id'} WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='${client?'client':'staff'}' ${client?'AND a.client_id IS ?':''})`;
const bindings=(actor,client)=>[actor.id,actor.organization_id,...(client?[actor.client_id]:[])];
const authority='EXISTS(SELECT 1 FROM publication_viewer)';
// Publication content is deliberately independent of subsequent private draft edits.
const portalScope=`${authority} AND r.status='PENDING' AND EXISTS(SELECT 1 FROM publication_viewer v WHERE v.client_id=r.client_id) AND EXISTS(SELECT 1 FROM clients c WHERE c.id=r.client_id AND c.organization_id=r.organization_id) AND (r.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=r.project_id AND p.organization_id=r.organization_id AND p.client_id=r.client_id AND p.client_visible=1))`;
const columns='id,organization_id,contract_id,client_id,project_id,source_revision,source_hash,content_hash,snapshot_json,status,revision,created_by,created_at,withdrawn_at,withdrawn_by,withdrawal_reason,signing_policy_json,signing_policy_hash';
const stateJson=alias=>`json_object(${columns.split(',').map(c=>`'${c}',${alias}.${c}`).join(',')})`;
function view(row,client){const result={id:row.id,contractId:row.contract_id,contractRevision:row.source_revision,revision:row.revision,state:row.state_override??row.status,snapshot:JSON.parse(row.snapshot_json),contentHash:row.content_hash,createdAt:row.created_at,withdrawnAt:row.withdrawn_at};if(!client)Object.assign(result,{clientId:row.client_id,projectId:row.project_id,sourceHash:row.source_hash,createdBy:row.created_by,withdrawnBy:row.withdrawn_by,withdrawalReason:row.withdrawal_reason});if(row.signature_public)result.signature=row.signature_public;return result;}
async function allowed(db,actor,client){
 if(client){if(actor.role!=='client'||!await db.prepare("SELECT id FROM actors WHERE id=? AND organization_id=? AND active=1 AND role='client' AND client_id IS ?").bind(actor.id,actor.organization_id,actor.client_id).first())throw 403;}
 else if(!await hasFinance(db,actor))throw 403;
}
async function read(db,actor,publicationId,client){
 const select=()=>db.prepare(`${viewer(client)} SELECT r.* FROM contract_publications r WHERE r.id=? AND r.organization_id=? AND ${client?portalScope:authority}`).bind(...bindings(actor,client),publicationId,actor.organization_id).first();
 let row=await select();if(client)row=await select();await allowed(db,actor,client);if(!row)throw 404;return row;
}
async function receipt(db,actor,key,fingerprint){
 await allowed(db,actor,false);
 const saved=await db.prepare(`${viewer(false)} SELECT e.state_json,e.request_fingerprint,r.revision AS current_revision FROM contract_publication_events e JOIN contract_publications r ON r.id=e.publication_id AND r.organization_id=e.organization_id WHERE e.organization_id=? AND e.request_key=? AND ${authority}`).bind(...bindings(actor,false),actor.organization_id,key).first();
 const cancelled=saved?null:await db.prepare(`${viewer(false)} SELECT actor_id,created_at FROM cancelled_contract_publication_requests WHERE organization_id=? AND request_key=? AND ${authority}`).bind(...bindings(actor,false),actor.organization_id,key).first();
 await allowed(db,actor,false);
 if(saved){if(fingerprint!==undefined&&saved.request_fingerprint!==fingerprint)throw 409;return {state:'SAVED',publication:view(JSON.parse(saved.state_json),false),currentRevision:saved.current_revision};}
 return cancelled?{state:'CANCELLED',cancelledBy:cancelled.actor_id,cancelledAt:cancelled.created_at}:{state:'UNKNOWN'};
}
const requestGuard=`NOT EXISTS(SELECT 1 FROM contract_publication_events WHERE organization_id=? AND request_key=?) AND NOT EXISTS(SELECT 1 FROM cancelled_contract_publication_requests WHERE organization_id=? AND request_key=?)`;
const requestValues=(actor,key)=>[actor.organization_id,key,actor.organization_id,key];
function event(db,actor,publicationId,token,action,why,key,fingerprint){return db.prepare(`${viewer(false)} INSERT INTO contract_publication_events(id,publication_id,organization_id,actor_id,actor_email,recorded_at,revision,action,reason,state_json,request_key,request_fingerprint) SELECT r.write_token,r.id,r.organization_id,v.id,v.email,?,r.revision,?,?,${stateJson('r')},?,? FROM contract_publications r CROSS JOIN publication_viewer v WHERE r.id=? AND r.organization_id=? AND r.write_token=? RETURNING id`).bind(...bindings(actor,false),Date.now(),action,why,key,fingerprint,publicationId,actor.organization_id,token);}
function fence(db,actor,publicationId,token){return db.prepare('UPDATE contract_publications SET write_token=CASE WHEN EXISTS(SELECT 1 FROM contract_publication_events e WHERE e.id=? AND e.publication_id=contract_publications.id AND e.organization_id=contract_publications.organization_id) THEN write_token ELSE NULL END WHERE id=? AND organization_id=? AND write_token=? RETURNING id').bind(token,publicationId,actor.organization_id,token);}
async function commit(db,actor,statement,publicationId,token,action,why,key,fingerprint){
 let results;try{results=await db.batch([statement,event(db,actor,publicationId,token,action,why,key,fingerprint),fence(db,actor,publicationId,token)]);}catch(error){const saved=await receipt(db,actor,key,fingerprint);if(saved.state==='SAVED')return {...saved,replayed:true};throw error;}
 const saved=await receipt(db,actor,key,fingerprint);if(saved.state!=='SAVED')throw 409;return {...saved,replayed:results[0].results.length===0};
}
async function publish(db,actor,body,options){
 strict(body,['requestId','contractId','contractRevision','contractHash','reason']);if(!uuid(body.requestId)||!id(body.contractId)||!revision(body.contractRevision)||!digest(body.contractHash)||!reason(body.reason))throw 400;
 const key=body.requestId.toLowerCase(),why=body.reason.trim(),fingerprint=await hash({action:'PUBLISH',contractId:body.contractId,contractRevision:body.contractRevision,contractHash:body.contractHash,reason:why}),prior=await receipt(db,actor,key,fingerprint);if(prior.state==='SAVED')return {...prior,replayed:true};
 const policy=await options.policy?.()??null;
 const draft=await db.prepare(`${viewer(false)} SELECT d.* FROM commercial_drafts d WHERE d.id=? AND d.organization_id=? AND d.kind='CONTRACT' AND ${authority}`).bind(...bindings(actor,false),body.contractId,actor.organization_id).first();if(!draft){await allowed(db,actor,false);throw 404;}
 if(draft.status!=='DRAFT'||draft.revision!==body.contractRevision||draft.content_hash!==body.contractHash)throw 409;
 const source=JSON.parse(draft.snapshot_json),client=await db.prepare('SELECT id,name,revision FROM clients WHERE id=? AND organization_id=?').bind(draft.client_id,actor.organization_id).first(),project=draft.project_id?await db.prepare('SELECT id,name,revision,client_id,client_visible FROM projects WHERE id=? AND organization_id=?').bind(draft.project_id,actor.organization_id).first():null;
 if(!client)throw 404;if(draft.project_id&&(!project||project.client_id!==client.id||project.client_visible!==1))throw 409;
 if(source.id!==draft.id||source.kind!=='CONTRACT'||source.revision!==draft.revision||source.clientId!==draft.client_id||source.projectId!==draft.project_id||source.contentHash!==draft.content_hash||await hash({kind:source.kind,title:source.title,content:source.content,targets:source.targets,source:source.source})!==draft.content_hash)throw 409;
 if(source.targets?.client?.id!==client.id||source.targets.client.name!==client.name||source.targets.client.revision!==client.revision||project&&(source.targets.project?.id!==project.id||source.targets.project.name!==project.name||source.targets.project.revision!==project.revision)||!project&&source.targets.project!==null)throw 409;
 const version=await db.prepare('SELECT state_json FROM commercial_versions WHERE draft_id=? AND organization_id=? AND revision=?').bind(draft.id,actor.organization_id,draft.revision).first();if(version?.state_json!==draft.snapshot_json)throw 409;
 const snapshot={version:1,contractId:draft.id,contractRevision:draft.revision,title:source.title,client:{id:client.id,name:client.name},project:project?{id:project.id,name:project.name}:null,content:source.content},contentHash=await hash(snapshot),publicationId=crypto.randomUUID(),token=crypto.randomUUID(),now=Date.now();
 const guards=[authority,requestGuard,"NOT EXISTS(SELECT 1 FROM contract_publications WHERE organization_id=? AND contract_id=? AND status='PENDING')","EXISTS(SELECT 1 FROM commercial_drafts d WHERE d.id=? AND d.organization_id=? AND d.kind='CONTRACT' AND d.status='DRAFT' AND d.revision=? AND d.content_hash=? AND d.snapshot_json=? AND d.client_id=? AND d.project_id IS ?)",'EXISTS(SELECT 1 FROM commercial_versions WHERE draft_id=? AND organization_id=? AND revision=? AND state_json=?)','EXISTS(SELECT 1 FROM clients WHERE id=? AND organization_id=? AND name=? AND revision=?)'];
 const values=[...requestValues(actor,key),actor.organization_id,draft.id,draft.id,actor.organization_id,draft.revision,draft.content_hash,draft.snapshot_json,draft.client_id,draft.project_id,draft.id,actor.organization_id,draft.revision,draft.snapshot_json,client.id,actor.organization_id,client.name,client.revision];
 if(project){guards.push('EXISTS(SELECT 1 FROM projects WHERE id=? AND organization_id=? AND client_id=? AND name=? AND revision=? AND client_visible=1)');values.push(project.id,actor.organization_id,client.id,project.name,project.revision);}
 const statement=db.prepare(`${viewer(false)} INSERT INTO contract_publications(id,organization_id,contract_id,client_id,project_id,source_revision,source_hash,content_hash,snapshot_json,status,revision,created_by,created_at,write_token,signing_policy_json,signing_policy_hash) SELECT ?,?,?,?,?,?,?,?,?,'PENDING',0,?,?,?,?,? WHERE ${guards.join(' AND ')} RETURNING id`).bind(...bindings(actor,false),publicationId,actor.organization_id,draft.id,client.id,project?.id??null,draft.revision,draft.content_hash,contentHash,JSON.stringify(snapshot),actor.id,now,token,policy?JSON.stringify(policy):null,policy?.hash??null,...values);
 return commit(db,actor,statement,publicationId,token,'PUBLISH',why,key,fingerprint);
}
async function withdraw(db,actor,publicationId,body){
 strict(body,['requestId','revision','reason']);if(!uuid(body.requestId)||!revision(body.revision)||!reason(body.reason))throw 400;
 const key=body.requestId.toLowerCase(),why=body.reason.trim(),fingerprint=await hash({action:'WITHDRAW',publicationId,revision:body.revision,reason:why}),prior=await receipt(db,actor,key,fingerprint);if(prior.state==='SAVED')return {...prior,replayed:true};
 await read(db,actor,publicationId,false);const token=crypto.randomUUID();
 const statement=db.prepare(`${viewer(false)} UPDATE contract_publications SET status='WITHDRAWN',withdrawn_at=?,withdrawn_by=?,withdrawal_reason=?,revision=revision+1,write_token=? WHERE id=? AND organization_id=? AND revision=? AND status='PENDING' AND NOT EXISTS(SELECT 1 FROM contract_signatures signed WHERE signed.organization_id=contract_publications.organization_id AND signed.publication_id=contract_publications.id) AND ${authority} AND ${requestGuard} RETURNING id`).bind(...bindings(actor,false),Date.now(),actor.id,why,token,publicationId,actor.organization_id,body.revision,...requestValues(actor,key));
 return commit(db,actor,statement,publicationId,token,'WITHDRAW',why,key,fingerprint);
}
async function cancel(db,actor,key){
 const prior=await receipt(db,actor,key);if(prior.state!=='UNKNOWN')return prior;
 await db.prepare(`${viewer(false)} INSERT INTO cancelled_contract_publication_requests(id,organization_id,request_key,actor_id,created_at) SELECT ?,?,?,?,? WHERE ${authority} AND NOT EXISTS(SELECT 1 FROM contract_publication_events WHERE organization_id=? AND request_key=?) ON CONFLICT(organization_id,request_key) DO NOTHING RETURNING id`).bind(...bindings(actor,false),crypto.randomUUID(),actor.organization_id,key,actor.id,Date.now(),actor.organization_id,key).all();return receipt(db,actor,key);
}
export function contractPublicationExportStatement(db,actor,table){const selection=table==='contract_publications'?columns:table==='contract_publication_events'?'id,publication_id,organization_id,actor_id,actor_email,recorded_at,revision,action,reason,state_json':'id,organization_id,actor_id,created_at';return db.prepare(`${viewer(false)} SELECT ${selection} FROM ${table} WHERE organization_id=? AND ${authority} ORDER BY id LIMIT 1001`).bind(...bindings(actor,false),actor.organization_id);}

export async function contractPublicationsRoute(request,db,actor,readBody,json,options={}){
 const url=new URL(request.url),client=url.pathname.startsWith('/api/portal/'),prefix=client?'/api/portal/contracts':'/api/contract-publications',rest=url.pathname.slice(prefix.length);await allowed(db,actor,client);
 const keyMatch=!client&&rest.match(/^\/requests\/([^/]+)(\/cancel)?$/);
 if(keyMatch){if(!uuid(keyMatch[1])||url.search)throw 400;if(request.method!==(keyMatch[2]?'POST':'GET'))throw 405;if(keyMatch[2])strict(await readBody(request),[]);return json(keyMatch[2]?await cancel(db,actor,keyMatch[1].toLowerCase()):await receipt(db,actor,keyMatch[1].toLowerCase()));}
 const match=rest.match(/^(?:\/([a-zA-Z0-9-]{1,100})(?:\/(history|withdraw|document))?)?$/);if(!match)throw 404;
 const publicationId=match[1],operation=match[2];if(client&&operation&&operation!=='document'||!client&&operation==='document')throw 404;
 if(request.method==='GET'){
  if(operation==='withdraw')throw 405;
  if(!publicationId){
   query(url,['contractId','clientId','projectId','after','state']);if(client&&url.searchParams.has('clientId'))throw 400;
   const state=url.searchParams.get('state');if(state!==null&&!['PENDING','WITHDRAWN','SIGNED'].includes(state)||client&&state==='WITHDRAWN')throw 400;
   const conditions=['r.organization_id=?',client?portalScope:authority],values=[...bindings(actor,client),actor.organization_id];
   for(const [key,column]of [['contractId','contract_id'],['clientId','client_id'],['projectId','project_id'],['after','id']])if(url.searchParams.has(key)){const value=url.searchParams.get(key);if(!id(value))throw 400;conditions.push('r.'+column+(key==='after'?'>?':'=?'));values.push(value);}
   if(state==='SIGNED')conditions.push("r.status='PENDING' AND EXISTS(SELECT 1 FROM contract_signatures signed WHERE signed.organization_id=r.organization_id AND signed.publication_id=r.id)");else if(state==='PENDING')conditions.push("r.status='PENDING' AND NOT EXISTS(SELECT 1 FROM contract_signatures signed WHERE signed.organization_id=r.organization_id AND signed.publication_id=r.id)");else if(state){conditions.push('r.status=?');values.push(state);}
   const select=()=>db.prepare(`${viewer(client)} SELECT r.* FROM contract_publications r WHERE ${conditions.join(' AND ')} ORDER BY r.id LIMIT 51`).bind(...values).all();let result=await select();if(client)result=await select();await allowed(db,actor,client);
   const selected=result.results.slice(0,50),decorated=options.decorateMany?await options.decorateMany(selected,client):await Promise.all(selected.map(row=>options.decorate?options.decorate(row,client):row));
   const current=await select();await allowed(db,actor,client);if(JSON.stringify(current.results)!==JSON.stringify(result.results))throw 409;
   const items=decorated.map(row=>({id:row.id,contractId:row.contract_id,contractRevision:row.source_revision,title:JSON.parse(row.snapshot_json).title,state:row.state_override??row.status,revision:row.revision,createdAt:row.created_at,withdrawnAt:row.withdrawn_at,...(row.document_verification?{documentVerification:row.document_verification}:{})}));return json({items,nextCursor:result.results.length>50?items.at(-1).id:null});
  }
  let row=await read(db,actor,publicationId,client);if(options.decorate)row=await options.decorate(row,client);
  if(!operation){if(url.search)throw 400;return json(view(row,client));}
  if(operation==='document'){if(url.search)throw 400;const response=json({version:1,publicationId:row.id,contentHash:row.content_hash,snapshot:JSON.parse(row.snapshot_json)});response.headers.set('Content-Disposition',`attachment; filename="contract-${row.id}.json"`);return response;}
  query(url,['before']);const before=url.searchParams.get('before');if(before!==null&&(!/^\d{1,16}$/.test(before)||!revision(Number(before))))throw 400;
  const result=(await db.prepare(`${viewer(false)},history AS (SELECT revision,action,reason,actor_id,actor_email,recorded_at,state_json,NULL AS signature_json,organization_id,publication_id FROM contract_publication_events UNION ALL SELECT revision,action,NULL AS reason,actor_id,actor_email,recorded_at,publication_state_json AS state_json,state_json AS signature_json,organization_id,publication_id FROM contract_signature_events) SELECT * FROM history WHERE organization_id=? AND publication_id=? AND ${authority} ${before===null?'':'AND revision<?'} ORDER BY revision DESC LIMIT 51`).bind(...bindings(actor,false),actor.organization_id,publicationId,...(before===null?[]:[Number(before)])).all()).results;await allowed(db,actor,false);
  const items=result.slice(0,50).map(e=>({revision:e.revision,action:e.action,reason:e.reason,actorId:e.actor_id,actorEmail:e.actor_email,recordedAt:e.recorded_at,state:view({...JSON.parse(e.state_json),...(e.action==='SIGN'?{state_override:'SIGNED',signature_public:JSON.parse(e.signature_json)}:{})},false)}));return json({items,currentRevision:row.revision,nextCursor:result.length>50?String(items.at(-1).revision):null});
 }
 if(url.search)throw 400;if(request.method!=='POST')throw 405;
 if(!client&&!publicationId){const result=await publish(db,actor,await readBody(request),options);return json(result.publication,result.replayed?200:201);}
 if(!client&&operation==='withdraw')return json((await withdraw(db,actor,publicationId,await readBody(request))).publication);
 throw 405;
}

export {read as readContractPublication,allowed as assertContractAuthority,view as publicationView};
