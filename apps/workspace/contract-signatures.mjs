import {readContractPublication,assertContractAuthority} from './contract-publications.mjs';

const encoder=new TextEncoder(),hex=bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
const canonical=value=>JSON.stringify(value);
const sha=async value=>hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value));
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
function strict(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw 400;}
function parse(value){try{return JSON.parse(value);}catch{throw 503;}}
async function policy(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||Object.keys(value).some(k=>!['version','consentText','authorityText','privacyText'].includes(k))||!id(value.version))throw 503;
 for(const name of ['consentText','authorityText','privacyText'])if(typeof value[name]!=='string'||!value[name].trim()||value[name].length>4000||value[name].includes('\0'))throw 503;
 const frozen={version:value.version,consentText:value.consentText,authorityText:value.authorityText,privacyText:value.privacyText};return {...frozen,hash:await sha(canonical(frozen))};
}
export async function readSigningPolicy(env){return env.CONTRACT_SIGNING_POLICY===undefined||env.CONTRACT_SIGNING_POLICY===null?null:policy(parse(env.CONTRACT_SIGNING_POLICY));}
async function frozenPolicy(row){
 if(row.signing_policy_json===null&&row.signing_policy_hash===null)return null;
 const saved=parse(row.signing_policy_json);if(!saved||typeof saved!=='object'||Array.isArray(saved))throw 503;const {hash:storedHash,...source}=saved,validated=await policy(source);
 if(storedHash!==validated.hash||row.signing_policy_hash!==validated.hash)throw 503;return validated;
}
function keyBytes(env,keyId){
 const keys=parse(env.CONTRACT_EVIDENCE_KEYS);if(!keys||Array.isArray(keys)||typeof keys!=='object'||!Object.keys(keys).length||Object.keys(keys).length>20)throw 503;
 for(const [name,value]of Object.entries(keys))if(!id(name)||typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw 503;
 const encoded=keys[keyId];if(!encoded)throw 503;let bytes;try{bytes=Uint8Array.from(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')+'='),c=>c.charCodeAt(0));}catch{throw 503;}if(bytes.length!==32)throw 503;return bytes;
}
async function hmac(env,keyId,value){const key=await crypto.subtle.importKey('raw',keyBytes(env,keyId),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));}
function storage(env){if(!env.FILES||!['get','put','head'].every(k=>typeof env.FILES[k]==='function'))throw 503;}
function activeKey(env){storage(env);if(!id(env.CONTRACT_EVIDENCE_KEY_ID))throw 503;keyBytes(env,env.CONTRACT_EVIDENCE_KEY_ID);return env.CONTRACT_EVIDENCE_KEY_ID;}
async function bytesFor(env,row){
 storage(env);let object,head,bytes;try{head=await env.FILES.head(row.object_key);if(!head||head.size!==row.document_size||head.size>2*1024*1024)throw 503;object=await env.FILES.get(row.object_key);if(!object||object.size!==row.document_size)throw 503;bytes=await object.arrayBuffer();}catch{throw 503;}
 if(bytes.byteLength!==row.document_size||await sha(bytes)!==row.document_sha256)throw 503;return bytes;
}
function resultFor(evidence,evidenceHash,documentHash,size){return {id:evidence.signatureId,publicationId:evidence.publicationId,state:'SIGNED',signedAt:evidence.signedAt,signer:evidence.signer,publicationRevision:evidence.signedRevision,contentHash:evidence.contentHash,policyHash:evidence.policyHash,signatureHash:evidence.signatureHash,evidenceHash,document:{sha256:documentHash,size,format:'application/json'}};}
async function verifyMetadata(env,row,publication,event){
 if(publication.id!==row.publication_id||publication.organization_id!==row.organization_id)throw 503;
 const evidence=parse(row.evidence_json);if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||canonical(evidence)!==row.evidence_json||await hmac(env,row.key_id,row.evidence_json)!==row.hmac||await sha(row.evidence_json)!==row.evidence_hash)throw 503;
 const document=canonical({evidence,evidenceHash:row.evidence_hash,keyId:row.key_id,hmac:row.hmac});
 if(encoder.encode(document).byteLength!==row.document_size||await sha(document)!==row.document_sha256)throw 503;
 const bindings={signatureId:row.id,publicationId:row.publication_id,organizationId:row.organization_id,contractId:row.contract_id,clientId:row.client_id,projectId:row.project_id,publicationRevision:row.source_revision,contentHash:row.content_hash,policyHash:row.policy_hash,signedAt:row.signed_at,signatureHash:row.signature_hash};
 for(const [key,value]of Object.entries(bindings))if(evidence[key]!==value)throw 503;
 if(evidence.signedRevision!==row.source_revision+1||evidence.signer?.actorId!==row.actor_id||evidence.signer?.email!==row.actor_email||evidence.signer?.name!==row.signer_name||evidence.signer?.type!=='TYPED'||evidence.signer?.text!==row.signer_name||evidence.observed?.ip!==row.observed_ip||evidence.observed?.userAgent!==row.observed_user_agent||await sha(canonical({type:'TYPED',text:row.signer_name}))!==row.signature_hash)throw 503;
 const consent=await frozenPolicy(publication);
 if(!consent||evidence.version!==1||!uuid(evidence.nonce)||evidence.consentAccepted!==true||evidence.authorityAccepted!==true||evidence.contractRevision!==publication.source_revision||evidence.sourceHash!==publication.source_hash||canonical(evidence.policy)!==canonical(consent)||canonical(evidence.snapshot)!==publication.snapshot_json||publication.content_hash!==row.content_hash||publication.contract_id!==row.contract_id||publication.client_id!==row.client_id||publication.project_id!==row.project_id||publication.revision!==evidence.signedRevision||publication.status!=='PENDING'||await sha(publication.snapshot_json)!==row.content_hash)throw 503;
 const result=resultFor(evidence,row.evidence_hash,row.document_sha256,row.document_size);if(canonical(result)!==row.state_json)throw 503;
 if(!event||event.signature_id!==row.id||event.publication_id!==row.publication_id||event.organization_id!==row.organization_id||event.action!=='SIGN'||event.revision!==evidence.signedRevision||event.actor_id!==row.actor_id||event.actor_email!==row.actor_email||event.recorded_at!==row.signed_at||event.state_json!==row.state_json)throw 503;
 const recorded=parse(event.publication_state_json);if(!recorded||typeof recorded!=='object'||Array.isArray(recorded))throw 503;for(const field of ['id','organization_id','contract_id','client_id','project_id','source_revision','source_hash','content_hash','snapshot_json','status','revision','signing_policy_json','signing_policy_hash'])if(recorded[field]!==publication[field])throw 503;
 return {result,document};
}
async function verified(env,actor,row,client){
 let publication=await readContractPublication(env.DB,actor,row.publication_id,client);
 const bytes=await bytesFor(env,row),event=await env.DB.prepare('SELECT * FROM contract_signature_events WHERE signature_id=? AND publication_id=? AND organization_id=?').bind(row.id,row.publication_id,row.organization_id).first(),metadata=await verifyMetadata(env,row,publication,event);
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw 503;}if(text!==metadata.document)throw 503;
 publication=await readContractPublication(env.DB,actor,row.publication_id,client);if(publication.revision!==row.source_revision+1||publication.content_hash!==row.content_hash||publication.status!=='PENDING')throw 503;
 const result=metadata.result;
 return {result,bytes,publication};
}
export async function decorateSignature(env,actor,row,client){
 const signature=await env.DB.prepare('SELECT * FROM contract_signatures WHERE publication_id=? AND organization_id=?').bind(row.id,actor.organization_id).first();
 if(!signature){const fresh=await readContractPublication(env.DB,actor,row.id,client);if(fresh.revision!==row.revision)throw 409;return fresh;}const value=await verified(env,actor,signature,client);return {...value.publication,state_override:'SIGNED',signature_public:value.result};
}
// The caller owns fresh scoped pre/post list queries. Lists verify persisted evidence,
// while signed detail/download endpoints separately verify the private R2 bytes.
export async function decorateSignatures(env,actor,rows,client){
 if(!Array.isArray(rows)||rows.length>50||rows.some(row=>row.organization_id!==actor.organization_id))throw 503;if(!rows.length)return [];
 const ids=rows.map(row=>row.id),placeholders=ids.map(()=>'?').join(',');if(new Set(ids).size!==ids.length)throw 503;
 const signatures=(await env.DB.prepare(`SELECT * FROM contract_signatures WHERE organization_id=? AND publication_id IN (${placeholders}) ORDER BY publication_id LIMIT 51`).bind(actor.organization_id,...ids).all()).results;
 const events=(await env.DB.prepare(`SELECT * FROM contract_signature_events WHERE organization_id=? AND publication_id IN (${placeholders}) ORDER BY publication_id LIMIT 51`).bind(actor.organization_id,...ids).all()).results;
 if(signatures.length>50||events.length>50)throw 503;
 const byPublication=new Map(),bySignature=new Map();for(const signature of signatures){if(byPublication.has(signature.publication_id))throw 503;byPublication.set(signature.publication_id,signature);}for(const event of events){if(bySignature.has(event.signature_id))throw 503;bySignature.set(event.signature_id,event);}
 return Promise.all(rows.map(async row=>{const signature=byPublication.get(row.id);if(!signature)return row;if(revision(signature.source_revision)&&signature.source_revision+1!==row.revision)throw 409;const metadata=await verifyMetadata(env,signature,row,bySignature.get(signature.id));return {...row,state_override:'SIGNED',signature_public:metadata.result,document_verification:'NOT_CHECKED'};}));
}
const viewer=client=>`WITH signature_viewer AS (SELECT a.id,a.email,a.client_id FROM actors a ${client?'':'JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id'} WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='${client?'client':'staff'}' ${client?'AND a.client_id IS ?':''})`;
const viewerValues=(actor,client)=>[actor.id,actor.organization_id,...(client?[actor.client_id]:[])];
const scope=`EXISTS(SELECT 1 FROM signature_viewer v WHERE v.client_id=r.client_id) AND r.status='PENDING' AND EXISTS(SELECT 1 FROM clients c WHERE c.id=r.client_id AND c.organization_id=r.organization_id) AND (r.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=r.project_id AND p.organization_id=r.organization_id AND p.client_id=r.client_id AND p.client_visible=1))`;
const guard=`NOT EXISTS(SELECT 1 FROM contract_signatures WHERE organization_id=? AND actor_id=? AND request_key=?) AND NOT EXISTS(SELECT 1 FROM cancelled_contract_signature_requests WHERE organization_id=? AND actor_id=? AND request_key=?)`;
const guardValues=(actor,key)=>[actor.organization_id,actor.id,key,actor.organization_id,actor.id,key];
async function receipt(env,actor,publicationId,key,fingerprint){
 const publication=await readContractPublication(env.DB,actor,publicationId,true),saved=await env.DB.prepare('SELECT * FROM contract_signatures WHERE organization_id=? AND actor_id=? AND request_key=?').bind(actor.organization_id,actor.id,key).first();
 if(saved){if(saved.publication_id!==publicationId||fingerprint!==undefined&&saved.request_fingerprint!==fingerprint)throw 409;const value=await verified(env,actor,saved,true);return {state:'SAVED',signature:value.result,currentRevision:value.publication.revision};}
 const cancelled=await env.DB.prepare('SELECT publication_id FROM cancelled_contract_signature_requests WHERE organization_id=? AND actor_id=? AND request_key=?').bind(actor.organization_id,actor.id,key).first();
 await readContractPublication(env.DB,actor,publicationId,true);if(cancelled&&cancelled.publication_id!==publicationId)throw 409;return cancelled?{state:'CANCELLED'}:{state:'UNKNOWN'};
}
async function cancel(env,actor,publicationId,key){
 const prior=await receipt(env,actor,publicationId,key);if(prior.state!=='UNKNOWN')return prior;
 await env.DB.prepare(`${viewer(true)} INSERT INTO cancelled_contract_signature_requests(id,publication_id,organization_id,actor_id,request_key,created_at) SELECT ?,r.id,r.organization_id,?,?,? FROM contract_publications r WHERE r.id=? AND r.organization_id=? AND ${scope} AND NOT EXISTS(SELECT 1 FROM contract_signatures WHERE organization_id=? AND actor_id=? AND request_key=?) ON CONFLICT(organization_id,actor_id,request_key) DO NOTHING RETURNING id`).bind(...viewerValues(actor,true),crypto.randomUUID(),actor.id,key,Date.now(),publicationId,actor.organization_id,actor.organization_id,actor.id,key).all();return receipt(env,actor,publicationId,key);
}
async function sign(request,env,actor,publicationId,body){
 strict(body,['requestId','revision','contentHash','policyHash','signerName','signatureText','consentAccepted','authorityAccepted']);
 if(!uuid(body.requestId)||!revision(body.revision)||!digest(body.contentHash)||!digest(body.policyHash)||typeof body.signerName!=='string'||!body.signerName.trim()||body.signerName!==body.signerName.trim()||body.signerName.length>200||/[\p{Cc}\p{Cf}]/u.test(body.signerName)||body.signatureText!==body.signerName||body.consentAccepted!==true||body.authorityAccepted!==true)throw 400;
 const key=body.requestId.toLowerCase(),fingerprint=await sha(canonical({publicationId,revision:body.revision,contentHash:body.contentHash,policyHash:body.policyHash,signerName:body.signerName,signatureText:body.signatureText,consentAccepted:true,authorityAccepted:true})),prior=await receipt(env,actor,publicationId,key,fingerprint);if(prior.state==='SAVED')return prior.signature;if(prior.state==='CANCELLED')throw 409;
 const publication=await readContractPublication(env.DB,actor,publicationId,true),consent=await frozenPolicy(publication);if(!consent)throw 503;const keyId=activeKey(env);
 if(publication.revision!==body.revision||publication.content_hash!==body.contentHash||consent.hash!==body.policyHash||publication.status!=='PENDING'||await sha(publication.snapshot_json)!==publication.content_hash)throw 409;
 if(await env.DB.prepare('SELECT id FROM contract_signatures WHERE publication_id=? AND organization_id=?').bind(publicationId,actor.organization_id).first())throw 409;
 const signer=await env.DB.prepare("SELECT id,email FROM actors WHERE id=? AND organization_id=? AND active=1 AND role='client' AND client_id IS ?").bind(actor.id,actor.organization_id,actor.client_id).first();if(!signer)throw 403;
 const signatureId=crypto.randomUUID(),signedAt=Date.now(),signatureHash=await sha(canonical({type:'TYPED',text:body.signerName})),observed={ip:(request.headers.get('cf-connecting-ip')||'').slice(0,128),userAgent:(request.headers.get('user-agent')||'').slice(0,512)};
 const evidence={version:1,signatureId,publicationId,organizationId:actor.organization_id,contractId:publication.contract_id,contractRevision:publication.source_revision,sourceHash:publication.source_hash,clientId:publication.client_id,projectId:publication.project_id,publicationRevision:publication.revision,signedRevision:publication.revision+1,contentHash:publication.content_hash,snapshot:parse(publication.snapshot_json),policy:consent,policyHash:consent.hash,consentAccepted:true,authorityAccepted:true,signer:{name:body.signerName,actorId:signer.id,email:signer.email,type:'TYPED',text:body.signatureText},signatureHash,signedAt,observed,nonce:crypto.randomUUID()},evidenceJson=canonical(evidence),evidenceHash=await sha(evidenceJson),mac=await hmac(env,keyId,evidenceJson),document=canonical({evidence,evidenceHash,keyId,hmac:mac}),bytes=encoder.encode(document),documentHash=await sha(bytes),objectKey='contract-evidence/'+crypto.randomUUID(),result=resultFor(evidence,evidenceHash,documentHash,bytes.length);
 const staged={object_key:objectKey,document_sha256:documentHash,document_size:bytes.length};
 try{if(!await env.FILES.put(objectKey,bytes,{sha256:documentHash,httpMetadata:{contentType:'application/json'}}))throw 503;await bytesFor(env,staged);}catch{throw 503;}
 // R2 is staged first. Lost races leave a private unreachable object, never a signed record.
 await readContractPublication(env.DB,actor,publicationId,true);
 const token=crypto.randomUUID(),statement=env.DB.prepare(`${viewer(true)} UPDATE contract_publications AS r SET revision=revision+1,write_token=? WHERE r.id=? AND r.organization_id=? AND r.revision=? AND r.content_hash=? AND r.snapshot_json=? AND r.signing_policy_hash=? AND r.signing_policy_json=? AND ${scope} AND EXISTS(SELECT 1 FROM signature_viewer WHERE email=?) AND ${guard} AND NOT EXISTS(SELECT 1 FROM contract_signatures WHERE organization_id=r.organization_id AND (publication_id=r.id OR contract_id=r.contract_id)) RETURNING id`).bind(...viewerValues(actor,true),token,publicationId,actor.organization_id,publication.revision,publication.content_hash,publication.snapshot_json,consent.hash,publication.signing_policy_json,signer.email,...guardValues(actor,key));
 const insert=env.DB.prepare(`${viewer(true)} INSERT INTO contract_signatures(id,publication_id,organization_id,contract_id,client_id,project_id,source_revision,content_hash,policy_hash,actor_id,actor_email,signer_name,signed_at,signature_hash,evidence_hash,evidence_json,object_key,document_sha256,document_size,key_id,hmac,observed_ip,observed_user_agent,state_json,request_key,request_fingerprint) SELECT ?,r.id,r.organization_id,r.contract_id,r.client_id,r.project_id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM contract_publications r WHERE r.id=? AND r.organization_id=? AND r.write_token=? AND ${scope} AND EXISTS(SELECT 1 FROM signature_viewer WHERE email=?) AND ${guard} RETURNING id`).bind(...viewerValues(actor,true),signatureId,publication.revision,publication.content_hash,consent.hash,actor.id,signer.email,body.signerName,signedAt,signatureHash,evidenceHash,evidenceJson,objectKey,documentHash,bytes.length,keyId,mac,observed.ip,observed.userAgent,canonical(result),key,fingerprint,publicationId,actor.organization_id,token,signer.email,...guardValues(actor,key));
 const publicationColumns='id,organization_id,contract_id,client_id,project_id,source_revision,source_hash,content_hash,snapshot_json,status,revision,created_by,created_at,withdrawn_at,withdrawn_by,withdrawal_reason,signing_policy_json,signing_policy_hash';
 const image=`json_object(${publicationColumns.split(',').map(c=>`'${c}',r.${c}`).join(',')})`;
 const event=env.DB.prepare(`INSERT INTO contract_signature_events(id,signature_id,publication_id,organization_id,revision,action,actor_id,actor_email,recorded_at,state_json,publication_state_json) SELECT ?,s.id,r.id,r.organization_id,r.revision,'SIGN',s.actor_id,s.actor_email,s.signed_at,s.state_json,${image} FROM contract_publications r JOIN contract_signatures s ON s.publication_id=r.id AND s.organization_id=r.organization_id WHERE r.id=? AND r.organization_id=? AND r.write_token=? AND s.id=? RETURNING id`).bind(token,publicationId,actor.organization_id,token,signatureId);
 const fence=env.DB.prepare('UPDATE contract_publications SET write_token=CASE WHEN EXISTS(SELECT 1 FROM contract_signatures s JOIN contract_signature_events e ON e.signature_id=s.id AND e.publication_id=s.publication_id AND e.organization_id=s.organization_id WHERE s.id=? AND s.publication_id=contract_publications.id AND s.organization_id=contract_publications.organization_id AND e.id=?) THEN write_token ELSE NULL END WHERE id=? AND organization_id=? AND write_token=? RETURNING id').bind(signatureId,token,publicationId,actor.organization_id,token);
 try{await env.DB.batch([statement,insert,event,fence]);}catch(error){const recovered=await receipt(env,actor,publicationId,key,fingerprint);if(recovered.state==='SAVED')return recovered.signature;throw error;}
 const saved=await receipt(env,actor,publicationId,key,fingerprint);if(saved.state!=='SAVED')throw 409;return saved.signature;
}
export function contractSignatureExportStatement(db,actor,table){
 const fields={contract_signatures:'id,publication_id,organization_id,contract_id,client_id,project_id,source_revision,content_hash,policy_hash,actor_id,actor_email,signer_name,signed_at,signature_hash,evidence_hash,evidence_json,document_sha256,document_size,key_id,observed_ip,observed_user_agent,state_json',contract_signature_events:'id,signature_id,publication_id,organization_id,revision,action,actor_id,actor_email,recorded_at,state_json,publication_state_json',cancelled_contract_signature_requests:'id,publication_id,organization_id,actor_id,created_at'};if(!fields[table])throw 400;
 return db.prepare(`${viewer(false)} SELECT ${fields[table]} FROM ${table} WHERE organization_id=? AND EXISTS(SELECT 1 FROM signature_viewer) ORDER BY id LIMIT 1001`).bind(...viewerValues(actor,false),actor.organization_id);
}
export async function contractSignaturesRoute(request,env,actor,readBody,json){
 const url=new URL(request.url),client=url.pathname.startsWith('/api/portal/');await assertContractAuthority(env.DB,actor,client);
 const match=url.pathname.match(/^\/api\/(?:portal\/contracts|contract-publications)\/([a-zA-Z0-9-]{1,100})\/(signing|signature|signed-document|requests\/([^/]+)(\/cancel)?)$/);if(!match||url.search)throw 404;
 const publicationId=match[1],operation=match[2];if(!client&&operation.startsWith('requests/'))throw 404;
 const row=await readContractPublication(env.DB,actor,publicationId,client);
 if(operation.startsWith('requests/')){if(!uuid(match[3]))throw 400;if(request.method!==(match[4]?'POST':'GET'))throw 405;if(match[4])strict(await readBody(request),[]);return json(match[4]?await cancel(env,actor,publicationId,match[3].toLowerCase()):await receipt(env,actor,publicationId,match[3].toLowerCase()));}
 if(operation==='signing'&&request.method==='POST'){if(!client)throw 403;return json(await sign(request,env,actor,publicationId,await readBody(request)));}
 if(request.method!=='GET')throw 405;
 const saved=await env.DB.prepare('SELECT * FROM contract_signatures WHERE publication_id=? AND organization_id=?').bind(publicationId,actor.organization_id).first();
 if(operation==='signing'){
  const consent=await frozenPolicy(row);let signingAvailable=false;if(!saved&&consent&&row.status==='PENDING'){try{activeKey(env);signingAvailable=true;}catch{}}const canSign=client&&signingAvailable;
  const value=saved?await verified(env,actor,saved,client):null,fresh=await readContractPublication(env.DB,actor,publicationId,client);
  if(!saved&&fresh.revision!==row.revision)throw 409;
  return json({state:saved?'SIGNED':fresh.status,canSign,signingAvailable,policy:consent,publicationRevision:fresh.revision,contentHash:fresh.content_hash,...(value?{signature:value.result}:{})});
 }
 if(!saved)throw 404;const value=await verified(env,actor,saved,client);if(operation==='signature')return json(value.result);
 const response=json(null);return new Response(value.bytes,{headers:{...Object.fromEntries(response.headers),'Content-Type':'application/json; charset=utf-8','Content-Length':String(value.bytes.byteLength),'Content-Disposition':`attachment; filename="signed-contract-${publicationId}.json"`,'Content-Security-Policy':"default-src 'none'; sandbox"}});
}
