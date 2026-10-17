import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {crc32,deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collect,sanitizeChronology,validateTrace,TITLE,broadEvidenceSafe,writeBroadEvidenceOutput} from '../../../scripts/collect-portal-chooser-evidence.mjs';

function zip(entries,method=0){
 const locals=[],central=[];let offset=0;
 for(const [name,value] of Object.entries(entries)){
  const n=Buffer.from(name),b=Buffer.from(value),compressed=method===8?deflateRawSync(b):b,crc=crc32(b),l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(method,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(compressed.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);locals.push(l,n,compressed);central.push(c,n);offset+=l.length+n.length+compressed.length;
 }
 const dir=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,dir,end]);
}
const trace=(url='http://127.0.0.1:4188/api/client-portal/me',headers=[])=>zip({'test.trace':JSON.stringify({type:'context-options',options:{baseURL:'http://127.0.0.1:4188'}})+'\n','1-trace.network':JSON.stringify({type:'resource-snapshot',snapshot:{request:{url,headers,cookies:[]},response:{headers:[],cookies:[]}}})+'\n'});
const chronology=(retry=0)=>({schemaVersion:1,issue:659,title:TITLE,projectName:'chromium',retry,repeatEachIndex:0,synthetic:true,sourceMarker:'portal-chooser-659-v1',originScope:'loopback-only',fontChecks:{status:'loaded',registeredDmSans:true,dmSans400:true,dmSans500:true,dmSans600:true},tracePolicy:{mode:'on',sources:false,attachments:false,screenshots:false,snapshots:true},boundary:{externalBlockedCount:0,unexpectedApiCount:0,truncated:false,drainStatus:'complete'},events:[{clock:'node',seq:0,ms:0,event:'START'},{clock:'browser',seq:0,ms:1,event:'CLICK',target:'upload-button',active:'upload-button',key:'Enter',trusted:true,phase:'capture'},{clock:'node',seq:1,ms:3,event:'FILECHOOSER'}]});
function fixture(results=[{status:'passed',retry:0}],change=()=>{}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ashbi-portal-collector-')),resultsRoot=path.join(root,'test-results');fs.mkdirSync(resultsRoot);
 const report={config:{rootDir:path.join(root,'tests')},suites:[{specs:[{title:TITLE,file:'keyboard-journeys.spec.ts',tests:[{projectName:'chromium',results:results.map(r=>{
  const dir=path.join(resultsRoot,`attempt-${r.retry}`);fs.mkdirSync(dir);const chrono=path.join(dir,'portal-chooser-659-chronology.json'),t=path.join(dir,'trace.zip');fs.writeFileSync(chrono,JSON.stringify(chronology(r.retry)));fs.writeFileSync(t,trace());return {...r,annotations:[{type:'portal-chooser-repeat',description:'0'}],attachments:[{name:'portal-chooser-659-chronology',contentType:'application/json',path:chrono},{name:'trace',contentType:'application/zip',path:t}]};
 })}]}]}]};
 const options={reportFile:path.join(root,'report.json'),resultsRoot,outputDir:path.join(root,'output'),expectedSource:path.join(root,'tests/keyboard-journeys.spec.ts')};change({root,report,options});fs.writeFileSync(options.reportFile,JSON.stringify(report));
 return {root,report,options,run:()=>collect(options),cleanup:()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('ashbi-portal-collector-'));fs.rmSync(root,{recursive:true,force:true});}};
}
function run(results,change,check){const f=fixture(results,change);try{check(f.run(),f);}finally{f.cleanup();}}

