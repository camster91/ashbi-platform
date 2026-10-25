import {readContractPublication} from './contract-publications.mjs';

const maxBytes=16*1024*1024,canonical=value=>JSON.stringify(value),digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const version=value=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(value),domain='ashbi.contract.pdf.v1\0';
function parse(value){try{return JSON.parse(value);}catch{throw 503;}}
function storage(env){if(!env.FILES||!['put','head','get'].every(name=>typeof env.FILES[name]==='function'))throw 503;}
function pdfBytes(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<100||bytes.length>maxBytes)throw 503;
 if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-'||!new TextDecoder().decode(bytes.subarray(-1024)).trimEnd().endsWith('%%EOF'))throw 503;
 return bytes;
}
async function storedBytes(env,row,hash){
 storage(env);let bytes;try{const head=await env.FILES.head(row.object_key);if(!head||!Number.isSafeInteger(head.size)||head.size!==row.pdf_size||head.size>maxBytes)throw 503;const object=await env.FILES.get(row.object_key);if(!object||object.size!==row.pdf_size)throw 503;bytes=new Uint8Array(await object.arrayBuffer());}catch{throw 503;}
 pdfBytes(bytes);if(bytes.length!==row.pdf_size||await hash(bytes)!==row.pdf_sha256)throw 503;return bytes;
}

// The PDF uses the frozen input hash. Its digest is then sealed into the signed
// JSON, avoiding a circular PDF -> JSON -> PDF digest dependency.
export async function stageContractPdf(env,evidence,{render,hash}){
 storage(env);try{
  const inputHash=await hash(canonical(evidence)),generatedAt=Date.now(),rendered=await render(evidence,inputHash,{generatedAt}),bytes=pdfBytes(rendered.bytes);
  if(!version(rendered.rendererVersion)||!version(rendered.fontVersion))throw 503;
  const marker={version:1,required:true,inputHash,sha256:await hash(bytes),size:bytes.length,rendererVersion:rendered.rendererVersion,fontVersion:rendered.fontVersion,generatedAt};
  const objectKey='contract-pdfs/'+crypto.randomUUID(),row={object_key:objectKey,pdf_sha256:marker.sha256,pdf_size:marker.size};
  if(!await env.FILES.put(objectKey,bytes,{sha256:marker.sha256,httpMetadata:{contentType:'application/pdf'}}))throw 503;
  await storedBytes(env,row,hash);return {id:crypto.randomUUID(),objectKey,marker};
 }catch{throw 503;}
}

export async function contractPdfStatements(db,{actor,signatureId,publication,token,staged,evidenceHash,jsonHash,keyId,mac}){
 const m=staged.marker,manifest={version:1,pdfId:staged.id,signatureId,publicationId:publication.id,organizationId:actor.organization_id,contractId:publication.contract_id,sourceHash:publication.source_hash,contentHash:publication.content_hash,policyHash:publication.signing_policy_hash,evidenceHash,jsonSha256:jsonHash,pdfSha256:m.sha256,pdfSize:m.size,inputHash:m.inputHash,rendererVersion:m.rendererVersion,fontVersion:m.fontVersion,generatedAt:m.generatedAt,keyId};
 const text=canonical(manifest),seal=await mac(keyId,domain+text);
 const insert=db.prepare(`INSERT INTO contract_signature_pdfs(id,signature_id,publication_id,organization_id,evidence_hash,json_sha256,pdf_sha256,pdf_size,object_key,renderer_version,font_version,manifest_json,key_id,hmac,created_at) SELECT ?,s.id,s.publication_id,s.organization_id,?,?,?,?,?,?,?,?,?,?,? FROM contract_signatures s JOIN contract_publications r ON r.id=s.publication_id AND r.organization_id=s.organization_id WHERE s.id=? AND s.organization_id=? AND r.id=? AND r.write_token=? AND s.evidence_hash=? AND s.document_sha256=? RETURNING id`).bind(staged.id,evidenceHash,jsonHash,m.sha256,m.size,staged.objectKey,m.rendererVersion,m.fontVersion,text,keyId,seal,m.generatedAt,signatureId,actor.organization_id,publication.id,token,evidenceHash,jsonHash);
 const event=db.prepare(`INSERT INTO contract_signature_pdf_events(id,pdf_id,signature_id,publication_id,organization_id,action,actor_id,actor_email,recorded_at,manifest_json) SELECT ?,p.id,s.id,s.publication_id,s.organization_id,'CREATE',s.actor_id,s.actor_email,p.created_at,p.manifest_json FROM contract_signature_pdfs p JOIN contract_signatures s ON s.id=p.signature_id AND s.organization_id=p.organization_id JOIN contract_publications r ON r.id=s.publication_id AND r.organization_id=s.organization_id WHERE p.id=? AND s.id=? AND s.organization_id=? AND r.write_token=? RETURNING id`).bind(token,staged.id,signatureId,actor.organization_id,token);
 return [insert,event];
}

