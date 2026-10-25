import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,symlink,unlink,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {makePilotFixture} from './pilot-source-fixture.mjs';
import {reconcilePilot,runPilotReconciliation} from './pilot-reconcile.mjs';
import {verifyWorkspaceExportDirectory} from '../../src/services/workspace-export.service.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fixture=async()=>makePilotFixture(await mkdtemp(join(tmpdir(),'ashbi-source-pilot-')));
const get=(report,key)=>report.records.find(r=>r.key===key);
const held=(report,key,reason)=>{const row=get(report,key);assert.equal(row.disposition,'HELD');assert.ok(row.findings.includes(reason),JSON.stringify(row.findings));return row;};
const change=async(f,path,from,to)=>{const file=join(f.root,path),text=await readFile(file,'utf8');assert.ok(text.includes(from));await writeFile(file,text.replace(from,to));};

test('one pinned synthetic client/project reconciles all rows without writes or invented billing/access actions',async()=>{
 const f=await fixture(),report=await reconcilePilot(f.root,f.mapping);
 assert.equal(report.migrationReady,false);assert.equal(report.targetWrites,0);assert.deepEqual(report.externalEffects,[]);
 assert.deepEqual(report.counts,{sourceRecords:19,mapped:17,held:2});
 for(const key of f.expected.holdKeys)assert.equal(get(report,key).disposition,'HELD');
 assert.equal(get(report,'notion:Handbook.md').raw.text,f.expected.handbook);
 assert.equal(get(report,'notion:Handbook/Onboarding.md').normalized.parentCanonicalId,'notion-handbook');
 assert.equal(get(report,'legacy:notes:legacy-note').raw.authorId,'legacy-staff');
 assert.equal(get(report,'legacy:notes:legacy-note').normalized.createdAt.source,'2025-01-01T10:00:00-05:00');
 assert.equal(get(report,'notion:Handbook.md').normalized.sourceMetadataKnown,false);
 assert.equal(get(report,'bonsai:time-entries.csv:2').normalized.seconds,3601);
 assert.equal(get(report,'legacy:time_entries:legacy-time').normalized.seconds,3660);
 assert.equal(get(report,'legacy:time_entries:legacy-time').normalized.targetDisposition,'HISTORICAL_ONLY');
 assert.equal(get(report,'legacy:time_entries:legacy-time').normalized.startedAt,undefined);
 assert.equal(get(report,'legacy:invoices:legacy-invoice').normalized.totalMinor,11300);
 assert.equal(get(report,'legacy:invoice_payments:legacy-payment').normalized.amountMinor,11300);
 assert.equal(report.totals.bonsai.CAD.invoiceTotalMinor,11300);assert.equal(report.totals.bonsai.USD.invoiceTotalMinor,2000);assert.equal(report.totals.legacy.CAD.invoiceTotalMinor,11300);
 assert.equal(report.totals.combined,undefined);
 assert.equal(get(report,'legacy:attachments:legacy-attachment').normalized.sha256,f.expected.attachmentSha256);
 assert.equal(report.candidates.filter(c=>c.kind==='client').length,1);assert.equal(report.candidates.filter(c=>c.kind==='project').length,1);
 assert.equal(report.candidates.find(c=>c.kind==='client').authorityKey,f.mapping.authority.client);
 assert.deepEqual(await reconcilePilot(f.root,f.mapping),report,'unchanged retry is byte-image stable with no generated IDs/timestamps');
});

test('changed bytes require fresh inventory and per-record decision hashes; refresh never mutates the old report',async()=>{
 const f=await fixture(),before=await reconcilePilot(f.root,f.mapping);
 await change(f,'notion/Handbook.md','Handbook','Changed handbook');
 await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'SOURCE_CHANGED'});
 await f.repin();const stale=await reconcilePilot(f.root,f.mapping);held(stale,'notion:Handbook.md','REVIEW_STALE');
 await f.repin({decisions:true});const after=await reconcilePilot(f.root,f.mapping);assert.notEqual(after.fingerprint,before.fingerprint);assert.equal(get(before,'notion:Handbook.md').raw.text,f.expected.handbook);assert.equal(get(after,'notion:Handbook.md').canonicalId,get(before,'notion:Handbook.md').canonicalId);assert.equal(after.targetWrites,0);
});