test('successful exact attempt retains only closed chronology trace and hash/size manifest',()=>run(undefined,undefined,(m,f)=>{
 assert.equal(m.gaps.length,0);assert.equal(m.attempts[0].coverage,'retained');assert.equal(m.files.length,2);
 for(const entry of m.files){const b=fs.readFileSync(path.join(f.options.outputDir,entry.path));assert.equal(entry.bytes,b.length);assert.equal(entry.sha256,createHash('sha256').update(b).digest('hex'));}
 assert.deepEqual(fs.readdirSync(f.options.outputDir).sort(),['attempt-0-0-chronology.json','attempt-0-0-trace.zip','manifest.json']);
}));
test('flaky first failure and successful retry both retained as distinct attempts; final failure also retained',()=>{
 for(const results of [[{status:'timedOut',retry:0},{status:'passed',retry:1}],[{status:'failed',retry:0},{status:'failed',retry:1},{status:'failed',retry:2}]])run(results,undefined,m=>{assert.equal(m.gaps.length,0);assert.equal(m.files.length,results.length*2);assert.deepEqual(m.attempts.map(a=>a.status),results.map(r=>r.status));});
});
test('unexpected source title/project/retry duplicate and excessive attempts cannot widen upload scope',()=>{
 for(const change of [f=>f.report.suites[0].specs[0].file='../private.spec.ts',f=>f.report.suites[0].specs[0].title='other case',f=>f.report.suites[0].specs[0].tests[0].projectName='unapproved',f=>f.report.suites[0].specs[0].tests[0].results[0].retry=3])run(undefined,change,m=>{assert.ok(m.gaps.length);assert.equal(m.files.length,0);});
 run(undefined,f=>f.report.suites[0].specs[0].tests[0].results.push(f.report.suites[0].specs[0].tests[0].results[0]),m=>assert.ok(m.gaps.some(g=>g.code==='duplicate-attempt')));
});
test('attachment traversal or redirect does not copy arbitrary file content',()=>{
 run(undefined,f=>{const r=f.report.suites[0].specs[0].tests[0].results[0];r.attachments[0].path=path.join(f.root,'outside.json');fs.writeFileSync(r.attachments[0].path,'secret');},m=>{assert.equal(m.files.length,0);assert.ok(m.gaps.some(g=>g.code==='attachment-path'));});
 run(undefined,f=>{const a=f.report.suites[0].specs[0].tests[0].results[0].attachments[1];const target=path.join(f.root,'outside.zip');fs.writeFileSync(target,trace());fs.unlinkSync(a.path);fs.symlinkSync(target,a.path);},m=>{assert.equal(m.files.length,1);assert.ok(m.gaps.some(g=>g.code==='attachment-path'));});
});
test('chronology allowlist rejects rawtext secrets unknown event keys or invalid sequence',()=>{
 for(const change of [v=>v.secret='not-uploadable',v=>v.events[0].url='https://private.invalid/token',v=>v.events[1].target='private-name',v=>v.events[2].seq=0,v=>v.events[0].event='ENV_DUMP',v=>v.tracePolicy.sources=true,v=>v.synthetic=false]){
  const v=chronology();change(v);assert.throws(()=>sanitizeChronology(v,{project:'chromium',retry:0}));
 }
});
test('missing report/attachments and incomplete observer produce explicit gaps without invented coverage',()=>{
 run(undefined,f=>f.report.suites[0].specs[0].tests[0].results[0].attachments=[],m=>{assert.equal(m.files.length,0);assert.ok(m.gaps.some(g=>g.code==='attempt-attachments-missing-or-duplicate'));});
 const f=fixture();try{fs.unlinkSync(f.options.reportFile);const m=f.run();assert.ok(m.gaps.some(g=>g.code==='report-missing-or-invalid'));assert.equal(m.files.length,0);}finally{f.cleanup();}
 run(undefined,f=>{const a=f.report.suites[0].specs[0].tests[0].results[0].attachments[0],v=chronology();v.boundary.drainStatus='page_closed';v.boundary.truncated=true;fs.writeFileSync(a.path,JSON.stringify(v));},m=>{assert.equal(m.files.length,2);assert.ok(m.gaps.some(g=>g.code==='observer-drain-incomplete'));});
});
test('external scope unexpected credentials embedded source and malformed ZIP quarantine trace but keep safe chronology',()=>{
 for(const data of [trace('https://private.invalid/api'),trace('http://127.0.0.1:4188/api/me',[{name:'authorization',value:'Bearer private-credential'}]),zip({'src/private.ts':'source','test.trace':'{}'}),Buffer.from('not a zip')])run(undefined,f=>fs.writeFileSync(f.report.suites[0].specs[0].tests[0].results[0].attachments[1].path,data),m=>{assert.equal(m.files.length,1);assert.equal(m.attempts[0].coverage,'trace-rejected');assert.ok(m.gaps.some(g=>g.code.startsWith('trace-')));});
 assert.throws(()=>validateTrace(trace('http://127.0.0.1:4188/api?token=real-secret')));
 assert.throws(()=>validateTrace(zip({'test.trace':JSON.stringify({type:'context-options',options:{baseURL:'https://remote.invalid'}})})));
});
test('boundary violations retain numeric safe evidence but refuse rawtrace; expected skipped profiles remain explicit',()=>{
 run(undefined,f=>{const a=f.report.suites[0].specs[0].tests[0].results[0].attachments[0],v=chronology();v.boundary.unexpectedApiCount=1;fs.writeFileSync(a.path,JSON.stringify(v));},m=>{assert.equal(m.files.length,1);assert.ok(m.gaps.some(g=>g.code==='trace-boundary'));});
 run([{status:'skipped',retry:0}],undefined,m=>{assert.equal(m.files.length,0);assert.equal(m.attempts[0].coverage,'skipped');assert.equal(m.gaps.length,0);});
});
test('collector output cannot be overwritten and workflow uploads only narrow evidence even on retry-success',()=>{
 const f=fixture();try{f.run();assert.throws(()=>f.run(),/output-exists/);}finally{f.cleanup();}
 const workflow=fs.readFileSync(new URL('../../../.github/workflows/release-gates.yml',import.meta.url),'utf8').replaceAll('\r\n','\n');assert.match(workflow,/PLAYWRIGHT_JSON_OUTPUT_FILE: portal-chooser-report.json/);assert.match(workflow,/Collect exact portal chooser evidence\n {8}id: portal_chooser_evidence\n {8}if: \$\{\{ !cancelled\(\) \}\}/);assert.match(workflow,/name: portal-chooser-659-evidence\n {10}path: portal-chooser-evidence\/\n {10}if-no-files-found: error\n {10}retention-days: 7/);assert.ok(workflow.includes("if: failure() && steps.portal_chooser_evidence.outputs.broad_evidence_safe == 'true'"));
});