async function validateMarker(evidence,hash){
 if(!Object.hasOwn(evidence,'pdf'))return null;const marker=evidence.pdf;
 const keys=['version','required','inputHash','sha256','size','rendererVersion','fontVersion','generatedAt'];
 if(!marker||typeof marker!=='object'||Array.isArray(marker)||Object.keys(marker).length!==keys.length||Object.keys(marker).some(key=>!keys.includes(key))||marker.version!==1||marker.required!==true||!digest(marker.inputHash)||!digest(marker.sha256)||!Number.isSafeInteger(marker.size)||marker.size<100||marker.size>maxBytes||!version(marker.rendererVersion)||!version(marker.fontVersion)||!Number.isSafeInteger(marker.generatedAt)||marker.generatedAt<evidence.signedAt)throw 503;
 const {pdf,...input}=evidence;if(await hash(canonical(input))!==marker.inputHash)throw 503;return marker;
}

// Call only with an already verified signed JSON artifact. The authenticated
// JSON marker determines whether a PDF is required; a missing row cannot turn
// a new signed PDF into a legacy JSON-only record.
export async function readContractPdf(env,actor,signature,jsonProof,client,{hash,verifyMac,reverifyJson}){
 const evidence=parse(signature.evidence_json),marker=await validateMarker(evidence,hash);
 const row=await env.DB.prepare('SELECT * FROM contract_signature_pdfs WHERE signature_id=? AND organization_id=?').bind(signature.id,actor.organization_id).first();
 const event=await env.DB.prepare('SELECT * FROM contract_signature_pdf_events WHERE signature_id=? AND organization_id=?').bind(signature.id,actor.organization_id).first();
 if(!marker){if(row||event)throw 503;await readContractPublication(env.DB,actor,signature.publication_id,client);return {metadata:{state:'UNAVAILABLE'}};}
 if(!row||!event)throw 503;
 const manifest=parse(row.manifest_json),expected={version:1,pdfId:row.id,signatureId:signature.id,publicationId:signature.publication_id,organizationId:signature.organization_id,contractId:signature.contract_id,sourceHash:evidence.sourceHash,contentHash:signature.content_hash,policyHash:signature.policy_hash,evidenceHash:signature.evidence_hash,jsonSha256:signature.document_sha256,pdfSha256:marker.sha256,pdfSize:marker.size,inputHash:marker.inputHash,rendererVersion:marker.rendererVersion,fontVersion:marker.fontVersion,generatedAt:marker.generatedAt,keyId:signature.key_id};
 if(canonical(manifest)!==canonical(expected)||canonical(manifest)!==row.manifest_json||row.publication_id!==signature.publication_id||row.evidence_hash!==signature.evidence_hash||row.json_sha256!==signature.document_sha256||row.pdf_sha256!==marker.sha256||row.pdf_size!==marker.size||row.renderer_version!==marker.rendererVersion||row.font_version!==marker.fontVersion||row.created_at!==marker.generatedAt||row.key_id!==signature.key_id||!digest(row.hmac)||!await verifyMac(row.key_id,domain+row.manifest_json,row.hmac))throw 503;
 if(event.pdf_id!==row.id||event.publication_id!==signature.publication_id||event.action!=='CREATE'||event.actor_id!==signature.actor_id||event.actor_email!==signature.actor_email||event.recorded_at!==marker.generatedAt||event.manifest_json!==row.manifest_json)throw 503;
 const bytes=await storedBytes(env,row,hash);
 // Re-read the original JSON artifact and SIGN journal after the PDF I/O. A
 // formerly valid cached proof must not conceal a now-missing original.
 const freshProof=await reverifyJson();
 const freshSignature=await env.DB.prepare('SELECT * FROM contract_signatures WHERE id=? AND organization_id=?').bind(signature.id,actor.organization_id).first();
 if(canonical(freshSignature)!==canonical(signature)||canonical(freshProof.event)!==canonical(jsonProof.event))throw 503;
 const freshRow=await env.DB.prepare('SELECT * FROM contract_signature_pdfs WHERE signature_id=? AND organization_id=?').bind(signature.id,actor.organization_id).first(),freshEvent=await env.DB.prepare('SELECT * FROM contract_signature_pdf_events WHERE signature_id=? AND organization_id=?').bind(signature.id,actor.organization_id).first();
 if(canonical(freshRow)!==canonical(row)||canonical(freshEvent)!==canonical(event))throw 409;
 const fresh=await readContractPublication(env.DB,actor,signature.publication_id,client);if(fresh.revision!==jsonProof.publication.revision||fresh.content_hash!==signature.content_hash||fresh.status!=='PENDING')throw 409;
 return {bytes,metadata:{state:'AVAILABLE',document:{format:'application/pdf',sha256:marker.sha256,size:marker.size,rendererVersion:marker.rendererVersion,fontVersion:marker.fontVersion,generatedAt:marker.generatedAt}}};
}