test('unknown currency, unmapped owner and a sub-cent historical amount are held without rounding',async()=>{
 const f=await fixture();await change(f,'bonsai/invoices.csv','"113"','"113.005"');delete f.mapping.actors['bonsai:Fixture Staff'];delete f.mapping.records.find(r=>r.key==='legacy:time_entries:legacy-time').currency;await f.repin({decisions:true});const r=await reconcilePilot(f.root,f.mapping);
 held(r,'bonsai:invoices.csv:2','MONEY_INVALID');held(r,'bonsai:time-entries.csv:2','OWNER_UNMAPPED');held(r,'legacy:time_entries:legacy-time','CURRENCY_REQUIRED');assert.equal(r.totals.bonsai.CAD?.invoiceTotalMinor??0,0);
});

test('legacy JSON number lexemes retain unsupported precision rather than rounding before reconciliation',async()=>{
 const f=await fixture();await change(f,'legacy/data/invoices.jsonl','"total":113','"total":0.10000000000000001');await f.repin({decisions:true});const r=await reconcilePilot(f.root,f.mapping);const row=held(r,'legacy:invoices:legacy-invoice','MONEY_INVALID');assert.ok(row.rawText.includes('0.10000000000000001'));assert.equal(row.provenance.recordSha256,sha(row.rawText));
});

test('note barriers, missing parents, foreign source rows and related foreign payment records remain held',async()=>{
 const f=await fixture();await change(f,'legacy/data/notes.jsonl','"accessGrants":[]','"accessGrants":[{"userId":"legacy-staff"}]');await change(f,'legacy/data/invoices.jsonl','"organizationId":"legacy-org"','"organizationId":"foreign-org"');await f.repin({decisions:true});let r=await reconcilePilot(f.root,f.mapping);held(r,'legacy:notes:legacy-note','ACL_UNREPRESENTABLE');held(r,'legacy:invoices:legacy-invoice','FOREIGN_ORGANIZATION');held(r,'legacy:invoice_payments:legacy-payment','RELATED_RECORD_OUTSIDE_SCOPE');
 await change(f,'legacy/data/notes.jsonl','"parentId":null','"parentId":"missing-parent"');await f.repin({decisions:true});r=await reconcilePilot(f.root,f.mapping);held(r,'legacy:notes:legacy-note','PARENT_MISSING');
});

test('missing originals, changed original bytes and source-manifest or exclusion mismatches fail closed',async()=>{
 const f=await fixture();await writeFile(join(f.root,'legacy',f.expected.attachmentPath),'replacement');await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'SOURCE_CHANGED'});await f.repin({decisions:true});held(await reconcilePilot(f.root,f.mapping),'legacy:attachments:legacy-attachment','FILE_RECORDED_HASH_MISMATCH');
 f.mapping.legacyManifestSha256='0'.repeat(64);await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'LEGACY_EXPORT_INVALID'});
 await f.repin({decisions:true});f.mapping.legacyExclusionsSha256='0'.repeat(64);await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'EXCLUSIONS_UNREVIEWED'});
});

test('missing decisions, canonical collisions and undeclared source client aliases never silently merge',async()=>{
 const f=await fixture();f.mapping.records=f.mapping.records.filter(r=>r.key!=='notion:Handbook.md');let r=await reconcilePilot(f.root,f.mapping);held(r,'notion:Handbook.md','MAPPING_REQUIRED');held(r,'notion:Handbook/Onboarding.md','PARENT_UNMAPPED');
 f.mapping.records.find(r=>r.key==='legacy:notes:legacy-note').canonicalId='notion-onboarding';r=await reconcilePilot(f.root,f.mapping);held(r,'legacy:notes:legacy-note','CANONICAL_COLLISION');
 f.mapping.sourceScope.bonsai.clientName='Different client';r=await reconcilePilot(f.root,f.mapping);held(r,'bonsai:invoices.csv:2','OUTSIDE_CLIENT_SCOPE');
});

