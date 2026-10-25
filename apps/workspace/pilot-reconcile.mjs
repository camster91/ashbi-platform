// Offline, bounded source reconciliation only. No D1/R2 writes, credentials,
// account changes, requests, provider clients, or application imports.
import {lstat,readdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,relative,sep,dirname,basename,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inventoryMigrationSource} from '../../scripts/inventory-migration-source.mjs';
import {buildNotionMarkdownImportPlan} from '../../src/services/notion-markdown-import.service.js';
import {verifyWorkspaceExportDirectory} from '../../src/services/workspace-export.service.js';
import {parsePilotCsv,minorUnits,clockSeconds,sourceDate,parseLegacyRow} from './pilot-source-formats.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sources=['notion','bonsai','legacy'];
const fail=code=>{throw Object.assign(new Error(code),{code});};
const stable=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const pathOK=p=>typeof p==='string'&&p.length>0&&!/[\\:\x00-\x1f]/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
const strict=(value,fields)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields.includes(k)))fail('MAPPING_INVALID');};
export const pilotHeaders=Object.freeze({
 'clients.csv':['Client','Contact Name','Contact Email','Phone Number','Website','Tags'],
 'addresses.csv':['Client','Address 1','Address 2','City','Region','Postal Code','Country'],
 'projects.csv':['client_or_company_name','title','project_id','status','project_budget_amount','amount_paid','start_date','finish_date'],
 'invoices.csv':['invoice_number','client_or_company_name','client_email','status','total_amount','calculated_tax_amount','calculated_tax_percent','paid_amount','currency','issued_date','due_date','paid_date','payment_method','contractor_invoice_link','contractor_project_name'],
 'time-entries.csv':['client_name','project_title','owner_name','date','formatted_time','rate','billing_status','notes'],
 'expenses.csv':['name','amount_after_tax','amount_pre_tax','currency','date','tags','billable','client','project']
});
const csvKinds={'clients.csv':'client','addresses.csv':'address','projects.csv':'project','invoices.csv':'invoice','time-entries.csv':'time','expenses.csv':'expense'};
const legacyKinds={clients:'client',projects:'project',users:'actor',tasks:'task',notes:'document',time_entries:'time',invoices:'invoice',invoice_payments:'payment',attachments:'file'};

