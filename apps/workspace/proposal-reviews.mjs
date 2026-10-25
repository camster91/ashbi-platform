import {hasFinance} from './time-details.mjs';

const max=Number.MAX_SAFE_INTEGER;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const revision=v=>Number.isSafeInteger(v)&&v>=0&&v<max;
const text=(v,limit,empty=false)=>typeof v==='string'&&(empty||v.trim().length>0)&&v.length<=limit&&!v.includes('\0');
function strict(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw 400;}
function query(url,keys){const seen=new Set();for(const key of url.searchParams.keys()){if(!keys.includes(key)||seen.has(key))throw 400;seen.add(key);}}
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const clock="CAST(strftime('%s','now') AS INTEGER)*1000";
const viewer=client=>`WITH review_viewer AS (SELECT a.id,a.email,a.client_id FROM actors a ${client?'':'JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id'} WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='${client?'client':'staff'}')`;
const authority='EXISTS(SELECT 1 FROM review_viewer)';
const sourceMatches=`EXISTS(SELECT 1 FROM commercial_drafts d WHERE d.id=r.proposal_id AND d.organization_id=r.organization_id AND d.kind='PROPOSAL' AND d.client_id=r.client_id AND d.project_id IS r.project_id)`;
const portalScope=`${authority} AND EXISTS(SELECT 1 FROM review_viewer v WHERE v.client_id=r.client_id) AND r.revoked_at IS NULL AND ${sourceMatches} AND (r.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=r.project_id AND p.organization_id=r.organization_id AND p.client_id=r.client_id AND p.client_visible=1))`;
const sourceLive=`EXISTS(SELECT 1 FROM commercial_drafts d WHERE d.id=r.proposal_id AND d.organization_id=r.organization_id AND d.kind='PROPOSAL' AND d.client_id=r.client_id AND d.project_id IS r.project_id AND d.status='DRAFT' AND d.revision=r.source_revision AND d.content_hash=r.source_hash)`;
const latest='NOT EXISTS(SELECT 1 FROM proposal_reviews newer WHERE newer.organization_id=r.organization_id AND newer.proposal_id=r.proposal_id AND newer.round_number>r.round_number)';
const columns='id,organization_id,proposal_id,client_id,project_id,source_revision,source_hash,content_hash,snapshot_json,round_number,status,expires_at,created_by,created_at,revision,superseded_by,revoked_at,revoked_by,revocation_reason,decision_actor_id,decision_actor_email,decision_at,decision_comment,decision_acknowledged';
const jsonState=alias=>`json_object(${columns.split(',').map(c=>`'${c}',${alias}.${c}`).join(',')})`;
const keyScope=(actor,client)=>client?'client:'+actor.id:'staff';