test('mapping duplicates, orphan decisions and unsafe input/output paths are rejected',async()=>{
 const f=await fixture();f.mapping.records.push({...f.mapping.records[0]});await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'MAPPING_DUPLICATE'});f.mapping.records.pop();f.mapping.records.push({...f.mapping.records[0],key:'notion:missing.md'});await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'MAPPING_ORPHAN'});f.mapping.records.pop();
 f.mapping.pins.notion[0].path='../outside.md';await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'MAPPING_INVALID'});
});

test('CSV schema discrepancies and symlinked source trees are rejected before following them',async()=>{
 const f=await fixture();await change(f,'bonsai/clients.csv','"Client"','"Wrong column"');await f.repin({decisions:true});await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'CSV_HEADER_INVALID'});
 const outside=await mkdtemp(join(tmpdir(),'ashbi-pilot-link-'));await writeFile(join(outside,'synthetic.txt'),'synthetic');await symlink(outside,join(f.root,'notion','linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'SOURCE_LINK_REFUSED'});
});

test('source owner roles and organizations cannot be translated into a different staff identity',async()=>{
 const f=await fixture();await change(f,'legacy/data/users.jsonl','"organizationId":"legacy-org"','"organizationId":"foreign-org"');await f.repin({decisions:true});let r=await reconcilePilot(f.root,f.mapping);held(r,'legacy:notes:legacy-note','OWNER_OUTSIDE_SCOPE');held(r,'legacy:time_entries:legacy-time','OWNER_OUTSIDE_SCOPE');
 await change(f,'legacy/data/users.jsonl','"organizationId":"foreign-org"','"organizationId":"legacy-org"');await change(f,'legacy/data/users.jsonl','"role":"TEAM"','"role":"CLIENT"');await f.repin({decisions:true});r=await reconcilePilot(f.root,f.mapping);held(r,'legacy:tasks:legacy-task','OWNER_ROLE_UNSUPPORTED');
});

test('unproven source scope and missing canonical authority prevent a coherent target proposal',async()=>{
 const f=await fixture();await change(f,'legacy/data/clients.jsonl','"organizationId":"legacy-org",','');await f.repin({decisions:true});let r=await reconcilePilot(f.root,f.mapping);held(r,'legacy:clients:legacy-client','ROW_SCOPE_UNPROVEN');assert.equal(r.candidates.length,0);
 f.mapping.authority.client='notion:Handbook.md';await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'AUTHORITY_INVALID'});
});

