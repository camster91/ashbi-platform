import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateRawSync,crc32} from 'node:zlib';
import {fileURLToPath} from 'node:url';

export const TITLE='client contact navigates portal tabs, uploads, chats and cancels a delete with the keyboard only';
const PROJECTS=['chromium','firefox','webkit','Mobile Chrome','Mobile Safari'];
const SOURCE='tests/keyboard-journeys.spec.ts';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const closed=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const loopback=value=>{try{const u=new URL(value);return ['http:','https:','ws:','wss:'].includes(u.protocol)&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&(!u.username&&!u.password)&&[...u.searchParams].every(([k,v])=>!/(token|secret|password|credential|authorization)/i.test(k)||v==='portal-keyboard-token');}catch{return false;}};

// Read the bounded ordinary ZIP format emitted by Playwright. Never extract paths.
export function readTraceZip(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>32*1024**2||bytes.length<22)fail('trace-size');
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==bytes.readUInt16LE(end+10)||end+22+bytes.readUInt16LE(end+20)!==bytes.length)fail('trace-zip');
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);if(count>2000||start+size!==end)fail('trace-zip');
 const entries=new Map();let offset=start,total=0;
 for(let i=0;i<count;i++){
  if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)fail('trace-zip');
  const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),compressed=bytes.readUInt32LE(offset+20),length=bytes.readUInt32LE(offset+24),nl=bytes.readUInt16LE(offset+28),xl=bytes.readUInt16LE(offset+30),cl=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
  if(flags&1||![0,8].includes(method)||length>8*1024**2||(total+=length)>64*1024**2||offset+46+nl+xl+cl>end)fail('trace-zip');
  const name=bytes.subarray(offset+46,offset+46+nl).toString('utf8');if(entries.has(name)||!(/^[a-zA-Z0-9_-]+\.(trace|network|stacks)$/.test(name)||/^resources\/[a-f0-9]{40}(\.[a-z0-9]+)?$/.test(name)||/^screencast\/page@[a-f0-9]{32}-[0-9]{13}\.jpeg$/.test(name)))fail('trace-entry-scope');
  if(local+30>start||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+8)!==method||bytes.readUInt16LE(local+6)!==flags||(!(flags&8)&&bytes.readUInt32LE(local+14)!==bytes.readUInt32LE(offset+16)))fail('trace-zip');
  const lnl=bytes.readUInt16LE(local+26),lxl=bytes.readUInt16LE(local+28),data=local+30+lnl+lxl;
  if(bytes.subarray(local+30,local+30+lnl).toString('utf8')!==name||data+compressed>start)fail('trace-zip');
  const content=method===0?bytes.subarray(data,data+compressed):inflateRawSync(bytes.subarray(data,data+compressed),{maxOutputLength:8*1024**2});if(content.length!==length||crc32(content)!==bytes.readUInt32LE(offset+16))fail('trace-zip');
  entries.set(name,content);offset+=46+nl+xl+cl;
 }
 if(offset!==end||![...entries.keys()].some(n=>n.endsWith('.trace')))fail('trace-missing');return entries;
}

