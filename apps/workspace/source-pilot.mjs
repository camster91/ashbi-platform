// Internal adapter for a trusted reconcilePilot result and its pinned originals.
// Not an HTTP JSON import boundary. No Node imports, provider clients or grants.
import {hasFinance} from './time-details.mjs';
const sources=['notion','bonsai','legacy'],id=v=>typeof v==='string'&&/^[A-Za-z0-9-]{1,100}$/.test(v),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join('');
const hashText=s=>digest(new TextEncoder().encode(s));
const pathOK=p=>typeof p==='string'&&p.length>0&&p.length<=1000&&!/[\\:\p{Cc}\p{Cf}]/u.test(p)&&p.split('/').every(v=>v&&v!=='.'&&v!=='..');
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!v.includes('\0');
const receipt=run=>({id:run.id,state:run.state,fingerprint:run.fingerprint,counts:JSON.parse(run.report_json).counts});
const financeStatement=(db,actor)=>db.prepare(`SELECT EXISTS(SELECT 1 FROM actors a JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='staff') AS finance`).bind(actor.id,actor.organization_id);
async function authorize(db,actor,target){
 if(actor.role!=='staff')throw 403;
 // Permission and canonical scope must describe the same D1 snapshot.
 const [permission,scope]=await db.batch([financeStatement(db,actor),
  db.prepare('SELECT c.revision AS client_revision,p.revision AS project_revision FROM projects p JOIN clients c ON c.id=p.client_id AND c.organization_id=p.organization_id WHERE p.id=? AND p.organization_id=? AND p.client_id=?').bind(target.projectId,target.organizationId,target.clientId)
 ]);
 if(!permission.results[0]?.finance)throw 403;
 if(target.organizationId!==actor.organization_id)throw 404;
 const row=scope.results[0];if(!row)throw 404;return row;
}
function guard(db,actor,run,token){
 // CHECK failure rolls the entire batch back. A zero-row permission SELECT
 // followed by ordinary inserts would not provide an atomic permission fence.
 const report=JSON.parse(run.report_json),owners=new Set();for(const r of report.records.filter(r=>r.disposition==='MAPPED')){for(const key of['authorActorId','assigneeActorId','ownerActorId','createdByActorId'])if(r.normalized?.[key])owners.add(r.normalized[key]);if(r.normalized?.mappingMetadata?.authorActorId)owners.add(r.normalized.mappingMetadata.authorActorId);}
 return db.prepare(`UPDATE source_pilot_runs SET write_token=?,fence=CASE WHEN state='PENDING' AND actor_id=?
 AND organization_id=? AND client_id=? AND project_id=? AND fingerprint=? AND image_sha256=? AND report_json=? AND client_revision=? AND project_revision=? AND created_at=?
 AND EXISTS(SELECT 1 FROM actors a JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='staff')
 AND EXISTS(SELECT 1 FROM projects p JOIN clients c ON c.id=p.client_id AND c.organization_id=p.organization_id WHERE p.id=? AND p.organization_id=? AND p.client_id=? AND p.revision=? AND c.revision=?)
 AND NOT EXISTS(SELECT 1 FROM json_each(?) owner WHERE NOT EXISTS(SELECT 1 FROM actors a WHERE a.id=owner.value AND a.organization_id=? AND a.active=1 AND a.role='staff')) THEN 1 ELSE 0 END WHERE id=?`)
 .bind(token,actor.id,run.organization_id,run.client_id,run.project_id,run.fingerprint,run.image_sha256,run.report_json,run.client_revision,run.project_revision,run.created_at,actor.id,run.organization_id,run.project_id,run.organization_id,run.client_id,run.project_revision,run.client_revision,JSON.stringify([...owners]),run.organization_id,run.id);
}
async function prepare(input){
 if(!input||!id(input.requestId)||!/^[0-9a-f-]{36}$/i.test(input.requestId)||!input.snapshot||Object.keys(input.snapshot).sort().join(',')!=='clientRevision,projectRevision'||!Object.values(input.snapshot).every(v=>Number.isSafeInteger(v)&&v>=0))throw 400;
 let report,image;try{image=stable(input.report);report=JSON.parse(image);}catch{throw 400;}
 if(!image||new TextEncoder().encode(image).length>1024*1024)throw 413;
 if(report.version!==1||report.mode!=='offline-pilot-reconciliation'||!sha(report.fingerprint)||report.migrationReady!==false||report.targetWrites!==0||!Array.isArray(report.externalEffects)||report.externalEffects.length||!report.target||Object.keys(report.target).sort().join(',')!=='clientId,organizationId,projectId'||!Object.values(report.target).every(id)||!Array.isArray(report.records)||report.records.length<1||report.records.length>40||!Array.isArray(report.candidates))throw 400;
 const records=report.records,keys=new Set(),canonical=new Set();
 for(const r of records){if(!sources.includes(r.source)||typeof r.key!=='string'||!r.key.startsWith(r.source+':')||r.key.length>1200||keys.has(r.key)||!['MAPPED','HELD'].includes(r.disposition)||!r.provenance||!sha(r.provenance.fileSha256)||!sha(r.provenance.recordSha256)||!pathOK(r.provenance.path)||!r.normalized)throw 400;keys.add(r.key);
  if(r.disposition==='MAPPED'){
   if(!id(r.canonicalId)||r.normalized.proposedClientVisible!==false)throw 409;
   if(!['client','project','address','document','task','file','invoice','payment','time','expense'].includes(r.kind))throw 409;
   if(!['client','project'].includes(r.kind)){const key=r.kind+':'+r.canonicalId;if(canonical.has(key))throw 409;canonical.add(key);}
   if(['invoice','payment','time','expense'].includes(r.kind)&&(r.normalized.targetDisposition!=='HISTORICAL_ONLY'||r.normalized.externalProviderEligible!==false))throw 409;
  }
 }
 if(stable(report.counts)!==stable({sourceRecords:records.length,mapped:records.filter(r=>r.disposition==='MAPPED').length,held:records.filter(r=>r.disposition==='HELD').length}))throw 400;
 const objects=[],seen=new Set();let total=0;
 if(!Array.isArray(input.objects)||!report.sourceFiles||Object.keys(report.sourceFiles).sort().join(',')!==[...sources].sort().join(','))throw 400;
 // Reject declared oversized images before copying/hash work can exceed a
 // Worker memory budget. Callers may share a buffer across many input rows.
 let declaredBytes=0,declaredCount=0;
 for(const source of sources){if(!Array.isArray(report.sourceFiles[source]))throw 400;for(const pin of report.sourceFiles[source]){if(!Number.isSafeInteger(pin.bytes)||pin.bytes<0||pin.bytes>5*1024*1024)throw 400;declaredBytes+=pin.bytes;declaredCount++;}}
 if(declaredCount>64||input.objects.length>64||declaredBytes>16*1024*1024)throw 413;
 for(const source of sources){if(!Array.isArray(report.sourceFiles[source]))throw 400;for(const pin of report.sourceFiles[source]){
  const key=source+':'+pin.path;if(!pathOK(pin.path)||!sha(pin.sha256)||!Number.isSafeInteger(pin.bytes)||pin.bytes<0||pin.bytes>5*1024*1024||seen.has(key))throw 400;seen.add(key);
  const matches=input.objects.filter(o=>o.source===source&&o.path===pin.path);if(matches.length!==1||!(matches[0].bytes instanceof Uint8Array))throw 400;
  if(matches[0].bytes.length!==pin.bytes)throw 409;
  total+=matches[0].bytes.length;if(total>16*1024*1024)throw 413;
  // Uint8Array#slice copies, but Node Buffer#slice returns a shared view.
  const bytes=new Uint8Array(matches[0].bytes);if(await digest(bytes)!==pin.sha256)throw 409;
  objects.push({source,path:pin.path,size:pin.bytes,sha256:pin.sha256,bytes,object_key:'source-pilots/'+input.requestId+'/'+await hashText(key)});
 }}
 if(objects.length!==input.objects.length)throw 400;
 if(objects.length>64||total>16*1024*1024)throw 413;
 for(const r of records)if(!objects.some(o=>o.source===r.source&&o.path===r.provenance.path&&o.sha256===r.provenance.fileSha256))throw 409;
 const plan=[];
 for(const r of records.filter(r=>r.disposition==='MAPPED')){
  const n=r.normalized;
  if(['client','project'].includes(r.kind)){if(r.canonicalId!==report.target[r.kind+'Id'])throw 409;plan.push({record:r,kind:r.kind,id:r.canonicalId});}
  if(r.kind==='document'){
   const title=r.source==='notion'?r.provenance.path.split('/').at(-1).replace(/\.md$/,''):r.raw?.title;
   if(!text(title,200)||!text(n.text,20000)||n.parentCanonicalId&&!id(n.parentCanonicalId))throw 409;
   plan.push({record:r,kind:'document',id:r.canonicalId,title,text:n.text,parent:n.parentCanonicalId??null,version:crypto.randomUUID()});
  }
  if(r.kind==='task'){
   const status=({PENDING:'todo',IN_PROGRESS:'doing',COMPLETED:'done'})[n.sourceStatus],due=r.raw?.dueDate??null;
   const date=due===null?null:new Date(due+'T12:00:00Z');
   if(!status||!text(r.raw?.title,200)||due!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==due))throw 409;
   plan.push({record:r,kind:'task',id:r.canonicalId,title:r.raw.title,status,assignee:n.assigneeActorId??null,due});
  }
  if(r.kind==='file'){
   const object=objects.find(o=>o.source===r.source&&o.path===n.exportPath);
   if(!object||object.sha256!==n.sha256||object.size!==n.bytes||object.size<1||!text(n.originalName,180)||n.originalName!==n.originalName.trim()||/[\p{Cc}\p{Cf}\\/]/u.test(n.originalName)||['.','..'].includes(n.originalName))throw 409;
   plan.push({record:r,kind:'file',id:r.canonicalId,name:n.originalName,object});
  }
 }
 const docs=plan.filter(p=>p.kind==='document'),ordered=[];
 for(let i=0;i<=docs.length;i++)for(const doc of docs)if(!ordered.includes(doc)&&(!doc.parent||ordered.some(p=>p.id===doc.parent)))ordered.push(doc);
 if(ordered.length!==docs.length)throw 409;
 // Both batches must fit this pilot's 100-statement application budget before
 // reservation or object writes. Documents need three canonical statements.
 if(2+records.length+objects.length>100||3+records.length+objects.length+plan.length+ordered.length*3+plan.filter(p=>['task','file'].includes(p.kind)).length>100)throw 413;
 return {report,image,imageSha:await hashText(image),objects,plan,docs:ordered};
}
async function runRow(db,id){return db.prepare('SELECT * FROM source_pilot_runs WHERE id=?').bind(id).first();}
async function inventory(db,run){
 const report=JSON.parse(run.report_json);if(await hashText(stable(report))!==run.image_sha256||report.fingerprint!==run.fingerprint||report.target.organizationId!==run.organization_id||report.target.clientId!==run.client_id||report.target.projectId!==run.project_id)throw 503;
 const records=(await db.prepare('SELECT * FROM source_pilot_records WHERE run_id=? ORDER BY source_key').bind(run.id).all()).results;
 if(records.length!==report.records.length||records.some(row=>row.organization_id!==run.organization_id||row.project_id!==run.project_id||row.image_json!==stable(report.records.find(r=>r.key===row.source_key))))throw 503;
 const objects=(await db.prepare('SELECT * FROM source_pilot_objects WHERE run_id=? ORDER BY source,path').bind(run.id).all()).results,pins=sources.flatMap(source=>report.sourceFiles[source].map(p=>({...p,source})));
 if(objects.length!==pins.length||objects.some(o=>{const p=pins.find(p=>p.source===o.source&&p.path===o.path);return !p||p.bytes!==o.size||p.sha256!==o.sha256||o.organization_id!==run.organization_id||o.project_id!==run.project_id;}))throw 503;
 for(const o of objects)if(o.object_key!=='source-pilots/'+run.id+'/'+await hashText(o.source+':'+o.path))throw 503;
 return {report,records,objects};
}
async function original(env,o,retrieved){const value=retrieved??await env.FILES.get(o.object_key);if(!value||value.size!==o.size)throw 503;const bytes=new Uint8Array(await value.arrayBuffer());if(bytes.length!==o.size||await digest(bytes)!==o.sha256)throw 503;return bytes;}
async function verifyDone(env,run,saved){
 for(const o of saved.objects)await original(env,o);
 for(const row of saved.records){const r=JSON.parse(row.image_json);if(r.disposition==='HELD'||!['client','project','document','task','file'].includes(r.kind)){if(row.target_kind!==null||row.target_id!==null||row.initial_version_id!==null)throw 503;continue;}
  if(row.target_kind!==r.kind||row.target_id!==r.canonicalId)throw 503;
  if(['document','task'].includes(r.kind)&&!await env.DB.prepare('SELECT id FROM '+(r.kind==='document'?'notes':'tasks')+' WHERE id=? AND organization_id=? AND project_id=?').bind(row.target_id,run.organization_id,run.project_id).first())throw 503;
  if(r.kind==='document'){
   const v=await env.DB.prepare('SELECT * FROM note_versions WHERE id=? AND note_id=? AND organization_id=? AND project_id=? AND revision=0').bind(row.initial_version_id,row.target_id,run.organization_id,run.project_id).first();
   const title=r.source==='notion'?r.provenance.path.split('/').at(-1).replace(/\.md$/,''):r.raw.title;
   if(!v||v.text!==r.normalized.text||v.title!==title||v.client_visible!==0||v.actor_id!==run.actor_id||v.recorded_at!==run.created_at||v.parent_id!==(r.normalized.parentCanonicalId??null)||v.source_revision!==null||v.archived!==0)throw 503;
  }
  if(r.kind==='file'){const file=await env.DB.prepare('SELECT state,object_key,sha256,size,project_id,organization_id,actor_id,created_at FROM files WHERE id=?').bind(row.target_id).first(),o=saved.objects.find(o=>o.source===r.source&&o.path===r.normalized.exportPath);if(!file||file.state!=='ready'||!o||file.object_key!==o.object_key||file.sha256!==o.sha256||file.size!==o.size||file.project_id!==run.project_id||file.organization_id!==run.organization_id||file.actor_id!==run.actor_id||file.created_at!==run.created_at)throw 503;}
 }
}
export async function applySourcePilot(env,actor,input){
 if(!env.FILES)throw 503;if(!await hasFinance(env.DB,actor))throw 403;
 const p=await prepare(input),db=env.DB,current=await authorize(db,actor,p.report.target);
 let run=await runRow(db,input.requestId);
 if(run){if(run.organization_id!==actor.organization_id)throw 404;if(run.actor_id!==actor.id||run.image_sha256!==p.imageSha||run.client_revision!==input.snapshot.clientRevision||run.project_revision!==input.snapshot.projectRevision)throw 409;}
 else{
  if(current.client_revision!==input.snapshot.clientRevision||current.project_revision!==input.snapshot.projectRevision)throw 409;
  run={id:input.requestId,organization_id:actor.organization_id,client_id:p.report.target.clientId,project_id:p.report.target.projectId,actor_id:actor.id,fingerprint:p.report.fingerprint,image_sha256:p.imageSha,report_json:p.image,client_revision:input.snapshot.clientRevision,project_revision:input.snapshot.projectRevision,state:'PENDING',created_at:Date.now()};
  const statements=[db.prepare('INSERT INTO source_pilot_runs(id,organization_id,client_id,project_id,actor_id,fingerprint,image_sha256,report_json,client_revision,project_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(run.id,run.organization_id,run.client_id,run.project_id,run.actor_id,run.fingerprint,run.image_sha256,run.report_json,run.client_revision,run.project_revision,run.created_at),guard(db,actor,run,crypto.randomUUID()),...p.report.records.map(r=>db.prepare('INSERT INTO source_pilot_records(run_id,organization_id,project_id,source_key,image_json) VALUES(?,?,?,?,?)').bind(run.id,run.organization_id,run.project_id,r.key,stable(r))),...p.objects.map(o=>db.prepare('INSERT INTO source_pilot_objects(run_id,organization_id,project_id,source,path,object_key,size,sha256) VALUES(?,?,?,?,?,?,?,?)').bind(run.id,run.organization_id,run.project_id,o.source,o.path,o.object_key,o.size,o.sha256))];
  if(statements.length>100)throw 413;
  try{await db.batch(statements);}catch{await authorize(db,actor,p.report.target);const winner=await runRow(db,run.id);if(!winner||winner.image_sha256!==p.imageSha||winner.actor_id!==actor.id)throw 409;}
  run=await runRow(db,run.id);if(!run)throw 503;
 }
 const saved=await inventory(db,run);
 if(run.state==='DONE'){await verifyDone(env,run,saved);await authorize(db,actor,p.report.target);return receipt(run);}
 for(const o of saved.objects){const bytes=p.objects.find(p=>p.source===o.source&&p.path===o.path)?.bytes;if(!bytes)throw 503;const existing=await env.FILES.get(o.object_key);if(!existing){try{if(!await env.FILES.put(o.object_key,bytes,{sha256:o.sha256,customMetadata:{run:run.id,sha256:o.sha256}}))throw 503;}catch{throw 503;}}await original(env,o,existing);}
 await authorize(db,actor,p.report.target);
 const token=crypto.randomUUID(),statements=[
 // UPDATE/CHECK alone does nothing if a whole reservation vanished. Force a
 // SQL error inside this same transaction for that absent-row case too.
 db.prepare("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM source_pilot_runs WHERE id=? AND state='PENDING') THEN '{}' ELSE '' END) AS reservation_fence").bind(run.id),guard(db,actor,run,token),
 ...p.report.records.map(r=>db.prepare('UPDATE source_pilot_records SET fence=CASE WHEN image_json=? AND organization_id=? AND project_id=? THEN 1 ELSE 0 END WHERE run_id=? AND source_key=?').bind(stable(r),run.organization_id,run.project_id,run.id,r.key)),
 ...p.objects.map(o=>db.prepare('UPDATE source_pilot_objects SET fence=CASE WHEN organization_id=? AND project_id=? AND object_key=? AND size=? AND sha256=? THEN 1 ELSE 0 END WHERE run_id=? AND source=? AND path=?').bind(run.organization_id,run.project_id,o.object_key,o.size,o.sha256,run.id,o.source,o.path))];
 const proof=p.plan.map(entry=>db.prepare('UPDATE source_pilot_records SET target_kind=?,target_id=?,initial_version_id=? WHERE run_id=? AND source_key=?').bind(entry.kind,entry.id,entry.version??null,run.id,entry.record.key));
 for(const d of p.docs)statements.push(db.prepare('INSERT INTO notes(id,organization_id,project_id,title,text,client_visible,history_token) VALUES(?,?,?,?,?,0,?)').bind(d.id,run.organization_id,run.project_id,d.title,d.text,d.version));
 for(const d of p.docs){statements.push(db.prepare('INSERT INTO note_positions(id,organization_id,project_id,parent_id) VALUES(?,?,?,?)').bind(d.id,run.organization_id,run.project_id,d.parent));statements.push(db.prepare('INSERT INTO note_versions(id,note_id,organization_id,project_id,revision,title,text,client_visible,recorded_at,actor_id,parent_id) VALUES(?,?,?,?,0,?,?,0,?,?,?)').bind(d.version,d.id,run.organization_id,run.project_id,d.title,d.text,run.created_at,run.actor_id,d.parent));}
 for(const entry of p.plan){if(entry.kind==='task')statements.push(db.prepare('INSERT INTO tasks(id,organization_id,project_id,title,status,client_visible,assignee_id,due_on) VALUES(?,?,?,?,?,0,?,?)').bind(entry.id,run.organization_id,run.project_id,entry.title,entry.status,entry.assignee,entry.due));if(entry.kind==='file')statements.push(db.prepare("INSERT INTO files(id,organization_id,project_id,actor_id,name,object_key,size,sha256,state,client_visible,created_at) VALUES(?,?,?,?,?,?,?,?,'ready',0,?)").bind(entry.id,run.organization_id,run.project_id,run.actor_id,entry.name,entry.object.object_key,entry.object.size,entry.object.sha256,run.created_at));}
 statements.push(...proof,db.prepare("UPDATE source_pilot_runs SET state='DONE',completed_at=?,fence=CASE WHEN write_token=? AND report_json=? AND (SELECT COUNT(*) FROM source_pilot_records WHERE run_id=?)=? AND (SELECT COUNT(*) FROM source_pilot_records WHERE run_id=? AND target_kind IS NOT NULL)=? AND (SELECT COUNT(*) FROM source_pilot_objects WHERE run_id=?)=? THEN 1 ELSE 0 END WHERE id=?").bind(Date.now(),token,p.image,run.id,p.report.records.length,run.id,p.plan.length,run.id,p.objects.length,run.id));
 if(statements.length>100)throw 413;
 try{await db.batch(statements);}catch{
  await authorize(db,actor,p.report.target);const changed=await runRow(db,run.id);if(changed?.state==='DONE'){const saved=await inventory(db,changed);await verifyDone(env,changed,saved);await authorize(db,actor,p.report.target);return receipt(changed);}throw 409;
 }
 run=await runRow(db,run.id);if(run?.state!=='DONE')throw 503;const finished=await inventory(db,run);await verifyDone(env,run,finished);await authorize(db,actor,p.report.target);return receipt(run);
}
export async function readSourcePilot(env,actor,id){
 if(!await hasFinance(env.DB,actor))throw 403;
 const run=await runRow(env.DB,id);if(!run||run.organization_id!==actor.organization_id||run.state!=='DONE')throw 404;
 const target={organizationId:run.organization_id,projectId:run.project_id,clientId:run.client_id};await authorize(env.DB,actor,target);
 const saved=await inventory(env.DB,run);await verifyDone(env,run,saved);await authorize(env.DB,actor,target);return {run:receipt(run),records:saved.records.map(row=>JSON.parse(row.image_json)),totals:saved.report.totals,coverage:saved.report.coverage,sourceFiles:saved.report.sourceFiles};
}
export async function readSourceObject(env,actor,id,source,path){
 if(!await hasFinance(env.DB,actor))throw 403;
 const run=await runRow(env.DB,id);if(!run||run.organization_id!==actor.organization_id||run.state!=='DONE')throw 404;
 const target={organizationId:run.organization_id,projectId:run.project_id,clientId:run.client_id};await authorize(env.DB,actor,target);
 const saved=await inventory(env.DB,run),object=saved.objects.find(o=>o.source===source&&o.path===path);if(!object)throw 404;
 const bytes=await original(env,object);await authorize(env.DB,actor,target);return bytes;
}

function historyQuery(url,allowed){
 const seen=new Set();for(const key of url.searchParams.keys()){if(!allowed.includes(key)||seen.has(key))throw 400;seen.add(key);}
 const value=url.searchParams.get('limit');if(value!==null&&(!/^[1-9]\d?$/.test(value)||Number(value)>50))throw 400;
 return {params:url.searchParams,limit:value===null?20:Number(value)};
}
const historyTarget=run=>({organizationId:run.organization_id,clientId:run.client_id,projectId:run.project_id});
async function visibleHistoryRun(db,actor,key){
 const run=await runRow(db,key);if(!run||run.organization_id!==actor.organization_id||run.state!=='DONE')throw 404;
 await authorize(db,actor,historyTarget(run));return run;
}
async function historyNames(db,actor,run){
 const row=await db.prepare(`SELECT c.name AS client_name,p.name AS project_name FROM projects p
 JOIN clients c ON c.id=p.client_id AND c.organization_id=p.organization_id
 WHERE p.id=? AND p.organization_id=? AND p.client_id=?`).bind(run.project_id,actor.organization_id,run.client_id).first();
 if(!row)throw 404;return row;
}
function historyCounts(value){
 const counts=JSON.parse(value);if(!counts||Object.keys(counts).sort().join(',')!=='held,mapped,sourceRecords'||!Object.values(counts).every(v=>Number.isSafeInteger(v)&&v>=0)||counts.sourceRecords!==counts.mapped+counts.held)throw 503;return counts;
}
async function historyList(db,actor,url){
 const {params,limit}=historyQuery(url,['after','clientId','projectId','limit']),after=params.get('after');
 if(after!==null&&!id(after))throw 400;
 const clauses=["r.organization_id=? AND r.state='DONE' AND p.client_id=r.client_id"],values=[actor.organization_id];
 for(const [key,column,table]of[['clientId','r.client_id','clients'],['projectId','r.project_id','projects']])if(params.has(key)){
  const value=params.get(key);if(!id(value))throw 400;
  if(!await db.prepare('SELECT id FROM '+table+' WHERE id=? AND organization_id=?').bind(value,actor.organization_id).first())throw 404;
  clauses.push(column+'=?');values.push(value);
 }
 if(after){clauses.push('r.id>?');values.push(after);}
 // Summaries extract only counts; never load fifty 1 MiB report images into
 // a Worker just to draw a list. Every row still requires current linkage.
 const query=`SELECT r.id,r.client_id,r.project_id,r.created_at,r.fingerprint,
 json_extract(r.report_json,'$.counts') AS counts_json,c.name AS client_name,p.name AS project_name
 FROM source_pilot_runs r JOIN projects p ON p.id=r.project_id AND p.organization_id=r.organization_id
 JOIN clients c ON c.id=r.client_id AND c.organization_id=r.organization_id
 WHERE ${clauses.join(' AND ')} ORDER BY r.id LIMIT ?`;
 const statement=()=>db.prepare(query).bind(...values,limit+1),rows=(await statement().all()).results;
 // The final finance decision and current scoped rows share one D1 transaction.
 // An awaited authority query after the scope read would reopen a stale-data gap.
 const [permission,current]=await db.batch([
  financeStatement(db,actor),
  statement()
 ]);
 if(!permission.results[0]?.finance)throw 403;const again=current.results;
 if(stable(rows)!==stable(again))throw 409;
 const items=rows.slice(0,limit).map(r=>({id:r.id,clientId:r.client_id,projectId:r.project_id,clientName:r.client_name,projectName:r.project_name,createdAt:r.created_at,fingerprint:r.fingerprint,counts:historyCounts(r.counts_json)}));
 return {items,nextCursor:rows.length>limit?items.at(-1).id:null};
}

// This is an authenticated read surface only. Neither reports nor mapping
// decisions supplied over HTTP can reach applySourcePilot's trusted boundary.
export async function sourceHistoryRoute(request,env,actor,json){
 try{
  if(!await hasFinance(env.DB,actor))throw 403;
  if(request.method!=='GET')throw 405;
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/source-history(?:\/([a-zA-Z0-9-]{1,100})(?:\/(records)|\/objects\/([a-f0-9]{64})\/download)?)?$/);
  if(!match)throw 404;
  const key=match[1];if(!key)return json(await historyList(env.DB,actor,url));
  const run=await visibleHistoryRun(env.DB,actor,key),target=historyTarget(run);
  if(match[3]){
   historyQuery(url,[]);if(!env.FILES)throw 503;
   const saved=await inventory(env.DB,run),object=saved.objects.find(o=>o.object_key.endsWith('/'+match[3]));if(!object)throw 404;
   const bytes=await readSourceObject(env,actor,key,object.source,object.path);
   await authorize(env.DB,actor,target);
   const name=object.path.split('/').at(-1),filename=encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
   return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),'Content-Disposition':"attachment; filename*=UTF-8''"+filename,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','X-Robots-Tag':'noindex, nofollow'}});
  }
  const query=historyQuery(url,match[2]?['after','limit']:[]);if(!env.FILES)throw 503;
  const saved=await readSourcePilot(env,actor,key);
  if(match[2]){
   const after=query.params.get('after');let start=0;
   if(after!==null){if(!after||after.length>1200)throw 400;const index=saved.records.findIndex(r=>r.key===after);if(index<0)throw 400;start=index+1;}
   const items=saved.records.slice(start,start+query.limit),more=start+query.limit<saved.records.length;
   await authorize(env.DB,actor,target);return json({items,nextCursor:more?items.at(-1).key:null});
  }
  const sourceFiles=Object.fromEntries(await Promise.all(Object.entries(saved.sourceFiles).map(async([source,files])=>[source,await Promise.all(files.map(async file=>({...file,id:await hashText(source+':'+file.path)})))])));
  const names=await historyNames(env.DB,actor,run);await authorize(env.DB,actor,target);
  return json({run:{...saved.run,clientId:run.client_id,projectId:run.project_id,clientName:names.client_name,projectName:names.project_name,createdAt:run.created_at},totals:saved.totals,coverage:saved.coverage,sourceFiles});
 }catch(e){if(Number.isInteger(e))throw e;throw 503;}
}