test('five projects times three attempts is the hard15 cap, with an explicit overflow gap',()=>{
 run(undefined,f=>{
  const spec=f.report.suites[0].specs[0];spec.tests=[];
  for(const [index,projectName] of ['chromium','firefox','webkit','Mobile Chrome','Mobile Safari'].entries()){
   const results=[];
   for(let retry=0;retry<3;retry++){
    const dir=path.join(f.options.resultsRoot,`project-${index}-${retry}`);fs.mkdirSync(dir);const c=path.join(dir,'chronology.json'),t=path.join(dir,'trace.zip'),v=chronology(retry);v.projectName=projectName;fs.writeFileSync(c,JSON.stringify(v));fs.writeFileSync(t,trace());
    results.push({retry,status:'failed',annotations:[{type:'portal-chooser-repeat',description:'0'}],attachments:[{name:'portal-chooser-659-chronology',contentType:'application/json',path:c},{name:'trace',contentType:'application/zip',path:t}]});
   }
   spec.tests.push({projectName,results});
  }
  spec.tests.push(spec.tests[0]);
 },m=>{assert.equal(m.attempts.length,15);assert.equal(m.files.length,30);assert.equal(m.gaps.filter(g=>g.code==='unexpected-attempt').length,3);});
});
test('missing trace still preserves safe chronology and absent result arrays are explicit gaps',()=>{
 run(undefined,f=>f.report.suites[0].specs[0].tests[0].results[0].attachments.pop(),m=>{assert.equal(m.files.length,1);assert.equal(m.attempts[0].coverage,'trace-missing');assert.ok(m.gaps.some(g=>g.code==='attempt-trace-missing-or-duplicate'));});
 run(undefined,f=>f.report.suites[0].specs[0].tests[0].results=[],m=>assert.ok(m.gaps.some(g=>g.code==='attempt-results-missing')));
});
test('exact canned fixture authorization is allowed while traversal and corrupt ZIP CRC reject',()=>{
 validateTrace(trace('http://127.0.0.1:4188/client-portal/verify?token=portal-keyboard-token',[{name:'authorization',value:'Bearer portal-keyboard-token'}]));
 assert.throws(()=>validateTrace(zip({'../outside.trace':'{}'})),/trace-entry-scope/);
 const corrupt=trace();corrupt[14]^=1;assert.throws(()=>validateTrace(corrupt),/trace-zip/); // local metadata differs from central directory
 const altered=trace();const central=altered.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));altered[central+16]^=1;assert.throws(()=>validateTrace(altered),/trace-zip/);
});