test('CLI output directory aliases and Windows path casing cannot write into source trees',async()=>{
 const f=await fixture(),parent=await mkdtemp(join(tmpdir(),'ashbi-pilot-output-link-')),mapping=join(parent,'mapping.json');await writeFile(mapping,JSON.stringify(f.mapping));await symlink(join(f.root,'notion'),join(parent,'output-alias'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(()=>runPilotReconciliation(['--input',f.root,'--mapping',mapping,'--report',join(parent,'output-alias','report.json')],{write(){}}),{code:'REPORT_INSIDE_SOURCE'});
 if(process.platform==='win32')await assert.rejects(()=>runPilotReconciliation(['--input',f.root,'--mapping',mapping,'--report',join(f.root.toUpperCase(),'report.json')],{write(){}}),{code:'REPORT_INSIDE_SOURCE'});
});

test('empty or unrepresentable documents stay held and orphan original objects remain explicit outcomes',async()=>{
 const f=await fixture();await writeFile(join(f.root,'notion/Handbook.md'),' \n');await change(f,'legacy/data/notes.jsonl','"content":"Private caf\u00e9 note\\n- [x] Original checklist"','"content":null');await writeFile(join(f.root,'legacy/data/attachments.jsonl'),'');f.mapping.records=f.mapping.records.filter(r=>r.key!=='legacy:attachments:legacy-attachment');await f.repin({decisions:true});const r=await reconcilePilot(f.root,f.mapping);
 held(r,'notion:Handbook.md','EMPTY_DOCUMENT');held(r,'legacy:notes:legacy-note','DOCUMENT_CONTENT_INVALID');held(r,'legacy:original:'+f.expected.attachmentPath,'ORPHAN_ORIGINAL');
});

test('historical invoice totals honor the legacy stored discount formula without recalculating tax',async()=>{
 const f=await fixture();await change(f,'legacy/data/invoices.jsonl','"tax":13','"tax":99');await f.repin({decisions:true});held(await reconcilePilot(f.root,f.mapping),'legacy:invoices:legacy-invoice','INVOICE_TOTAL_MISMATCH');
 await change(f,'legacy/data/invoices.jsonl','"tax":99','"tax":13');await change(f,'legacy/data/invoices.jsonl','"discountAmount":0','"discountAmount":10');await change(f,'legacy/data/invoices.jsonl','"total":113','"total":103');await f.repin({decisions:true});const r=await reconcilePilot(f.root,f.mapping);assert.equal(get(r,'legacy:invoices:legacy-invoice').disposition,'MAPPED');assert.equal(get(r,'legacy:invoices:legacy-invoice').normalized.discountMinor,1000);
});

test('null legacy invoice due dates and unexported Bonsai subtotals remain unknown',async()=>{
 const f=await fixture();await change(f,'legacy/data/invoices.jsonl','"dueDate":"2025-02-01T10:00:00-05:00"','"dueDate":null');await f.repin({decisions:true});const r=await reconcilePilot(f.root,f.mapping);assert.equal(get(r,'legacy:invoices:legacy-invoice').disposition,'MAPPED');assert.equal(get(r,'legacy:invoices:legacy-invoice').normalized.dueDate,null);assert.equal(r.totals.bonsai.CAD.invoiceSubtotalMinor,null);
});

test('self-parent cycles, deleted source notes and target-oversized Markdown never become candidates',async()=>{
 const f=await fixture();await change(f,'legacy/data/notes.jsonl','"parentId":null','"parentId":"legacy-note"');await writeFile(join(f.root,'notion/Handbook.md'),'x'.repeat(20001));await f.repin({decisions:true});let r=await reconcilePilot(f.root,f.mapping);held(r,'legacy:notes:legacy-note','PARENT_CYCLE');held(r,'notion:Handbook.md','DOCUMENT_TOO_LARGE');assert.ok(!r.candidates.some(c=>c.canonicalId==='canonical-legacy-note'));
 await change(f,'legacy/data/notes.jsonl','"deletedAt":null','"deletedAt":"2025-02-01T00:00:00Z"');await f.repin({decisions:true});r=await reconcilePilot(f.root,f.mapping);held(r,'legacy:notes:legacy-note','SOURCE_DELETED');
});

test('native byte verification alone cannot accept declared legacy export exceptions or changed exclusions',async()=>{
 const f=await fixture();async function amend(fn){const path=join(f.root,'legacy/manifest.json'),m=JSON.parse(await readFile(path,'utf8'));fn(m);await writeFile(path,JSON.stringify(m)+'\n');const digest=sha(await readFile(path));await writeFile(join(f.root,'legacy/SHA256SUMS'),(await readFile(join(f.root,'legacy/SHA256SUMS'),'utf8')).replace(/^[a-f0-9]{64}  manifest.json$/m,digest+'  manifest.json'));for(const p of f.mapping.pins.legacy.filter(p=>['manifest.json','SHA256SUMS'].includes(p.path))){const bytes=await readFile(join(f.root,'legacy',p.path));p.bytes=bytes.length;p.sha256=sha(bytes);}f.mapping.legacyManifestSha256=digest;}
 await amend(m=>{m.exceptions=[{code:'SYNTHETIC_MISSING_HISTORY'}];m.totals.exceptions=1;});assert.equal((await verifyWorkspaceExportDirectory(join(f.root,'legacy'),{expectedManifestSha256:f.mapping.legacyManifestSha256})).valid,true);await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'LEGACY_EXPORT_INVALID'});
 await f.repin();await amend(m=>{if(Array.isArray(m.exclusions))m.exclusions.push({key:'syntheticUnknownHistory',reason:'not exported'});else m.exclusions.syntheticUnknownHistory='not exported';});await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'EXCLUSIONS_UNREVIEWED'});
});