function view(row,actor,client,historical=false,at=Date.now()){
 const state=row.revoked_at!==null?'REVOKED':row.status==='OPEN'?(row.source_live===0?'STALE':row.expires_at<=at?'EXPIRED':'OPEN'):row.status;
 const result={id:row.id,proposalId:row.proposal_id,proposalRevision:row.source_revision,round:row.round_number,state,revision:row.revision,contentHash:row.content_hash,snapshot:JSON.parse(row.snapshot_json),createdAt:row.created_at,expiresAt:row.expires_at,isLatest:historical?true:Boolean(row.is_latest),canRespond:client&&!historical&&state==='OPEN'&&Boolean(row.is_latest)&&row.source_live===1,decision:row.decision_actor_id?{value:row.status,at:row.decision_at,comment:row.decision_comment,acknowledged:row.decision_acknowledged===1,...(client?{byYou:row.decision_actor_id===actor.id}:{actorId:row.decision_actor_id,actorEmail:row.decision_actor_email})}:null};
 if(!client)Object.assign(result,{clientId:row.client_id,projectId:row.project_id,sourceHash:row.source_hash,createdBy:row.created_by,supersededBy:row.superseded_by,revokedAt:row.revoked_at,revokedBy:row.revoked_by,revocationReason:row.revocation_reason});
 return result;
}
async function read(db,actor,reviewId,client){return db.prepare(`${viewer(client)} SELECT r.*,${latest} AS is_latest,${sourceLive} AS source_live FROM proposal_reviews r WHERE r.organization_id=? AND r.id=? AND ${client?portalScope:authority}`).bind(actor.id,actor.organization_id,actor.organization_id,reviewId).first();}
async function allowed(db,actor,client,reviewId){
 if(client){if(actor.role!=='client')throw 403;const live=await db.prepare("SELECT id FROM actors WHERE id=? AND organization_id=? AND role='client' AND active=1").bind(actor.id,actor.organization_id).first();if(!live)throw 403;if(reviewId&&!await read(db,actor,reviewId,true))throw 404;}
 else if(!await hasFinance(db,actor))throw 403;
}
// Read-only daily projection shares the review's authority, live-source and view rules.
export async function dashboardReviews(request,db,actor,json){
 if(request.method!=='GET')throw 405;
 const url=new URL(request.url);query(url,['state','clientId','projectId','after']);
 const state=url.searchParams.get('state')??'attention';if(!['attention','all','OPEN','APPROVED','DECLINED','CHANGES_REQUESTED','SUPERSEDED','REVOKED','EXPIRED','STALE'].includes(state))throw 400;
 const client=actor.role==='client';await allowed(db,actor,client);
 const params=[actor.id,actor.organization_id,actor.organization_id],conditions=['r.organization_id=?',client?portalScope:authority];
 if(client){conditions.push('EXISTS(SELECT 1 FROM review_viewer v WHERE v.client_id=?)');params.push(actor.client_id);}
 for(const [key,column]of [['clientId','client_id'],['projectId','project_id'],['after','id']])if(url.searchParams.has(key)){const value=url.searchParams.get(key);if(!id(value))throw 400;conditions.push('r.'+column+(key==='after'?'>?':'=?'));params.push(value);}
 const observedAt=Date.now();params.push(observedAt);
 const derived="CASE WHEN revoked_at IS NOT NULL THEN 'REVOKED' WHEN status='OPEN' THEN CASE WHEN source_live=0 THEN 'STALE' WHEN expires_at<=? THEN 'EXPIRED' ELSE 'OPEN' END ELSE status END";
 const filter=state==='attention'?"is_latest=1 AND dashboard_state IN ('OPEN','CHANGES_REQUESTED','EXPIRED','STALE')":state==='all'?'1':'dashboard_state=?';if(!['attention','all'].includes(state))params.push(state);
 const sql=`${viewer(client)},dashboard_scoped AS (SELECT r.*,${latest} AS is_latest,${sourceLive} AS source_live FROM proposal_reviews r WHERE ${conditions.join(' AND ')}),dashboard_derived AS (SELECT dashboard_scoped.*,${derived} AS dashboard_state FROM dashboard_scoped) SELECT * FROM dashboard_derived WHERE ${filter} ORDER BY id LIMIT 51`;
 const read=()=>db.prepare(sql).bind(...params).all();let result=await read();if(client)result=await read();
 await allowed(db,actor,client);
 if(client&&!await db.prepare("SELECT id FROM actors WHERE id=? AND organization_id=? AND role='client' AND active=1 AND client_id=?").bind(actor.id,actor.organization_id,actor.client_id).first())throw 403;
 const items=result.results.slice(0,50).map(row=>{const full=view(row,actor,client,false,observedAt),snapshot=full.snapshot;return {id:full.id,proposalId:full.proposalId,title:snapshot.title,source:{kind:'reviews',id:full.id},client:{id:snapshot.client.id,name:snapshot.client.name},project:snapshot.project?{id:snapshot.project.id,name:snapshot.project.name}:null,owner:{id:null,state:'UNASSIGNED'},responsibility:!full.isLatest?null:full.state==='OPEN'?'CLIENT_TEAM':['CHANGES_REQUESTED','EXPIRED','STALE'].includes(full.state)?'STAFF_TEAM':null,nextAction:!full.isLatest?'Open review details':full.state==='OPEN'?(full.canRespond?'Review proposal':'Await client review'):full.state==='CHANGES_REQUESTED'?(client?'Await revised proposal':'Review requested changes'):'Open review details',state:full.state,revision:full.revision,isLatest:full.isLatest,canRespond:full.canRespond,createdAt:full.createdAt,expiresAt:full.expiresAt};});
 return json({items,nextCursor:result.results.length>50?items.at(-1).id:null,complete:result.results.length<=50,limit:50,observedAt});
}
async function get(db,actor,reviewId,client){const row=await read(db,actor,reviewId,client);if(!row){await allowed(db,actor,client);throw 404;}return row;}
async function receipt(db,actor,key,client,reviewId,fingerprint){
 await allowed(db,actor,client,reviewId);const scope=keyScope(actor,client);
 const event=await db.prepare(`${viewer(client)} SELECT e.state_json,e.request_fingerprint,e.review_id,e.recorded_at,r.revision AS current_revision FROM proposal_review_events e JOIN proposal_reviews r ON r.id=e.review_id AND r.organization_id=e.organization_id WHERE e.organization_id=? AND e.request_scope=? AND e.request_key=? AND ${client?portalScope:authority}`).bind(actor.id,actor.organization_id,actor.organization_id,scope,key).first();
 if(event){if(client&&event.review_id!==reviewId||fingerprint!==undefined&&event.request_fingerprint!==fingerprint)throw 409;return {state:'SAVED',review:view(JSON.parse(event.state_json),actor,client,true,event.recorded_at),currentRevision:event.current_revision};}
 const cancelled=await db.prepare(`${viewer(client)} SELECT c.actor_id,c.review_id,c.created_at FROM cancelled_proposal_review_requests c ${client?'JOIN proposal_reviews r ON r.id=c.review_id AND r.organization_id=c.organization_id':''} WHERE c.organization_id=? AND c.request_scope=? AND c.request_key=? AND ${client?portalScope:authority}`).bind(actor.id,actor.organization_id,actor.organization_id,scope,key).first();
 if(cancelled&&client&&cancelled.review_id!==reviewId)throw 409;
 await allowed(db,actor,client,reviewId);return cancelled?{state:'CANCELLED',cancelledBy:client?'You':cancelled.actor_id,cancelledAt:cancelled.created_at}:{state:'UNKNOWN'};
}
function requestGuard(){return `NOT EXISTS(SELECT 1 FROM proposal_review_events WHERE organization_id=? AND request_scope=? AND request_key=?) AND NOT EXISTS(SELECT 1 FROM cancelled_proposal_review_requests WHERE organization_id=? AND request_scope=? AND request_key=?)`;}
const requestValues=(actor,key,client)=>[actor.organization_id,keyScope(actor,client),key,actor.organization_id,keyScope(actor,client),key];
function event(db,actor,reviewId,token,action,reason,request,client,causation){
 return db.prepare(`${viewer(client)} INSERT INTO proposal_review_events(id,review_id,organization_id,actor_id,actor_email,recorded_at,revision,action,reason,state_json,request_scope,request_key,request_fingerprint,causation_id) SELECT r.write_token,r.id,r.organization_id,review_viewer.id,review_viewer.email,?,r.revision,'${action}',?,${jsonState('r')},?,?,?,? FROM proposal_reviews r CROSS JOIN review_viewer WHERE r.id=? AND r.organization_id=? AND r.write_token=? RETURNING id`)
 .bind(actor.id,actor.organization_id,Date.now(),reason??null,request?keyScope(actor,client):null,request?.key??null,request?.fingerprint??null,causation??null,reviewId,actor.organization_id,token);
}
function fence(db,actor,reviewId,token,extraEvent){return db.prepare(`UPDATE proposal_reviews SET write_token=CASE WHEN EXISTS(SELECT 1 FROM proposal_review_events e WHERE e.id=? AND e.review_id=proposal_reviews.id AND e.organization_id=proposal_reviews.organization_id) ${extraEvent?'AND EXISTS(SELECT 1 FROM proposal_review_events e WHERE e.id=? AND e.organization_id=proposal_reviews.organization_id)':''} THEN write_token ELSE NULL END WHERE id=? AND organization_id=? AND write_token=? RETURNING id`).bind(token,...(extraEvent?[extraEvent]:[]),reviewId,actor.organization_id,token);}
async function commit(db,actor,statements,key,client,reviewId,fingerprint){
 let results;try{results=await db.batch(statements);}catch(error){const replay=await receipt(db,actor,key,client,reviewId,fingerprint);if(replay.state==='SAVED')return {...replay,replayed:true};throw error;}
 const result=await receipt(db,actor,key,client,reviewId,fingerprint);if(result.state!=='SAVED')throw 409;return {...result,replayed:results[0].results.length===0};
}
async function publish(db,actor,body){
 strict(body,['requestId','proposalId','proposalRevision','proposalHash','expiresAt','reason','previousReviewId','previousRevision']);
 if(!uuid(body.requestId)||!id(body.proposalId)||!revision(body.proposalRevision)||!digest(body.proposalHash)||!text(body.reason,2000)||typeof body.expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(body.expiresAt))throw 400;
 const expires=Date.parse(body.expiresAt);if(!Number.isSafeInteger(expires)||new Date(expires).toISOString().replace('.000Z','Z')!==body.expiresAt)throw 400;
 if(('previousReviewId'in body)!==('previousRevision'in body)||'previousReviewId'in body&&(!id(body.previousReviewId)||!revision(body.previousRevision)))throw 400;
 const key=body.requestId.toLowerCase(),intent={proposalId:body.proposalId,proposalRevision:body.proposalRevision,proposalHash:body.proposalHash,expiresAt:body.expiresAt,reason:body.reason.trim(),previousReviewId:body.previousReviewId??null,previousRevision:body.previousRevision??null},fingerprint=await hash({action:'PUBLISH',...intent}),prior=await receipt(db,actor,key,false,undefined,fingerprint);if(prior.state==='SAVED')return {...prior,replayed:true};
 if(expires<=Date.now()||expires>Date.now()+90*86400000)throw 400;
 const draft=await db.prepare(`${viewer(false)} SELECT d.* FROM commercial_drafts d WHERE d.id=? AND d.organization_id=? AND d.kind='PROPOSAL' AND ${authority}`).bind(actor.id,actor.organization_id,body.proposalId,actor.organization_id).first();if(!draft)throw 404;
 if(draft.status!=='DRAFT'||draft.revision!==body.proposalRevision||draft.content_hash!==body.proposalHash)throw 409;
 const source=JSON.parse(draft.snapshot_json),project=draft.project_id?await db.prepare('SELECT id,name,revision,client_id,client_visible FROM projects WHERE id=? AND organization_id=?').bind(draft.project_id,actor.organization_id).first():null;
 if(draft.project_id&&(!project||project.client_id!==draft.client_id||project.client_visible!==1))throw 409;
 const client=await db.prepare('SELECT id,name,revision FROM clients WHERE id=? AND organization_id=?').bind(draft.client_id,actor.organization_id).first();if(!client)throw 404;
 if(source.id!==draft.id||source.kind!=='PROPOSAL'||source.revision!==draft.revision||source.clientId!==draft.client_id||source.projectId!==draft.project_id||source.contentHash!==draft.content_hash||await hash({kind:source.kind,title:source.title,content:source.content,targets:source.targets,source:source.source})!==draft.content_hash)throw 409;
 if(source.targets.client?.id!==client.id||source.targets.client.name!==client.name||source.targets.client.revision!==client.revision||project&&(source.targets.project?.id!==project.id||source.targets.project.name!==project.name||source.targets.project.revision!==project.revision)||!project&&source.targets.project!==null)throw 409;
 const version=await db.prepare('SELECT state_json FROM commercial_versions WHERE draft_id=? AND organization_id=? AND revision=?').bind(draft.id,actor.organization_id,draft.revision).first();if(version?.state_json!==draft.snapshot_json)throw 409;
 const old=await db.prepare('SELECT * FROM proposal_reviews WHERE organization_id=? AND proposal_id=? ORDER BY round_number DESC LIMIT 1').bind(actor.organization_id,draft.id).first();
 if(old?(old.id!==body.previousReviewId||old.revision!==body.previousRevision):body.previousReviewId!==undefined)throw 409;
 if(old&&(!revision(old.revision)||!Number.isSafeInteger(old.round_number)||old.round_number>=max))throw 409;
 const snapshot={version:1,proposalId:draft.id,proposalRevision:draft.revision,title:source.title,client:{id:client.id,name:client.name},project:project?{id:project.id,name:project.name}:null,content:source.content},contentHash=await hash(snapshot),reviewId=crypto.randomUUID(),token=crypto.randomUUID(),oldToken=old?token+'-prior':null,now=Date.now();
 const guards=[authority,requestGuard(),"EXISTS(SELECT 1 FROM commercial_drafts d WHERE d.id=? AND d.organization_id=? AND d.kind='PROPOSAL' AND d.status='DRAFT' AND d.revision=? AND d.content_hash=? AND d.snapshot_json=? AND d.client_id=? AND d.project_id IS ?)",'EXISTS(SELECT 1 FROM clients WHERE id=? AND organization_id=? AND name=? AND revision=?)',`?>${clock}`],values=[actor.id,actor.organization_id,...requestValues(actor,key,false),draft.id,actor.organization_id,draft.revision,draft.content_hash,draft.snapshot_json,draft.client_id,draft.project_id,client.id,actor.organization_id,client.name,client.revision,expires];
 guards.push('EXISTS(SELECT 1 FROM commercial_versions WHERE draft_id=? AND organization_id=? AND revision=? AND state_json=?)');values.push(draft.id,actor.organization_id,draft.revision,draft.snapshot_json);
 if(project){guards.push('EXISTS(SELECT 1 FROM projects WHERE id=? AND organization_id=? AND client_id=? AND client_visible=1 AND name=? AND revision=?)');values.push(project.id,actor.organization_id,client.id,project.name,project.revision);}
 if(old){guards.push('EXISTS(SELECT 1 FROM proposal_reviews WHERE id=? AND organization_id=? AND proposal_id=? AND revision=? AND round_number=?)','NOT EXISTS(SELECT 1 FROM proposal_reviews WHERE organization_id=? AND proposal_id=? AND round_number>?)');values.push(old.id,actor.organization_id,draft.id,old.revision,old.round_number,actor.organization_id,draft.id,old.round_number);}else{guards.push('NOT EXISTS(SELECT 1 FROM proposal_reviews WHERE organization_id=? AND proposal_id=?)');values.push(actor.organization_id,draft.id);}
 const statement=db.prepare(`${viewer(false)} INSERT INTO proposal_reviews(id,organization_id,proposal_id,client_id,project_id,source_revision,source_hash,content_hash,snapshot_json,round_number,status,expires_at,created_by,created_at,revision,write_token) SELECT ?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?,0,? WHERE ${guards.join(' AND ')} RETURNING id`).bind(...values.slice(0,2),reviewId,actor.organization_id,draft.id,draft.client_id,draft.project_id,draft.revision,draft.content_hash,contentHash,JSON.stringify(snapshot),(old?.round_number??0)+1,expires,actor.id,now,token,...values.slice(2));
 const statements=[statement];if(old){statements.push(db.prepare("UPDATE proposal_reviews SET status=CASE WHEN status='OPEN' THEN 'SUPERSEDED' ELSE status END,superseded_by=?,revision=revision+1,write_token=? WHERE id=? AND organization_id=? AND revision=? AND EXISTS(SELECT 1 FROM proposal_reviews newer WHERE newer.id=? AND newer.organization_id=proposal_reviews.organization_id AND newer.write_token=?) RETURNING id").bind(reviewId,oldToken,old.id,actor.organization_id,old.revision,reviewId,token),event(db,actor,old.id,oldToken,'SUPERSEDE',intent.reason,null,false,token));}
 statements.push(event(db,actor,reviewId,token,'PUBLISH',intent.reason,{key,fingerprint},false),fence(db,actor,reviewId,token,oldToken));
 return commit(db,actor,statements,key,false,undefined,fingerprint);
}
async function mutate(db,actor,reviewId,client,body){
 strict(body,client?['requestId','revision','contentHash','decision','comment','acknowledged']:['requestId','revision','reason']);
 if(!uuid(body.requestId)||!revision(body.revision))throw 400;
 if(client){if(!digest(body.contentHash)||!['APPROVED','DECLINED','CHANGES_REQUESTED'].includes(body.decision)||body.acknowledged!==true||!text(body.comment,2000,body.decision!=='CHANGES_REQUESTED'))throw 400;}else if(!text(body.reason,2000))throw 400;
 const key=body.requestId.toLowerCase(),intent=client?{reviewId,revision:body.revision,contentHash:body.contentHash,decision:body.decision,comment:body.comment,acknowledged:true}:{reviewId,revision:body.revision,reason:body.reason.trim()},fingerprint=await hash({action:client?'RESPOND':'REVOKE',...intent}),prior=await receipt(db,actor,key,client,client?reviewId:undefined,fingerprint);if(prior.state==='SAVED')return {...prior,replayed:true};
 await get(db,actor,reviewId,client);const token=crypto.randomUUID(),now=Date.now();let statement,action;
 if(client){action={APPROVED:'APPROVE',DECLINED:'DECLINE',CHANGES_REQUESTED:'REQUEST_CHANGES'}[body.decision];statement=db.prepare(`${viewer(true)} UPDATE proposal_reviews AS r SET status=?,decision_actor_id=(SELECT id FROM review_viewer),decision_actor_email=(SELECT email FROM review_viewer),decision_at=?,decision_comment=?,decision_acknowledged=1,revision=revision+1,write_token=? WHERE r.id=? AND r.organization_id=? AND r.revision=? AND r.content_hash=? AND r.status='OPEN' AND ${portalScope} AND ${sourceLive} AND ${latest} AND r.expires_at>${clock} AND ${requestGuard()} RETURNING id`).bind(actor.id,actor.organization_id,body.decision,now,body.comment,token,reviewId,actor.organization_id,body.revision,body.contentHash,...requestValues(actor,key,true));}
 else{action='REVOKE';statement=db.prepare(`${viewer(false)} UPDATE proposal_reviews SET revoked_at=?,revoked_by=?,revocation_reason=?,revision=revision+1,write_token=? WHERE id=? AND organization_id=? AND revision=? AND revoked_at IS NULL AND ${authority} AND ${requestGuard()} RETURNING id`).bind(actor.id,actor.organization_id,now,actor.id,intent.reason,token,reviewId,actor.organization_id,body.revision,...requestValues(actor,key,false));}
 return commit(db,actor,[statement,event(db,actor,reviewId,token,action,client?null:intent.reason,{key,fingerprint},client),fence(db,actor,reviewId,token)],key,client,client?reviewId:undefined,fingerprint);
}
async function cancel(db,actor,key,client,reviewId){
 const prior=await receipt(db,actor,key,client,reviewId);if(prior.state!=='UNKNOWN')return prior;
 await db.prepare(`${viewer(client)} INSERT INTO cancelled_proposal_review_requests(id,organization_id,request_scope,request_key,actor_id,review_id,created_at) SELECT ?,?,?,?,?,?,? WHERE ${authority} ${client?'AND EXISTS(SELECT 1 FROM proposal_reviews r WHERE r.id=? AND r.organization_id=? AND '+portalScope+')':''} AND NOT EXISTS(SELECT 1 FROM proposal_review_events WHERE organization_id=? AND request_scope=? AND request_key=?) ON CONFLICT(organization_id,request_scope,request_key) DO NOTHING RETURNING id`)
 .bind(actor.id,actor.organization_id,crypto.randomUUID(),actor.organization_id,keyScope(actor,client),key,actor.id,reviewId??null,Date.now(),...(client?[reviewId,actor.organization_id]:[]),actor.organization_id,keyScope(actor,client),key).all();
 return receipt(db,actor,key,client,reviewId);
}
export function reviewExportStatement(db,actor,table){const selection=table==='proposal_reviews'?columns:table==='proposal_review_events'?'id,review_id,organization_id,actor_id,actor_email,recorded_at,revision,action,reason,state_json,causation_id':'id,organization_id,request_scope,request_key,actor_id,review_id,created_at';return db.prepare(`${viewer(false)} SELECT ${selection} FROM ${table} WHERE organization_id=? AND ${authority} ORDER BY id LIMIT 1001`).bind(actor.id,actor.organization_id,actor.organization_id);}