test('official screencast JPEG pathname is accepted only with declared screenshots and bounded valid ZIP bytes',()=>{
 const name='screencast/page@588b47560cd9ee9358995637617251ab-1792200012686.jpeg';
 const make=(n,method=0)=>zip({'test.trace':JSON.stringify({type:'context-options',options:{baseURL:'http://127.0.0.1:4188'}})+'\n',[n]:Buffer.from([0xff,0xd8,0xff,0xd9])},method);
 validateTrace(make(name),{screenshots:true});validateTrace(make(name,8),{screenshots:true});assert.throws(()=>validateTrace(make(name)),/trace-screencast/);
 for(const bad of ['screencast/other.jpeg','screencast/page@588b47560cd9ee9358995637617251ab-1.jpeg','screencast/../private.jpeg'])assert.throws(()=>validateTrace(make(bad),{screenshots:true}),/trace-entry-scope/);
});
test('explicit localfive repeats require matching structured annotation and chronology, unique identity and totalfive cap',()=>{
 run(undefined,f=>{
  f.options.localRepeatEach=5;const test=f.report.suites[0].specs[0].tests[0];test.results=[];
  for(let repeat=0;repeat<5;repeat++){
   const dir=path.join(f.options.resultsRoot,`repeat-${repeat}`);fs.mkdirSync(dir);const c=path.join(dir,'chronology.json'),t=path.join(dir,'trace.zip'),v=chronology();v.repeatEachIndex=repeat;v.tracePolicy.screenshots=true;fs.writeFileSync(c,JSON.stringify(v));fs.writeFileSync(t,trace());
   test.results.push({retry:0,status:'passed',annotations:[{type:'portal-chooser-repeat',description:String(repeat)}],attachments:[{name:'portal-chooser-659-chronology',contentType:'application/json',path:c},{name:'trace',contentType:'application/zip',path:t}]});
  }
 },m=>{assert.equal(m.attempts.length,5);assert.equal(m.files.length,10);assert.equal(m.gaps.length,0);assert.deepEqual(m.attempts.map(a=>a.repeatEachIndex),[0,1,2,3,4]);});
});
test('local early-stop and bad repeat identity are explicit gaps; CI never silently accepts local repeats',()=>{
 run(undefined,f=>f.options.localRepeatEach=5,m=>{assert.equal(m.files.length,2);assert.ok(m.gaps.some(g=>g.code==='local-repeat-coverage-incomplete'));});
 for(const change of [f=>f.report.suites[0].specs[0].tests[0].results[0].annotations=[],f=>f.report.suites[0].specs[0].tests[0].results[0].annotations[0].description='1'])run(undefined,change,m=>{assert.equal(m.files.length,0);assert.ok(m.gaps.some(g=>g.code==='repeat-annotation'));});
 run(undefined,f=>{f.options.localRepeatEach=5;f.report.suites[0].specs[0].tests[0].results[0].annotations[0].description='1';},m=>{assert.equal(m.files.length,0);assert.ok(m.gaps.some(g=>g.code==='chronology-provenance'));});
 const f=fixture();try{assert.throws(()=>collect({...f.options,localRepeatEach:4}),/repeat-policy/);}finally{f.cleanup();}
});


test('only fixed observational font checks are retained, unknown text rejects and unavailable font readiness is explicit',()=>{
 for(const change of [v=>v.fontChecks.family='private text',v=>v.fontChecks.dmSans400='yes',v=>v.fontChecks.status='secret']){const v=chronology();change(v);assert.throws(()=>sanitizeChronology(v,{project:'chromium',retry:0}),/chronology-font-checks/);}
 run(undefined,f=>{const a=f.report.suites[0].specs[0].tests[0].results[0].attachments[0],v=chronology();v.fontChecks.status='unavailable';v.fontChecks.registeredDmSans=false;fs.writeFileSync(a.path,JSON.stringify(v));},m=>{assert.equal(m.files.length,2);assert.ok(m.gaps.some(g=>g.code==='font-readiness-unconfirmed'));});
});