function validateMapping(m){
 strict(m,['version','target','sourceScope','pins','legacyManifestSha256','legacyExclusionsSha256','actors','authority','records']);if(m.version!==1)fail('MAPPING_INVALID');
 strict(m.target,['organizationId','clientId','projectId']);if(!['organizationId','clientId','projectId'].every(k=>id(m.target[k])))fail('MAPPING_INVALID');
 strict(m.sourceScope,['bonsai','legacy']);strict(m.sourceScope.bonsai,['clientName','projectId','projectTitle']);strict(m.sourceScope.legacy,['organizationId','clientId','projectId']);
 if(!['clientName','projectId','projectTitle'].every(k=>typeof m.sourceScope.bonsai[k]==='string'&&m.sourceScope.bonsai[k].length>0&&m.sourceScope.bonsai[k].length<=1000)||!['organizationId','clientId','projectId'].every(k=>id(m.sourceScope.legacy[k])))fail('MAPPING_INVALID');
 strict(m.pins,sources);for(const source of sources){if(!Array.isArray(m.pins[source])||m.pins[source].length>128)fail('MAPPING_INVALID');const seen=new Set();for(const pin of m.pins[source]){strict(pin,['path','bytes','sha256']);if(!pathOK(pin.path)||!sha(pin.sha256)||!Number.isSafeInteger(pin.bytes)||pin.bytes<0||seen.has(pin.path))fail('MAPPING_INVALID');seen.add(pin.path);}}
 if(!sha(m.legacyManifestSha256)||!sha(m.legacyExclusionsSha256))fail('MAPPING_INVALID');
 strict(m.authority,['client','project']);if(!Object.values(m.authority).every(v=>typeof v==='string'))fail('MAPPING_INVALID');
 if(!m.actors||typeof m.actors!=='object'||Array.isArray(m.actors)||Object.keys(m.actors).length>200||!Object.values(m.actors).every(id))fail('MAPPING_INVALID');
 if(!Array.isArray(m.records)||m.records.length>200)fail('MAPPING_INVALID');const seen=new Set();for(const r of m.records){strict(r,['key','fileSha256','canonicalId','clientVisible','authorActorId','createdAt','updatedAt','currency','disposition','reason']);if(typeof r.key!=='string'||!sha(r.fileSha256)||!id(r.canonicalId)||typeof r.clientVisible!=='boolean'||!['MAP','HOLD'].includes(r.disposition))fail('MAPPING_INVALID');if(seen.has(r.key))fail('MAPPING_DUPLICATE');seen.add(r.key);if(r.disposition==='HOLD'&&(typeof r.reason!=='string'||!r.reason.trim()))fail('MAPPING_INVALID');if(r.authorActorId!==undefined&&!id(r.authorActorId))fail('MAPPING_INVALID');if(['createdAt','updatedAt','currency','reason'].some(k=>r[k]!==undefined&&(typeof r[k]!=='string'||r[k].length>2000)))fail('MAPPING_INVALID');}
}
async function scan(root){
 const stat=await lstat(root);if(stat.isSymbolicLink())fail('SOURCE_LINK_REFUSED');if(!stat.isDirectory())fail('SOURCE_DIRECTORY_REQUIRED');
 const files=[];let bytes=0,entries=0;async function walk(dir,depth){if(depth>16)fail('SOURCE_LIMIT');for(const entry of(await readdir(dir)).sort()){if(++entries>128)fail('SOURCE_LIMIT');const path=join(dir,entry),name=relative(root,path).split(sep).join('/');if(!pathOK(name))fail('SOURCE_PATH_INVALID');const s=await lstat(path);if(s.isSymbolicLink())fail('SOURCE_LINK_REFUSED');if(s.isDirectory())await walk(path,depth+1);else if(s.isFile()){bytes+=s.size;if(s.size>16*1024*1024||bytes>64*1024*1024)fail('SOURCE_LIMIT');const data=await readFile(path);if(data.length!==s.size)fail('SOURCE_CHANGED');files.push({path:name,bytes:data.length,sha256:hash(data),data});}else fail('SOURCE_SPECIAL_FILE');}}
 await walk(root,0);return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
const pins=files=>files.map(({path,bytes,sha256})=>({path,bytes,sha256}));
const pinImage=files=>stable([...files].sort((a,b)=>a.path.localeCompare(b.path,'en')));
const text=bytes=>{try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('SOURCE_ENCODING_INVALID');}};
function csvRecords(file){let rows;try{rows=parsePilotCsv(text(file.data));}catch{fail('CSV_INVALID');}if(!rows.length||stable(rows[0].values)!==stable(pilotHeaders[file.path]))fail('CSV_HEADER_INVALID');return rows.slice(1).map(r=>{if(r.values.length!==rows[0].values.length)fail('CSV_ROW_INVALID');return {key:'bonsai:'+file.path+':'+r.line,source:'bonsai',kind:csvKinds[file.path],file,raw:Object.fromEntries(rows[0].values.map((h,i)=>[h,r.values[i]]))};});}