export function validateTrace(bytes,{screenshots=false}={}){
 const entries=readTraceZip(bytes);let contexts=0,network=0;
 for(const [name,content] of entries){
  if(name.startsWith('screencast/')){if(!screenshots||content.length<4||content[0]!==0xff||content[1]!==0xd8||content.at(-2)!==0xff||content.at(-1)!==0xd9)fail('trace-screencast');continue;}
  const text=content.toString('utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|Bearer\s+eyJ[a-zA-Z0-9_-]+\.|eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(text))fail('trace-secret');
  if(name.startsWith('resources/'))continue;
  let rows;try{rows=name.endsWith('.stacks')?[JSON.parse(text)]:text.split('\n').filter(Boolean).map(l=>JSON.parse(l));}catch{fail('trace-json');}
  let loopbackContext=false;
  for(const row of rows){
   if(row.type==='context-options'){contexts++;if(row.options?.baseURL&&!loopback(row.options.baseURL))fail('trace-origin');loopbackContext=Boolean(row.options?.baseURL&&loopback(row.options.baseURL));}
   if(row.type==='resource-snapshot'){
    network++;const request=row.snapshot?.request;if(!request||!loopback(request.url))fail('trace-origin');
    for(const header of [...(request.headers||[]),...(row.snapshot?.response?.headers||[])])if(/^(authorization|cookie|set-cookie|x-api-key)$/i.test(header.name)&&header.value&&!/^(?:Bearer )?portal-keyboard-token$/.test(header.value)&&!/^(?:portal_token|portalToken|portal_session)=portal-keyboard-token$/.test(header.value))fail('trace-secret');
    for(const cookie of [...(request.cookies||[]),...(row.snapshot?.response?.cookies||[])])if(cookie.value&&cookie.value!=='portal-keyboard-token')fail('trace-secret');
   }
   if(row.type==='frame-snapshot'&&row.snapshot?.frameUrl&&!loopback(row.snapshot.frameUrl)&&row.snapshot.frameUrl!=='about:blank')fail('trace-origin');
   if(row.type==='before'&&row.method==='goto'&&row.params?.url&&!loopback(row.params.url)
    &&!(loopbackContext&&row.params.url==='/client-portal/verify?token=portal-keyboard-token'))fail('trace-origin');
  }
 }
 if(!contexts)fail('trace-provenance');return {entries:entries.size,networkRequests:network};
}

export function sanitizeChronology(value,identity){
 if(!closed(value,['schemaVersion','issue','title','projectName','retry','repeatEachIndex','synthetic','sourceMarker','originScope','tracePolicy','boundary','events','status','browserName','browserVersion','fontChecks'])||value.schemaVersion!==1||value.issue!==659||value.title!==TITLE||value.projectName!==identity.project||value.retry!==identity.retry||value.repeatEachIndex!==(identity.repeatEachIndex??0)||value.synthetic!==true||value.sourceMarker!=='portal-chooser-659-v1'||value.originScope!=='loopback-only')fail('chronology-provenance');
 if(!closed(value.tracePolicy,['mode','sources','attachments','screenshots','snapshots'])||value.tracePolicy.mode!=='on'||value.tracePolicy.sources!==false||value.tracePolicy.attachments!==false||typeof value.tracePolicy.screenshots!=='boolean'||value.tracePolicy.snapshots!==true)fail('chronology-trace-policy');
 if(!closed(value.boundary,['externalBlockedCount','unexpectedApiCount','drainStatus','truncated'])||!Number.isSafeInteger(value.boundary.externalBlockedCount)||value.boundary.externalBlockedCount<0||!Number.isSafeInteger(value.boundary.unexpectedApiCount)||value.boundary.unexpectedApiCount<0||typeof value.boundary.truncated!=='boolean'||!['complete','page_closed','unavailable'].includes(value.boundary.drainStatus))fail('chronology-boundary');
 if(!closed(value.fontChecks,['status','registeredDmSans','dmSans400','dmSans500','dmSans600'])||!['loaded','loading','unavailable'].includes(value.fontChecks.status)||!['registeredDmSans','dmSans400','dmSans500','dmSans600'].every(k=>typeof value.fontChecks[k]==='boolean'))fail('chronology-font-checks');
 if(!Array.isArray(value.events)||value.events.length>560)fail('chronology-events');
 if(value.status!==undefined&&!['passed','failed','timedOut','interrupted','skipped'].includes(value.status))fail('chronology-status');
 if(value.browserName!==undefined&&!['chromium','firefox','webkit'].includes(value.browserName))fail('chronology-browser');
 if(value.browserVersion!==undefined&&!/^\d+(?:\.\d+){1,3}$/.test(value.browserVersion))fail('chronology-browser');
 const aliases=['upload-button','file-input','portal-tab','textarea','button','link','body','other','none'];
 const nodeEvents=['START','LISTENER_ARMED','ENTER_START','ENTER_END','FILECHOOSER','SETFILES_START','SETFILES_END','UPLOAD_ASSERTED','BODY_COMPLETED','BODY_FAILED','FLUSH','REQUEST','REQUEST_FINISHED','REQUEST_FAILED','PAGE_ERROR','CRASH','CONSOLE_ERROR','BOUNDARY_BLOCK','UPLOAD_FOCUS_START','UPLOAD_FOCUS_CONFIRMED'];
 const browserEvents=['FOCUS_IN','FOCUS_OUT','WINDOW_FOCUS','WINDOW_BLUR','VISIBILITY','KEY_DOWN','KEY_UP','CLICK','UPLOAD_CONNECTED','UPLOAD_DISCONNECTED','UPLOAD_ATTRIBUTES'];
 const requests=['AUTH_ME','VERIFY_TOKEN','PORTAL_ME','PROJECTS','INVOICES','CONTRACTS','RETAINER','UNREAD','PROJECT','TASKS','RESOURCES','DOCUMENTS','UPLOAD','MESSAGES','DELETE_DOCUMENT','DOCUMENT','SCRIPT','STYLE','FONT','IMAGE','VITE','UNAPPROVED'];
 const bools=['connected','disabled','activeConnected','activeDisabled','hasFocus','userActive','userEverActive','trusted','defaultPrevented'];
 const browserKeys=['phase','target','active','generation','activeGeneration',...bools,'visibility','key','path','targetTag'];
 const last={node:{seq:-1,ms:-1,count:0},browser:{seq:-1,ms:-1,count:0}};
 for(const event of value.events){
  if(!object(event)||!['node','browser'].includes(event.clock)||!closed(event,['seq','clock','ms','event',...(event.clock==='node'?['requestAlias','method','kind']:browserKeys)]))fail('chronology-event');
  const state=last[event.clock];if(!Number.isSafeInteger(event.seq)||event.seq<=state.seq||!Number.isFinite(event.ms)||event.ms<state.ms||event.ms<0||!Number.isSafeInteger(event.seq)||++state.count>(event.clock==='node'?160:400))fail('chronology-event-order');state.seq=event.seq;state.ms=event.ms;
  if(!(event.clock==='node'?nodeEvents:browserEvents).includes(event.event))fail('chronology-event-code');
  if(event.clock==='node'){
   if(event.requestAlias!==undefined&&!requests.includes(event.requestAlias)||event.method!==undefined&&!['GET','POST','DELETE','OTHER'].includes(event.method)||event.kind!==undefined&&!['external','api','asset'].includes(event.kind))fail('chronology-event-field');
  }else{
   for(const k of bools)if(event[k]!==undefined&&typeof event[k]!=='boolean')fail('chronology-event-field');
   for(const k of ['target','active'])if(event[k]!==undefined&&!aliases.includes(event[k]))fail('chronology-event-field');
   for(const k of ['generation','activeGeneration'])if(event[k]!==undefined&&(!Number.isSafeInteger(event[k])||event[k]<0||event[k]>10000))fail('chronology-event-field');
   if(event.phase!==undefined&&!['capture','bubble','observer'].includes(event.phase)||event.visibility!==undefined&&!['visible','hidden','unknown'].includes(event.visibility)||event.key!==undefined&&!['Tab','Enter','Space','OTHER'].includes(event.key)||event.targetTag!==undefined&&!['BUTTON','INPUT','TEXTAREA','A','DIV','BODY','OTHER'].includes(event.targetTag)||event.path!==undefined&&(!Array.isArray(event.path)||event.path.length>8||event.path.some(v=>!aliases.includes(v))))fail('chronology-event-field');
  }
 }
 if(!value.events.length)fail('chronology-events-missing');
 return value;
}

function ordinary(file,root,max){
 const resolved=path.resolve(file),base=path.resolve(root);if(resolved===base||!resolved.startsWith(base+path.sep))fail('attachment-path');
 let current=resolved;while(current!==base){if(fs.lstatSync(current).isSymbolicLink())fail('attachment-path');current=path.dirname(current);}
 if(fs.lstatSync(base).isSymbolicLink())fail('attachment-path');const stat=fs.lstatSync(resolved);if(!stat.isFile()||stat.nlink!==1||stat.size>max)fail('attachment-file');return fs.readFileSync(resolved);
}
export function collect({reportFile,resultsRoot,outputDir,expectedSource=path.resolve(SOURCE),localRepeatEach=1}){
 if(![1,5].includes(localRepeatEach))fail('repeat-policy');
 if(fs.existsSync(outputDir))fail('output-exists');fs.mkdirSync(outputDir,{recursive:true,mode:0o700});
 const manifest={schemaVersion:1,issue:659,source:SOURCE,title:TITLE,policy:{localRepeatEach,maxAttempts:localRepeatEach===5?5:15},attempts:[],gaps:[],files:[]};
 const gap=(code,identity={})=>manifest.gaps.push({code,...identity});
 const write=(name,bytes)=>{fs.writeFileSync(path.join(outputDir,name),bytes,{flag:'wx',mode:0o600});manifest.files.push({path:name,bytes:bytes.length,sha256:hash(bytes)});};
 let report;try{report=JSON.parse(fs.readFileSync(reportFile,'utf8'));}catch{gap('report-missing-or-invalid');}
 const tests=[];
 function walk(suite){for(const spec of suite.specs||[])if(spec.title===TITLE){if(typeof report.config?.rootDir!=='string'||typeof spec.file!=='string'||path.resolve(report.config.rootDir,spec.file)!==path.resolve(expectedSource))gap('unexpected-source');else for(const t of spec.tests||[])tests.push(t);}for(const child of suite.suites||[])walk(child);}
 for(const suite of report?.suites||[])walk(suite);
 if(!tests.length)gap('exact-case-missing');let count=0;const seen=new Set();
 for(const test of tests){if(!Array.isArray(test.results)||!test.results.length)gap('attempt-results-missing');}
 for(const test of tests)for(const result of test.results||[]){
  const identity={project:test.projectName,retry:result.retry};
  if(!PROJECTS.includes(identity.project)||!Number.isInteger(identity.retry)||identity.retry<0||identity.retry>(localRepeatEach===5?0:2)||(localRepeatEach===5&&identity.project!=='chromium')||++count>(localRepeatEach===5?5:15)){gap('unexpected-attempt');continue;}
  const annotations=(result.annotations||[]).filter(a=>a.type==='portal-chooser-repeat');
  if(annotations.length===0&&result.status==='skipped'&&localRepeatEach===1)annotations.push({description:'0'});
  if(annotations.length!==1||typeof annotations[0].description!=='string'||!new RegExp(localRepeatEach===5?'^[0-4]$':'^0$').test(annotations[0].description)){gap('repeat-annotation',identity);continue;}
  identity.repeatEachIndex=Number(annotations[0].description);
  const key=`${PROJECTS.indexOf(identity.project)}-${identity.retry}`+(localRepeatEach===5?`-repeat${identity.repeatEachIndex}`:'');if(seen.has(key)){gap('duplicate-attempt',identity);continue;}seen.add(key);
  if(!['passed','failed','timedOut','interrupted','skipped'].includes(result.status)){gap('unexpected-status',identity);continue;}
  const attempt={...identity,status:result.status};manifest.attempts.push(attempt);
  if(result.status==='skipped'){attempt.coverage='skipped';continue;}
  if(!['passed','failed','timedOut','interrupted'].includes(result.status)){gap('unexpected-status',identity);continue;}
  const attachments=result.attachments||[],chronos=attachments.filter(a=>a.name==='portal-chooser-659-chronology'),traces=attachments.filter(a=>a.name==='trace');
  if(chronos.length!==1){gap('attempt-attachments-missing-or-duplicate',identity);continue;}
  let chronology;
  try{if(chronos[0].contentType!=='application/json')fail('chronology-type');chronology=sanitizeChronology(JSON.parse(ordinary(chronos[0].path,resultsRoot,512*1024).toString('utf8')),identity);write(`attempt-${key}-chronology.json`,Buffer.from(JSON.stringify(chronology,null,2)));}catch(error){gap(/^chronology-|^attachment-/.test(error.message)?error.message:'chronology-invalid',identity);continue;}
  if(chronology.fontChecks.status!=='loaded'||!['registeredDmSans','dmSans400','dmSans500','dmSans600'].every(k=>chronology.fontChecks[k]))gap('font-readiness-unconfirmed',identity);
  if(traces.length!==1){gap('attempt-trace-missing-or-duplicate',identity);attempt.coverage='trace-missing';continue;}
  if(chronology.boundary.drainStatus!=='complete'||chronology.boundary.truncated)gap('observer-drain-incomplete',identity);
  try{if(chronology.boundary.externalBlockedCount||chronology.boundary.unexpectedApiCount)fail('trace-boundary');if(traces[0].contentType!=='application/zip')fail('trace-type');const bytes=ordinary(traces[0].path,resultsRoot,32*1024**2);attempt.trace=validateTrace(bytes,{screenshots:chronology.tracePolicy.screenshots});write(`attempt-${key}-trace.zip`,bytes);attempt.coverage='retained';}catch(error){gap(/^trace-|^attachment-/.test(error.message)?error.message:'trace-invalid',identity);attempt.coverage='trace-rejected';}
 }
 if(localRepeatEach===5&&manifest.attempts.filter(a=>a.coverage==='retained').length!==5)gap('local-repeat-coverage-incomplete');
 fs.writeFileSync(path.join(outputDir,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});return manifest;
}
// Raw fallback reports also contain this case's attachments. Permit their upload
// only after every selected attempt is validated; late observer/font coverage
// limits remain visible but do not invalidate the raw trace's safety scope.
export function broadEvidenceSafe(manifest){
 return manifest?.issue===659&&Array.isArray(manifest.gaps)&&manifest.gaps.every(gap=>['observer-drain-incomplete','font-readiness-unconfirmed'].includes(gap?.code))
  &&Array.isArray(manifest.attempts)&&manifest.attempts.length>0
  &&manifest.attempts.every(attempt=>['retained','skipped'].includes(attempt.coverage));
}
export function writeBroadEvidenceOutput(manifest,outputFile){
 if(!broadEvidenceSafe(manifest))return false;
 if(outputFile)fs.appendFileSync(outputFile,'broad_evidence_safe=true\n',{encoding:'utf8'});
 return true;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--local-repeat-each=5'))fail('repeat-policy');const result=collect({localRepeatEach:args.length?5:1,reportFile:path.resolve('portal-chooser-report.json'),resultsRoot:path.resolve('test-results'),outputDir:path.resolve('portal-chooser-evidence')});const broadEvidenceSafe=writeBroadEvidenceOutput(result,process.env.GITHUB_OUTPUT);console.log(JSON.stringify({attempts:result.attempts.length,retained:result.files.length,gaps:result.gaps.length,broadEvidenceSafe}));}catch{console.error('Portal chooser collector refused; evidence coverage gap');process.exitCode=1;}
}