export async function proposalReviewsRoute(request,db,actor,readBody,json){
 const url=new URL(request.url),client=url.pathname.startsWith('/api/portal/'),prefix=client?'/api/portal/proposals':'/api/proposal-reviews',rest=url.pathname.slice(prefix.length);if(!url.pathname.startsWith(prefix))throw 404;
 await allowed(db,actor,client);
 const staffKey=!client&&rest.match(/^\/requests\/([^/]+)(\/cancel)?$/),clientKey=client&&rest.match(/^\/([a-zA-Z0-9-]{1,100})\/requests\/([^/]+)(\/cancel)?$/);
 if(staffKey||clientKey){const key=client?clientKey[2]:staffKey[1],reviewId=client?clientKey[1]:undefined,stop=client?clientKey[3]:staffKey[2];if(!uuid(key)||url.search)throw 400;if(request.method!==(stop?'POST':'GET'))throw 405;if(stop)strict(await readBody(request),[]);return json(stop?await cancel(db,actor,key.toLowerCase(),client,reviewId):await receipt(db,actor,key.toLowerCase(),client,reviewId));}
 const match=rest.match(/^(?:\/([a-zA-Z0-9-]{1,100})(?:\/(respond|revoke|history))?)?$/);if(!match)throw 404;
 const reviewId=match[1],operation=match[2];if(client&&operation&&operation!=='respond'||!client&&operation==='respond')throw 404;
 if(request.method==='GET'){
  if(operation&&operation!=='history')throw 405;
  if(!reviewId){query(url,['proposalId','clientId','projectId','after']);if(client&&url.searchParams.has('clientId'))throw 400;const params=[actor.id,actor.organization_id,actor.organization_id],conditions=['r.organization_id=?',client?portalScope:authority];for(const [key,column,operator]of [['proposalId','proposal_id','='],['clientId','client_id','='],['projectId','project_id','='],['after','id','>']]){const value=url.searchParams.get(key);if(value!==null){if(!id(value))throw 400;conditions.push('r.'+column+operator+'?');params.push(value);}}const result=(await db.prepare(`${viewer(client)} SELECT r.*,${latest} AS is_latest,${sourceLive} AS source_live FROM proposal_reviews r WHERE ${conditions.join(' AND ')} ORDER BY r.id LIMIT 51`).bind(...params).all()).results;await allowed(db,actor,client);const items=result.slice(0,50).map(row=>{const full=view(row,actor,client);return {id:full.id,proposalId:full.proposalId,title:full.snapshot.title,proposalRevision:full.proposalRevision,round:full.round,state:full.state,revision:full.revision,expiresAt:full.expiresAt,isLatest:full.isLatest,canRespond:full.canRespond,currency:full.snapshot.content.currency,totalMinor:full.snapshot.content.totals.totalMinor};});return json({items,nextCursor:result.length>50?items.at(-1).id:null});}
  const row=await get(db,actor,reviewId,client);if(!operation){if(url.search)throw 400;return json(view(row,actor,client));}
  query(url,['before']);const before=url.searchParams.get('before');if(before!==null&&(!/^\d{1,16}$/.test(before)||!revision(Number(before))))throw 400;
  const result=(await db.prepare(`${viewer(false)} SELECT * FROM proposal_review_events WHERE organization_id=? AND review_id=? AND ${authority} ${before!==null?'AND revision<?':''} ORDER BY revision DESC LIMIT 51`).bind(actor.id,actor.organization_id,actor.organization_id,reviewId,...(before!==null?[Number(before)]:[])).all()).results;
  const items=result.slice(0,50).map(e=>({revision:e.revision,action:e.action,reason:e.reason,actorId:e.actor_id,actorEmail:e.actor_email,recordedAt:e.recorded_at,state:view(JSON.parse(e.state_json),actor,false,true,e.recorded_at)}));return json({items,currentRevision:row.revision,nextCursor:result.length>50?String(items.at(-1).revision):null});
 }
 if(url.search)throw 400;if(request.method!=='POST')throw 405;
 const body=await readBody(request);if(!client&&!reviewId){const result=await publish(db,actor,body);return json(result.review,result.replayed?200:201);}if(reviewId&&operation===(client?'respond':'revoke'))return json((await mutate(db,actor,reviewId,client,body)).review);throw 405;
}