test('raw broad evidence output is opt-in for validated exact-case attempts and no unsafe gaps',()=>{
 const f=fixture();try{
  const output=path.join(f.root,'github-output');fs.writeFileSync(output,'existing=value\n');const manifest=f.run();
  assert.equal(broadEvidenceSafe(manifest),true);assert.equal(writeBroadEvidenceOutput(manifest,output),true);assert.equal(fs.readFileSync(output,'utf8'),'existing=value\nbroad_evidence_safe=true\n');
  for(const change of [m=>m.gaps.push({code:'trace-origin'}),m=>m.attempts[0].coverage='trace-rejected',m=>m.attempts[0].coverage='trace-missing',m=>m.attempts=[],m=>delete m.gaps,m=>m.issue=1]){
   const invalid=structuredClone(manifest);change(invalid);const before=fs.readFileSync(output,'utf8');assert.equal(writeBroadEvidenceOutput(invalid,output),false);assert.equal(fs.readFileSync(output,'utf8'),before);
  }
 }finally{f.cleanup();}
});
test('rejected missing and incomplete actual collections do not authorize broad fallback or remove raw local files',()=>{
 for(const mutate of [f=>fs.writeFileSync(f.report.suites[0].specs[0].tests[0].results[0].attachments[1].path,trace('https://private.invalid')),f=>f.report.suites[0].specs[0].tests[0].results[0].attachments.pop(),f=>f.report.suites[0].specs[0].tests[0].results=[]]){
  const f=fixture(undefined,mutate);try{const output=path.join(f.root,'github-output'),m=f.run();assert.equal(writeBroadEvidenceOutput(m,output),false);assert.equal(fs.existsSync(output),false);assert.equal(fs.existsSync(path.join(f.options.resultsRoot,'attempt-0','trace.zip')),true);}finally{f.cleanup();}
 }
 const f=fixture();try{fs.unlinkSync(f.options.reportFile);const m=f.run();assert.equal(writeBroadEvidenceOutput(m,path.join(f.root,'github-output')),false);}finally{f.cleanup();}
});


test('actual collector CLI writes output only on complete success; missing report and unexpected failure default to no permission',()=>{
 const script=fileURLToPath(new URL('../../../scripts/collect-portal-chooser-evidence.mjs',import.meta.url));
 for(const mode of ['success','missing-report','existing-output']){
  const f=fixture();try{
   const output=path.join(f.root,'github-output');
   if(mode!=='missing-report')fs.copyFileSync(f.options.reportFile,path.join(f.root,'portal-chooser-report.json'));
   if(mode==='existing-output')fs.mkdirSync(path.join(f.root,'portal-chooser-evidence'));
   const r=spawnSync(process.execPath,[script],{cwd:f.root,encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:output}});
   if(mode==='success'){assert.equal(r.status,0,r.stderr);assert.equal(fs.readFileSync(output,'utf8'),'broad_evidence_safe=true\n');}
   else{assert.equal(fs.existsSync(output),false);assert.equal(r.status,mode==='missing-report'?0:1);}
  }finally{f.cleanup();}
 }
});