test('missing original files and oversized input are rejected while every source remains untouched',async()=>{
 const f=await fixture(),original=join(f.root,'legacy',f.expected.attachmentPath);await unlink(original);await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'SOURCE_CHANGED'});await writeFile(original,f.expected.attachmentBytes);const r=await reconcilePilot(f.root,f.mapping);assert.equal(r.counts.sourceRecords,19);await writeFile(join(f.root,'notion/oversized.md'),'');await truncate(join(f.root,'notion/oversized.md'),16*1024*1024+1);await assert.rejects(()=>reconcilePilot(f.root,f.mapping),{code:'SOURCE_LIMIT'});
});

test('actual CLI entry point prints sanitized aggregate success and sanitized failure without importing targets',async()=>{
 const f=await fixture(),parent=await mkdtemp(join(tmpdir(),'ashbi-pilot-cli-')),mapping=join(parent,'mapping.json'),report=join(parent,'report.json');await writeFile(mapping,JSON.stringify(f.mapping));const cli=fileURLToPath(new URL('./pilot-reconcile.mjs',import.meta.url)),exec=promisify(execFile),args=[cli,'--input',f.root,'--mapping',mapping,'--report',report];
 const result=await exec(process.execPath,args);assert.deepEqual(Object.keys(JSON.parse(result.stdout)).sort(),['fingerprint','held','mapped','migrationReady','sourceRecords','targetWrites'].sort());assert.equal(result.stderr,'');assert.ok(!result.stdout.includes('Fixture Co'));
 await assert.rejects(()=>exec(process.execPath,args),error=>{assert.equal(error.code,1);assert.deepEqual(JSON.parse(error.stderr),{code:'REPORT_EXISTS'});assert.equal(error.stdout,'');return true;});
});

test('Markdown attachment/link semantics stay held and original dates cannot silently reverse',async()=>{
 const f=await fixture();await writeFile(join(f.root,'notion/Handbook.md'),'# Source attachment\n\n[Original](missing.pdf)\n');await change(f,'legacy/data/notes.jsonl','"updatedAt":"2025-01-01T10:00:00-05:00"','"updatedAt":"2024-01-01T10:00:00-05:00"');await f.repin({decisions:true});const r=await reconcilePilot(f.root,f.mapping);held(r,'notion:Handbook.md','MARKDOWN_LINK_REVIEW_REQUIRED');held(r,'legacy:notes:legacy-note','SOURCE_TIMELINE_INCONSISTENT');
});

test('unbillable legacy time can preserve an unknown rate/currency without a fabricated financial value',async()=>{
 const f=await fixture();await change(f,'legacy/data/time_entries.jsonl','"billable":true','"billable":false');await change(f,'legacy/data/time_entries.jsonl','"hourlyRate":100','"hourlyRate":null');delete f.mapping.records.find(r=>r.key==='legacy:time_entries:legacy-time').currency;await f.repin({decisions:true});const r=await reconcilePilot(f.root,f.mapping),row=get(r,'legacy:time_entries:legacy-time');assert.equal(row.disposition,'MAPPED');assert.equal(row.normalized.currency,null);assert.equal(row.normalized.rateMinor,null);assert.equal(row.normalized.seconds,3660);assert.equal(row.normalized.targetDisposition,'HISTORICAL_ONLY');
});