export async function reconcilePilot(input,mapping){
 validateMapping(mapping);const root=resolve(input),rootStat=await lstat(root);if(rootStat.isSymbolicLink())fail('SOURCE_LINK_REFUSED');if(!rootStat.isDirectory())fail('SOURCE_DIRECTORY_REQUIRED');
 const files={};for(const source of sources){try{files[source]=await scan(join(root,source));}catch(e){if(e.code==='ENOENT')fail('SOURCE_MISSING');throw e;}if(pinImage(pins(files[source]))!==pinImage(mapping.pins[source]))fail('SOURCE_CHANGED');}
 // Reuse the existing read-only inventories and native directory verifier.
 // The bounded no-link preflight runs before these readers and is repeated
 // afterward. Inputs must remain quiescent in an operator-controlled folder.
 for(const source of['notion','bonsai']){const inventory=await inventoryMigrationSource({source,inputDir:join(root,source)});if(pinImage(inventory.files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256})))!==pinImage(mapping.pins[source]))fail('SOURCE_CHANGED');}
 const manifestFile=files.legacy.find(f=>f.path==='manifest.json');if(!manifestFile)fail('LEGACY_EXPORT_INVALID');let manifest;try{manifest=JSON.parse(text(manifestFile.data));}catch{fail('LEGACY_EXPORT_INVALID');}
 const verified=await verifyWorkspaceExportDirectory(join(root,'legacy'),{expectedManifestSha256:mapping.legacyManifestSha256});if(!verified.valid||verified.exceptions!==0)fail('LEGACY_EXPORT_INVALID');
 if(!manifest.exclusions||typeof manifest.exclusions!=='object'||hash(JSON.stringify(manifest.exclusions))!==mapping.legacyExclusionsSha256)fail('EXCLUSIONS_UNREVIEWED');
 if(manifest.organizationId!==mapping.sourceScope.legacy.organizationId||manifest.organization?.id!==mapping.sourceScope.legacy.organizationId)fail('LEGACY_ORGANIZATION_MISMATCH');
 if(!Array.isArray(manifest.entities)||new Set(manifest.entities.map(e=>e.name)).size!==manifest.entities.length||new Set(manifest.entities.map(e=>e.file)).size!==manifest.entities.length||manifest.entities.some(e=>!pathOK(e.file)||!/^[a-z_]+$/.test(e.name)))fail('LEGACY_EXPORT_INVALID');
 if(!Array.isArray(manifest.files)||manifest.files.some(f=>!pathOK(f.exportPath)))fail('LEGACY_EXPORT_INVALID');
 const sourceRecords=[];
 const notionPlan=buildNotionMarkdownImportPlan(files.notion.filter(f=>f.path.endsWith('.md')).map(f=>f.path));
 for(const file of files.notion){const node=notionPlan.find(n=>n.relativePath===file.path);sourceRecords.push({key:'notion:'+file.path,source:'notion',kind:node?'document':'unsupported',file,raw:node?{text:text(file.data)}:{artifact:file.path,recordCountKnown:false},parentKey:node?.parentSourceKey?.replace('notion-markdown:','notion:'),pathIdentity:node?.sourceKey});}
 for(const filename of Object.keys(pilotHeaders))if(!files.bonsai.some(f=>f.path===filename))fail('SOURCE_MISSING');
 for(const file of files.bonsai)if(Object.hasOwn(pilotHeaders,file.path))sourceRecords.push(...csvRecords(file));else sourceRecords.push({key:'bonsai:'+file.path,source:'bonsai',kind:'unsupported',file,raw:{artifact:file.path,recordCountKnown:false}});
 for(const entity of manifest.entities){const file=files.legacy.find(f=>f.path===entity.file);if(!file)fail('LEGACY_EXPORT_INVALID');const body=text(file.data);if(body&&!body.endsWith('\n'))fail('LEGACY_ROW_INVALID');for(const line of body?body.slice(0,-1).split('\n'):[]){if(!line.trim())fail('LEGACY_ROW_INVALID');let parsed;try{parsed=parseLegacyRow(line);}catch{fail('LEGACY_ROW_INVALID');}const kind=legacyKinds[entity.name]||'unsupported',raw=parsed.row;if(kind!=='unsupported'&&(typeof raw.id!=='string'||!raw.id))fail('LEGACY_ROW_INVALID');sourceRecords.push({key:'legacy:'+entity.name+':'+(raw.id||'line-'+(sourceRecords.length+1)),source:'legacy',kind,file,raw,rawText:line,numberLexemes:parsed.numberLexemes,entity:entity.name});}}
 for(const original of manifest.files)if(!sourceRecords.some(r=>r.source==='legacy'&&r.entity==='attachments'&&r.raw.id===original.recordId))sourceRecords.push({key:'legacy:original:'+original.exportPath,source:'legacy',kind:'unsupported',file:manifestFile,raw:{...original,recordCountKnown:false},orphanOriginal:true});
 if(sourceRecords.length>200)fail('SOURCE_LIMIT');if(new Set(sourceRecords.map(r=>r.key)).size!==sourceRecords.length)fail('SOURCE_ID_DUPLICATE');
 const decisions=new Map(mapping.records.map(r=>[r.key,r])),byKey=new Map(sourceRecords.map(r=>[r.key,r]));if(mapping.records.some(r=>!byKey.has(r.key)))fail('MAPPING_ORPHAN');
 for(const kind of['client','project']){const authority=byKey.get(mapping.authority[kind]);if(authority?.kind!==kind||decisions.get(authority.key)?.canonicalId!==mapping.target[kind+'Id'])fail('AUTHORITY_INVALID');}
 const legacyRow=(entity,id)=>byKey.get('legacy:'+entity+':'+id),scope=mapping.sourceScope;
 const strictOrgKinds=['client','project','actor','file'];
 const legacyInScope=s=>{if(!s)return false;const row=s.raw;if(strictOrgKinds.includes(s.kind)&&row.organizationId!==scope.legacy.organizationId)return false;if(row.organizationId!==undefined&&row.organizationId!==null&&row.organizationId!==scope.legacy.organizationId)return false;if(row.clientId!==undefined&&row.clientId!==null&&row.clientId!==scope.legacy.clientId)return false;if(row.projectId!==undefined&&row.projectId!==null&&row.projectId!==scope.legacy.projectId)return false;return true;};
 const legacyProject=legacyRow('projects',scope.legacy.projectId),legacyClient=legacyRow('clients',scope.legacy.clientId);
 const bonsaiClients=sourceRecords.filter(s=>s.source==='bonsai'&&s.kind==='client'&&s.raw.Client===scope.bonsai.clientName),bonsaiProjects=sourceRecords.filter(s=>s.source==='bonsai'&&s.kind==='project'&&s.raw.title===scope.bonsai.projectTitle&&s.raw.client_or_company_name===scope.bonsai.clientName);
 const records=sourceRecords.map(s=>{
  const d=decisions.get(s.key),findings=[],normalized={},row=s.raw,add=code=>{if(!findings.includes(code))findings.push(code);};
  if(!d)add('MAPPING_REQUIRED');else{if(d.fileSha256!==s.file.sha256)add('REVIEW_STALE');if(d.disposition==='HOLD')add('MANUAL_HOLD');}
  const result={key:s.key,source:s.source,kind:s.kind,unit:s.kind==='unsupported'?'artifact':'record',canonicalId:d?.canonicalId??null,disposition:'MAPPED',findings,raw:row,...(s.rawText?{rawText:s.rawText}:{}),provenance:{path:s.file.path,fileSha256:s.file.sha256,recordSha256:hash(s.rawText??JSON.stringify(row)),sourceRecordId:row.id??null,...(s.pathIdentity?{pathIdentity:s.pathIdentity,identityKind:'export-path-not-page-id'}:{})},normalized,...(d?.reason?{holdReason:d.reason}:{})};
  const currency=value=>{if(value===undefined||value==='')fail('CURRENCY_REQUIRED');if(!['CAD','USD'].includes(value))fail('CURRENCY_UNSUPPORTED');return value;};
  const owner=(sourceId,compareAuthor=true)=>{if(sourceId.startsWith('legacy:')){const sourceActor=legacyRow('users',sourceId.slice(7));if(!legacyInScope(sourceActor))fail('OWNER_OUTSIDE_SCOPE');if(!['TEAM','ADMIN'].includes(sourceActor.raw.role))fail('OWNER_ROLE_UNSUPPORTED');}const actor=Object.hasOwn(mapping.actors,sourceId)?mapping.actors[sourceId]:null;if(!actor)fail('OWNER_UNMAPPED');if(compareAuthor&&d?.authorActorId&&actor!==d.authorActorId)fail('OWNER_CONFLICT');return actor;};
  try{
   if(d){normalized.proposedClientVisible=d.clientVisible;normalized.mappingMetadata={origin:'operator-assertion',authorActorId:d.authorActorId??null,createdAt:d.createdAt?sourceDate(d.createdAt):null,updatedAt:d.updatedAt?sourceDate(d.updatedAt):null};}
   if(s.kind==='unsupported')add('UNSUPPORTED_ARTIFACT');
   if(s.orphanOriginal)add('ORPHAN_ORIGINAL');
   if(s.kind==='actor')add('ACCESS_GRANT_NOT_PORTABLE');
   if(['client','project'].includes(s.kind)&&d?.canonicalId!==mapping.target[s.kind+'Id'])add('CANONICAL_SCOPE_MISMATCH');
   if(s.source==='legacy'){
    if(strictOrgKinds.includes(s.kind)&&(row.organizationId===undefined||row.organizationId===null))add('ROW_SCOPE_UNPROVEN');
    if(!legacyInScope(s))add(row.organizationId&&row.organizationId!==scope.legacy.organizationId?'FOREIGN_ORGANIZATION':'OUTSIDE_CLIENT_SCOPE');
    if(s.kind==='client'&&row.id!==scope.legacy.clientId)add('OUTSIDE_CLIENT_SCOPE');if(s.kind==='project'&&row.id!==scope.legacy.projectId)add('OUTSIDE_PROJECT_SCOPE');
    if(s.kind!=='client'&&s.kind!=='actor'&&(!legacyInScope(legacyClient)||!legacyInScope(legacyProject)||legacyProject?.raw.clientId!==scope.legacy.clientId))add('RELATED_RECORD_OUTSIDE_SCOPE');
    if(['document','task','time','invoice'].includes(s.kind)&&row.projectId!==scope.legacy.projectId)add('OUTSIDE_PROJECT_SCOPE');
    if(s.kind==='invoice'&&row.clientId!==scope.legacy.clientId)add('OUTSIDE_CLIENT_SCOPE');
    if(row.createdAt)normalized.createdAt=sourceDate(row.createdAt);if(row.updatedAt)normalized.updatedAt=sourceDate(row.updatedAt);normalized.exportedTimestampsKnown={createdAt:Boolean(row.createdAt),updatedAt:Boolean(row.updatedAt)};if(normalized.createdAt?.utc&&normalized.updatedAt?.utc&&normalized.updatedAt.utc<normalized.createdAt.utc)add('SOURCE_TIMELINE_INCONSISTENT');if(row.deletedAt)add('SOURCE_DELETED');
    if(s.kind==='document'){
     if(typeof row.content!=='string')add('DOCUMENT_CONTENT_INVALID');else if(!row.content.trim())add('EMPTY_DOCUMENT');else if(row.content.length>20000)add('DOCUMENT_TOO_LARGE');
     if(row.accessMode!=='TEAM'||!Array.isArray(row.accessGrants)||row.accessGrants.length||row.audienceBarrier!==null&&row.audienceBarrier!==undefined)add('ACL_UNREPRESENTABLE');if(d?.clientVisible)add('ACL_CANNOT_BROADEN');normalized.text=row.content;normalized.sourceAuthorId=row.authorId;normalized.authorActorId=owner('legacy:'+row.authorId);
     if(row.parentId){const parent=legacyRow('notes',row.parentId);if(!parent)add('PARENT_MISSING');else if(!legacyInScope(parent))add('PARENT_OUTSIDE_SCOPE');else result.parentKey=parent.key;}
    }
    if(s.kind==='task'){normalized.sourceStatus=row.status;normalized.sourceAssigneeId=row.assigneeId??null;if(row.assigneeId)normalized.assigneeActorId=owner('legacy:'+row.assigneeId,false);if(d?.clientVisible&&row.clientVisible!==true)add('ACL_CANNOT_BROADEN');}
    if(s.kind==='time'){
     if(!Number.isSafeInteger(row.duration)||row.duration<0||!Number.isSafeInteger(row.duration*60))fail('DURATION_INVALID');normalized.seconds=row.duration*60;normalized.sourceUnit='minutes';normalized.sourceDate=sourceDate(row.date);normalized.ownerActorId=owner('legacy:'+row.userId);normalized.sourceRateLexeme=s.numberLexemes.hourlyRate??(row.hourlyRate===null?null:String(row.hourlyRate??''));if(row.billable===false&&!d?.currency){normalized.currency=null;normalized.rateMinor=null;}else{normalized.currency=currency(d?.currency);normalized.rateMinor=row.billable===false&&row.hourlyRate===null?null:minorUnits(normalized.sourceRateLexeme);}normalized.currencyOrigin=d?.currency?'operator-assertion':'not-exported';normalized.sourceBillingState={invoiced:row.invoiced,invoiceId:row.invoiceId,reviewStatus:row.reviewStatus};
     result.relatedKeys=[];if(row.invoiced===true&&!row.invoiceId)add('RELATED_RECORD_MISSING');for(const[field,entity]of[['invoiceId','invoices'],['taskId','tasks']])if(row[field]){const related=legacyRow(entity,row[field]);if(!related)add('RELATED_RECORD_MISSING');else if(!legacyInScope(related)||related.raw.projectId!==scope.legacy.projectId||entity==='invoices'&&related.raw.clientId!==scope.legacy.clientId)add('RELATED_RECORD_OUTSIDE_SCOPE');else result.relatedKeys.push(related.key);}
    }
    if(s.kind==='invoice'){
     normalized.currency=currency(row.currency);for(const [field,target]of[['total','totalMinor'],['tax','taxMinor'],['subtotal','subtotalMinor'],['discountAmount','discountMinor']])normalized[target]=minorUnits(s.numberLexemes[field]??String(row[field]??''));const preTax=BigInt(normalized.subtotalMinor)-BigInt(normalized.discountMinor);if(BigInt(normalized.totalMinor)!==(preTax<0n?0n:preTax)+BigInt(normalized.taxMinor))add('INVOICE_TOTAL_MISMATCH');normalized.sourceStatus=row.status;normalized.issueDate=sourceDate(row.issueDate);normalized.dueDate=row.dueDate===null?null:sourceDate(row.dueDate);
     normalized.sourceCreatedById=row.createdById??null;if(row.createdById)normalized.createdByActorId=owner('legacy:'+row.createdById);
    }
    if(s.kind==='payment'){
     const invoice=legacyRow('invoices',row.invoiceId);if(!legacyInScope(invoice)||invoice.raw.clientId!==scope.legacy.clientId||invoice.raw.projectId!==scope.legacy.projectId)add('RELATED_RECORD_OUTSIDE_SCOPE');else{normalized.currency=currency(invoice.raw.currency);result.relatedKey=invoice.key;}normalized.amountMinor=minorUnits(s.numberLexemes.amount??String(row.amount??''));normalized.paidAt=sourceDate(row.paidAt);
    }
    if(s.kind==='file'){
     const matches=manifest.files.filter(f=>f.source==='attachment'&&f.recordId===row.id);if(matches.length!==1)fail('FILE_ORIGINAL_MISSING');const file=matches[0];if(row.entityType!=='PROJECT'||row.entityId!==scope.legacy.projectId)add('FILE_AUDIENCE_UNSUPPORTED');if(d?.clientVisible&&row.clientVisible!==true)add('ACL_CANNOT_BROADEN');if(row.checksumSha256&&row.checksumSha256!==file.sha256)add('FILE_RECORDED_HASH_MISMATCH');if(row.size!==file.size)add('FILE_SIZE_MISMATCH');Object.assign(normalized,{exportPath:file.exportPath,sha256:file.sha256,bytes:file.size,originalName:row.originalName,mimeType:row.mimeType,sourceUploaderId:row.uploadedById,authorActorId:owner('legacy:'+row.uploadedById)});
    }
   }else if(s.source==='bonsai'){
    if(bonsaiClients.length!==1)add('AMBIGUOUS_CLIENT_IDENTITY');if(bonsaiProjects.length!==1)add('AMBIGUOUS_PROJECT_IDENTITY');const client=row.Client??row.client_or_company_name??row.client_name??row.client,project=row.title??row.contractor_project_name??row.project_title??row.project;
    if(client!==scope.bonsai.clientName)add('OUTSIDE_CLIENT_SCOPE');if(project!==undefined&&project!==scope.bonsai.projectTitle)add('OUTSIDE_PROJECT_SCOPE');if(s.kind==='project'&&row.project_id!==scope.bonsai.projectId)add('OUTSIDE_PROJECT_SCOPE');
    normalized.sourceMetadataKnown=false;
    if(s.kind==='invoice'){normalized.currency=currency(row.currency);normalized.totalMinor=minorUnits(row.total_amount);normalized.taxMinor=minorUnits(row.calculated_tax_amount);if(normalized.taxMinor>normalized.totalMinor)add('INVOICE_TOTAL_MISMATCH');normalized.reportedPaidMinor=minorUnits(row.paid_amount);normalized.sourceStatus=row.status;normalized.issueDate=sourceDate(row.issued_date);normalized.dueDate=row.due_date?sourceDate(row.due_date):null;normalized.paidDate=row.paid_date?sourceDate(row.paid_date):null;normalized.paymentDetailVerified=false;}
    if(s.kind==='expense'){normalized.currency=currency(row.currency);normalized.totalMinor=minorUnits(row.amount_after_tax);normalized.preTaxMinor=minorUnits(row.amount_pre_tax);normalized.sourceDate=sourceDate(row.date);}
    if(s.kind==='time'){normalized.seconds=clockSeconds(row.formatted_time);normalized.sourceUnit='hh:mm:ss';normalized.ownerActorId=owner('bonsai:'+row.owner_name);normalized.currency=currency(d?.currency);normalized.currencyOrigin='operator-assertion';normalized.rateMinor=minorUnits(row.rate);normalized.sourceDate=sourceDate(row.date);normalized.sourceBillingState=row.billing_status;}
   }else if(s.kind==='document'){
    if(!row.text.trim())add('EMPTY_DOCUMENT');else if(row.text.length>20000)add('DOCUMENT_TOO_LARGE');
    if(row.text.includes('](')||/^\s*\[[^\]]+\]:/m.test(row.text)||row.text.includes('[['))add('MARKDOWN_LINK_REVIEW_REQUIRED');
    normalized.text=row.text;normalized.sourceMetadataKnown=false;if(s.parentKey){if(!byKey.has(s.parentKey))add('PARENT_MISSING');else result.parentKey=s.parentKey;}
   }
   if(['invoice','payment','time','expense'].includes(s.kind)){normalized.targetDisposition='HISTORICAL_ONLY';normalized.externalProviderEligible=false;if(d?.clientVisible)add('FINANCE_VISIBILITY_UNREVIEWED');}
  }catch(e){add(e.code||'RECORD_INVALID');}
  if(findings.length)result.disposition='HELD';return result;
 });
 const outByKey=new Map(records.map(r=>[r.key,r]));
 const collisions=new Map();for(const r of records){if(r.canonicalId){const key=r.kind+':'+r.canonicalId;const group=collisions.get(key)||[];group.push(r);collisions.set(key,group);}}
 for(const group of collisions.values())if(group.length>1&&!['client','project'].includes(group[0].kind))for(const r of group){r.findings.push('CANONICAL_COLLISION');r.disposition='HELD';}
 for(let pass=0;pass<records.length;pass++){let changed=false;for(const r of records){if(r.parentKey){const parent=outByKey.get(r.parentKey);if(parent?.disposition==='MAPPED')r.normalized.parentCanonicalId=parent.canonicalId;else if(!r.findings.includes('PARENT_UNMAPPED')){r.findings.push('PARENT_UNMAPPED');r.disposition='HELD';changed=true;}}if([...(r.relatedKeys||[]),...(r.relatedKey?[r.relatedKey]:[])].some(key=>outByKey.get(key)?.disposition!=='MAPPED')&&!r.findings.includes('RELATED_RECORD_UNRECONCILED')){r.findings.push('RELATED_RECORD_UNRECONCILED');r.disposition='HELD';changed=true;}}if(!changed)break;}
 // Parent cycles cannot become a valid target tree even if every source row
 // and proposed parent identity exists.
 for(const r of records){const seen=new Set();let current=r;while(current?.parentKey){if(seen.has(current.key)){r.findings.push('PARENT_CYCLE');r.disposition='HELD';break;}seen.add(current.key);current=outByKey.get(current.parentKey);}}
 if(['client','project'].some(kind=>outByKey.get(mapping.authority[kind])?.disposition!=='MAPPED'))for(const r of records){r.findings.push('CANONICAL_AUTHORITY_UNMAPPED');r.disposition='HELD';}
 const candidates=[];for(const group of collisions.values()){const mapped=group.filter(r=>r.disposition==='MAPPED');if(!mapped.length)continue;const kind=mapped[0].kind;const authorityKey=['client','project'].includes(kind)?mapping.authority[kind]:mapped[0].key;const authority=mapped.find(r=>r.key===authorityKey);if(!authority){for(const r of mapped){r.findings.push('AUTHORITY_UNMAPPED');r.disposition='HELD';}continue;}candidates.push({canonicalId:authority.canonicalId,kind,authorityKey,sourceKeys:mapped.map(r=>r.key).sort(),stage:'PROPOSED_NOT_TARGET_VERIFIED'});}
 const totals={bonsai:{},legacy:{}};for(const r of records.filter(r=>r.disposition==='MAPPED')){const n=r.normalized;if(!n.currency)continue;const bucket=totals[r.source][n.currency]??={invoiceTotalMinor:0,invoiceTaxMinor:0,invoiceSubtotalMinor:0,invoicePaidMinor:0,expenseTotalMinor:0};const add=(k,v)=>{if(bucket[k]===null)return;const sum=BigInt(bucket[k])+BigInt(v);if(sum>BigInt(Number.MAX_SAFE_INTEGER))fail('TOTAL_OVERFLOW');bucket[k]=Number(sum);};if(r.kind==='invoice'){add('invoiceTotalMinor',n.totalMinor);add('invoiceTaxMinor',n.taxMinor);if(n.subtotalMinor!==undefined)add('invoiceSubtotalMinor',n.subtotalMinor);else bucket.invoiceSubtotalMinor=null;if(n.reportedPaidMinor!==undefined)add('invoicePaidMinor',n.reportedPaidMinor);}if(r.kind==='payment')add('invoicePaidMinor',n.amountMinor);if(r.kind==='expense')add('expenseTotalMinor',n.totalMinor);}
 for(const source of sources)if(pinImage(pins(await scan(join(root,source))))!==pinImage(mapping.pins[source]))fail('SOURCE_CHANGED');
 return {version:1,mode:'offline-pilot-reconciliation',fingerprint:hash(stable({mapping,inventories:Object.fromEntries(sources.map(s=>[s,pins(files[s])]))})),target:{...mapping.target},migrationReady:false,targetWrites:0,externalEffects:[],counts:{sourceRecords:records.length,mapped:records.filter(r=>r.disposition==='MAPPED').length,held:records.filter(r=>r.disposition==='HELD').length},coverage:{unsupportedArtifacts:'held whole; contained record count unknown',metadata:'operator assertions are separate from exported source facts',totals:'mapped valid reported records only; source/currency ledgers never combined',excludedFinancialRecords:records.filter(r=>r.disposition==='HELD'&&['invoice','payment','time','expense'].includes(r.kind)).map(r=>r.key),legacyExclusions:manifest.exclusions,legacyExclusionsSha256:mapping.legacyExclusionsSha256},sourceFiles:Object.fromEntries(sources.map(s=>[s,pins(files[s])])),records,candidates,totals};
}