test('exact synthetic relative goto needs prior loopback context in the same trace stream; other relative or credential URLs remain refused',()=>{
 const relative='/client-portal/verify?token=portal-keyboard-token';
 const make=(url,baseURL='http://127.0.0.1:4197',reverse=false)=>{const rows=[{type:'context-options',options:baseURL?{baseURL}:{}},{type:'before',method:'goto',params:{url}}];return zip({'1-trace.trace':(reverse?rows.reverse():rows).map(r=>JSON.stringify(r)).join('\n')+'\n'});};
 validateTrace(make(relative));
 for(const url of ['/client-portal','/client-portal/verify?token=real-secret','/admin?credential=private','//external.invalid/path','https://external.invalid/path'])assert.throws(()=>validateTrace(make(url)),/trace-origin/);
 assert.throws(()=>validateTrace(make(relative,null)),/trace-origin/);
 assert.throws(()=>validateTrace(make(relative,'https://external.invalid')),/trace-origin/);
 assert.throws(()=>validateTrace(make(relative,'http://127.0.0.1:4197',true)),/trace-origin/);
 assert.throws(()=>validateTrace(zip({'test.trace':JSON.stringify({type:'context-options',options:{baseURL:'http://127.0.0.1:4197'}}),'other.trace':JSON.stringify({type:'before',method:'goto',params:{url:relative}})})),/trace-origin/);
 run(undefined,f=>{
  const a=f.report.suites[0].specs[0].tests[0].results[0].attachments;fs.writeFileSync(a[1].path,make(relative));const v=chronology();v.boundary.truncated=true;fs.writeFileSync(a[0].path,JSON.stringify(v));
 },m=>{assert.equal(m.files.length,2);assert.equal(m.attempts[0].coverage,'retained');assert.ok(m.gaps.some(g=>g.code==='observer-drain-incomplete'));assert.equal(broadEvidenceSafe(m),true);});
});


test('only observer and font coverage limits permit broad output for fully validated retained or skipped attempts',()=>{
 for(const gaps of [[{code:'observer-drain-incomplete'}],[{code:'font-readiness-unconfirmed'}],[{code:'observer-drain-incomplete'},{code:'font-readiness-unconfirmed'}]]){
  const f=fixture();try{const manifest=f.run();manifest.gaps=gaps;manifest.attempts.push({project:'firefox',retry:0,repeatEachIndex:0,status:'skipped',coverage:'skipped'});const output=path.join(f.root,'github-output');assert.equal(writeBroadEvidenceOutput(manifest,output),true);assert.equal(fs.readFileSync(output,'utf8'),'broad_evidence_safe=true\n');assert.deepEqual(manifest.gaps,gaps);}finally{f.cleanup();}
 }
});
test('unknown or mixed unsafe gaps and missing or rejected attempts still withhold broad upload with no flag',()=>{
 for(const code of ['unknown','trace-origin','trace-secret','unexpected-source','repeat-annotation','duplicate-attempt','attempt-trace-missing-or-duplicate','trace-boundary']){
  const f=fixture();try{const manifest=f.run();manifest.gaps=[{code:'observer-drain-incomplete'},{code}];const output=path.join(f.root,'github-output');assert.equal(writeBroadEvidenceOutput(manifest,output),false);assert.equal(fs.existsSync(output),false);}finally{f.cleanup();}
 }
 for(const coverage of ['trace-missing','trace-rejected',undefined]){
  const f=fixture();try{const manifest=f.run();manifest.gaps=[{code:'font-readiness-unconfirmed'}];manifest.attempts[0].coverage=coverage;const output=path.join(f.root,'github-output');assert.equal(writeBroadEvidenceOutput(manifest,output),false);assert.equal(fs.existsSync(output),false);}finally{f.cleanup();}
 }
 assert.equal(broadEvidenceSafe({issue:659,gaps:[{code:'observer-drain-incomplete'}],attempts:[]}),false);
});


test('DEV_SOCKET is a closed metadata alias only; external boundary still quarantines despite benign observer limits',()=>{
 const v=chronology();v.events.push({seq:2,clock:'node',ms:4,event:'BOUNDARY_BLOCK',kind:'asset',requestAlias:'DEV_SOCKET'});assert.deepEqual(sanitizeChronology(v,{project:'chromium',retry:0}),v);
 const bad=structuredClone(v);bad.events.at(-1).requestAlias='ws://localhost:3000/socket.io/';assert.throws(()=>sanitizeChronology(bad,{project:'chromium',retry:0}),/chronology-event-field/);
 run(undefined,f=>{const a=f.report.suites[0].specs[0].tests[0].results[0].attachments[0];v.boundary.externalBlockedCount=1;v.boundary.truncated=true;fs.writeFileSync(a.path,JSON.stringify(v));},m=>{assert.equal(m.attempts[0].coverage,'trace-rejected');assert.ok(m.gaps.some(g=>g.code==='trace-boundary'));assert.equal(broadEvidenceSafe(m),false);});
});