test('historical time resolves billed invoice and task references and propagates held/deleted relations',async()=>{
 for(const fault of['missing-invoice','foreign-invoice','held-invoice','missing-task','deleted-task','billed-without-invoice']){
  const f=await fixture();if(fault==='missing-invoice')await change(f,'legacy/data/time_entries.jsonl','"invoiceId":"legacy-invoice"','"invoiceId":"missing"');
  if(fault==='foreign-invoice')await change(f,'legacy/data/invoices.jsonl','"organizationId":"legacy-org"','"organizationId":"foreign-org"');
  if(fault==='held-invoice'){const d=f.mapping.records.find(r=>r.key==='legacy:invoices:legacy-invoice');d.disposition='HOLD';d.reason='Synthetic unresolved original invoice';}
  if(fault==='missing-task')await change(f,'legacy/data/time_entries.jsonl','"taskId":"legacy-task"','"taskId":"missing"');
  if(fault==='deleted-task')await change(f,'legacy/data/tasks.jsonl','"deletedAt":null','"deletedAt":"2025-02-01T00:00:00Z"');
  if(fault==='billed-without-invoice')await change(f,'legacy/data/time_entries.jsonl','"invoiceId":"legacy-invoice"','"invoiceId":null');
  await f.repin({decisions:true});const r=await reconcilePilot(f.root,f.mapping);held(r,'legacy:time_entries:legacy-time',fault==='foreign-invoice'?'RELATED_RECORD_OUTSIDE_SCOPE':['held-invoice','deleted-task'].includes(fault)?'RELATED_RECORD_UNRECONCILED':'RELATED_RECORD_MISSING');
 }
});

test('historical task assignee may differ from the author while each source identity remains explicit',async()=>{
 const f=await fixture(),user={...f.expected.legacyRows.users[0],id:'legacy-cameron',name:'Fixture Cameron',email:'cameron@example.invalid'};await writeFile(join(f.root,'legacy/data/users.jsonl'),(await readFile(join(f.root,'legacy/data/users.jsonl'),'utf8'))+JSON.stringify(user)+'\n');await change(f,'legacy/data/tasks.jsonl','"assigneeId":"legacy-staff"','"assigneeId":"legacy-cameron"');f.mapping.actors['legacy:legacy-cameron']='cameron';await f.repin({decisions:true});const r=await reconcilePilot(f.root,f.mapping),row=get(r,'legacy:tasks:legacy-task');assert.equal(row.disposition,'MAPPED');assert.equal(row.normalized.assigneeActorId,'cameron');assert.equal(row.normalized.mappingMetadata.authorActorId,'bianca');assert.equal(row.raw.assigneeId,'legacy-cameron');
});

test('CLI writes a private exclusive report, prints only aggregate evidence and refuses output inside sources',async()=>{
 const f=await fixture(),parent=await mkdtemp(join(tmpdir(),'ashbi-pilot-report-')),mapping=join(parent,'mapping.json'),output=join(parent,'report.json');await writeFile(mapping,JSON.stringify(f.mapping));let printed='';const io={write:s=>{printed+=s;}};
 const result=await runPilotReconciliation(['--input',f.root,'--mapping',mapping,'--report',output],io);assert.equal(result.held,2);assert.ok(!printed.includes('Fixture Co'));assert.ok(!printed.includes('café'));assert.equal(JSON.parse(await readFile(output,'utf8')).targetWrites,0);
 await assert.rejects(()=>runPilotReconciliation(['--input',f.root,'--mapping',mapping,'--report',output],io),{code:'REPORT_EXISTS'});
 await assert.rejects(()=>runPilotReconciliation(['--input',f.root,'--mapping',mapping,'--report',join(f.root,'report.json')],io),{code:'REPORT_INSIDE_SOURCE'});
 await assert.rejects(()=>runPilotReconciliation(['--input',f.root,'--mapping',mapping,'--report',join(parent,'other.json'),'--apply','true'],io),{code:'ARGUMENT_INVALID'});
});