export async function runPilotReconciliation(argv,io=process.stdout){
 const options={};if(argv.length!==6)fail('ARGUMENT_INVALID');for(let i=0;i<argv.length;i+=2){if(!['--input','--mapping','--report'].includes(argv[i])||Object.hasOwn(options,argv[i])||!argv[i+1])fail('ARGUMENT_INVALID');options[argv[i]]=argv[i+1];}
 const input=resolve(options['--input']),requested=resolve(options['--report']),inputReal=await realpath(input),reportPath=join(await realpath(dirname(requested)),basename(requested)),distance=relative(inputReal,reportPath);if(!distance||!isAbsolute(distance)&&distance!=='..'&&!distance.startsWith('..'+sep))fail('REPORT_INSIDE_SOURCE');
 const file=resolve(options['--mapping']),stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>1024*1024)fail('MAPPING_INVALID');let mapping;try{mapping=JSON.parse(await readFile(file,'utf8'));}catch{fail('MAPPING_INVALID');}
 const report=await reconcilePilot(input,mapping);try{await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')fail('REPORT_EXISTS');throw e;}
 const summary={fingerprint:report.fingerprint,...report.counts,migrationReady:false,targetWrites:0};io.write(JSON.stringify(summary)+'\n');return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runPilotReconciliation(process.argv.slice(2)).catch(e=>{process.stderr.write(JSON.stringify({code:e.code||'PILOT_INVALID'})+'\n');process.exitCode=1;});
