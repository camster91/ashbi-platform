import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
import {makePilotFixture} from './pilot-source-fixture.mjs';
import {reconcilePilot} from './pilot-reconcile.mjs';
import {applySourcePilot,readSourcePilot,readSourceObject} from './source-pilot.mjs';

let material;
async function sourceMaterial(){
 return material??=Promise.resolve().then(async()=>{const fixture=await makePilotFixture(await mkdtemp(join(tmpdir(),'source-pilot-test-'))),report=await reconcilePilot(fixture.root,fixture.mapping),objects=[];for(const[source,entries]of Object.entries(report.sourceFiles))for(const entry of entries)objects.push({source,path:entry.path,bytes:new Uint8Array(await readFile(join(fixture.root,source,entry.path)))});return {fixture,report,objects};});
}
async function setup(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("synthetic fixture")}}',d1Databases:{DB:'source-pilot'},r2Buckets:['FILES'],cf:false});t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB'),FILES=await mf.getR2Bucket('FILES');
 for(const name of(await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));}
 const actors={};for(const[id,org,role,client,active]of[['cameron','pilot-org','staff',null,1],['bianca','pilot-org','staff',null,1],['staff','pilot-org','staff',null,1],['client','pilot-org','client','canonical-client',1],['foreign','foreign-org','staff',null,1],['inactive','pilot-org','staff',null,0]]){await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,?)').bind(id,id+'@example.invalid',org,role,client,active).run();actors[id]={id,email:id+'@example.invalid',organization_id:org,role,client_id:client,active};}
 for(const[id,org]of[['cameron','pilot-org'],['foreign','foreign-org'],['inactive','pilot-org']])await DB.prepare('INSERT INTO actor_finance_access VALUES(?,?)').bind(id,org).run();
 await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('canonical-client','pilot-org','Existing canonical client'),('other-client','pilot-org','Other client')").run();
 await DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('canonical-project','pilot-org','canonical-client','Existing canonical project',0)").run();
 const seeded=await sourceMaterial(),input={requestId:crypto.randomUUID(),report:structuredClone(seeded.report),objects:seeded.objects.map(o=>({...o,bytes:new Uint8Array(o.bytes)})),snapshot:{clientRevision:0,projectRevision:0}},env={DB,FILES};
 return {DB,FILES,env,actors,input,fixture:seeded.fixture,actor:actors.cameron,apply:(value=input,who=actors.cameron,bindings=env)=>applySourcePilot(bindings,who,value)};
}
const rejected=async(action,status)=>assert.rejects(action,error=>error===status||error?.status===status,`Expected ${status}`);
const count=async(DB,table,where='')=>(await DB.prepare('SELECT COUNT(*) AS n FROM '+table+(where?' WHERE '+where:'')).first()).n;
async function noPublished(DB){assert.equal(await count(DB,'notes'),0);assert.equal(await count(DB,'tasks'),0);assert.equal(await count(DB,'files',"state='ready'"),0);}
async function noLiveFinance(DB){for(const table of['time_entries','time_details','invoice_drafts','commercial_drafts','proposal_reviews','contract_publications','stripe_customer_links','stripe_invoice_operations','stripe_invoice_issuance_operations'])assert.equal(await count(DB,table),0,table);}
const dbHook=(env,before,after)=>({...env,DB:{prepare:sql=>env.DB.prepare(sql),async batch(statements){await before?.();const result=await env.DB.batch(statements);await after?.();return result;}}});

test('source pilot applies exact private documents, hierarchy, pending task and verified original against existing targets',async t=>{
 const f=await setup(t),beforeClient=await f.DB.prepare("SELECT * FROM clients WHERE id='canonical-client'").first(),beforeProject=await f.DB.prepare("SELECT * FROM projects WHERE id='canonical-project'").first(),receipt=await f.apply();
 assert.equal(receipt.id,f.input.requestId);assert.equal(receipt.state,'DONE');assert.equal(receipt.fingerprint,f.input.report.fingerprint);assert.deepEqual(receipt.counts,{sourceRecords:19,mapped:17,held:2});
 assert.deepEqual(await f.DB.prepare("SELECT * FROM clients WHERE id='canonical-client'").first(),beforeClient);assert.deepEqual(await f.DB.prepare("SELECT * FROM projects WHERE id='canonical-project'").first(),beforeProject);
 const docs=f.input.report.records.filter(r=>r.kind==='document'&&r.disposition==='MAPPED');assert.equal(docs.length,3);
 for(const record of docs){const row=await f.DB.prepare('SELECT * FROM notes WHERE id=?').bind(record.canonicalId).first();assert.ok(row);assert.equal(row.text,record.normalized.text);assert.equal(row.client_visible,0);assert.equal(row.project_id,'canonical-project');const position=await f.DB.prepare('SELECT * FROM note_positions WHERE id=?').bind(row.id).first();assert.equal(position.parent_id,record.normalized.parentCanonicalId??null);const history=(await f.DB.prepare('SELECT * FROM note_versions WHERE note_id=?').bind(row.id).all()).results;assert.equal(history.length,1);assert.equal(history[0].text,row.text);assert.equal(history[0].client_visible,0);}
 const task=await f.DB.prepare("SELECT * FROM tasks WHERE id='canonical-legacy-task'").first();assert.equal(task.status,'todo');assert.equal(task.assignee_id,'bianca');assert.equal(task.client_visible,0);assert.equal(task.title,'Retained launch task');
 const file=await f.DB.prepare("SELECT * FROM files WHERE id='canonical-legacy-attachment'").first();assert.equal(file.state,'ready');assert.equal(file.client_visible,0);assert.equal(file.size,f.fixture.expected.attachmentBytes.length);assert.equal(file.sha256,f.fixture.expected.attachmentSha256);assert.deepEqual(new Uint8Array(await(await f.FILES.get(file.object_key)).arrayBuffer()),new Uint8Array(f.fixture.expected.attachmentBytes));await noLiveFinance(f.DB);
});
test('all source records including held and historical finance are immutable provenance and every source file is readable only through its archive identity',async t=>{
 const f=await setup(t),receipt=await f.apply(),saved=await readSourcePilot(f.env,f.actor,receipt.id);assert.equal(saved.run.state,'DONE');assert.deepEqual(saved.run.counts,f.input.report.counts);assert.deepEqual(saved.totals,f.input.report.totals);assert.deepEqual(saved.coverage,f.input.report.coverage);assert.deepEqual(saved.sourceFiles,f.input.report.sourceFiles);assert.deepEqual([...saved.records].sort((a,b)=>a.key.localeCompare(b.key)),[...f.input.report.records].sort((a,b)=>a.key.localeCompare(b.key)));
 assert.equal(await count(f.DB,'source_pilot_records'),19);assert.equal(await count(f.DB,'source_pilot_objects'),f.input.objects.length);
 for(const object of f.input.objects)assert.deepEqual(await readSourceObject(f.env,f.actor,receipt.id,object.source,object.path),object.bytes);
 await noLiveFinance(f.DB);
});
test('same request replay preserves edited canonical records and adds no versions or archive objects',async t=>{
 const f=await setup(t),receipt=await f.apply(),objects=(await f.FILES.list()).objects.length;await f.DB.batch([f.DB.prepare("UPDATE notes SET text='Later authorized edit',revision=revision+1 WHERE id='notion-handbook'"),f.DB.prepare("UPDATE tasks SET title='Later task edit',status='doing',assignee_id='cameron',revision=revision+1 WHERE id='canonical-legacy-task'"),f.DB.prepare("UPDATE files SET deleted=1,revision=revision+1 WHERE id='canonical-legacy-attachment'")]);assert.deepEqual(await f.apply(),receipt);assert.equal((await f.DB.prepare("SELECT text FROM notes WHERE id='notion-handbook'").first()).text,'Later authorized edit');assert.equal((await f.DB.prepare("SELECT title FROM tasks WHERE id='canonical-legacy-task'").first()).title,'Later task edit');assert.equal((await f.DB.prepare("SELECT deleted FROM files WHERE id='canonical-legacy-attachment'").first()).deleted,1);assert.equal(await count(f.DB,'note_versions'),3);assert.equal((await f.FILES.list()).objects.length,objects);assert.equal(await count(f.DB,'source_pilot_records'),19);
});
test('ordinary staff clients foreign actors inactive actors and revoked finance cannot apply or read source archives',async t=>{
 const f=await setup(t);for(const name of['staff','client','foreign','inactive'])await rejected(()=>f.apply(f.input,f.actors[name]),name==='foreign'?404:403);await noPublished(f.DB);const receipt=await f.apply();for(const name of['staff','client','foreign','inactive']){await rejected(()=>readSourcePilot(f.env,f.actors[name],receipt.id),name==='foreign'?404:403);await rejected(()=>readSourceObject(f.env,f.actors[name],receipt.id,f.input.objects[0].source,f.input.objects[0].path),name==='foreign'?404:403);}await f.DB.prepare("DELETE FROM actor_finance_access WHERE id='cameron'").run();await rejected(()=>f.apply(),403);await rejected(()=>readSourcePilot(f.env,f.actor,receipt.id),403);
});

test('a reused request rejects changed report contents and a new request cannot overlap existing source identities',async t=>{
 const f=await setup(t),receipt=await f.apply(),changed=structuredClone(f.input);changed.report.records.find(r=>r.kind==='document').normalized.text='Changed reviewed payload';await rejected(()=>f.apply(changed),409);await rejected(()=>f.apply({...f.input,requestId:crypto.randomUUID()}),409);assert.deepEqual(await f.apply(),receipt);assert.equal(await count(f.DB,'notes'),3);assert.equal(await count(f.DB,'source_pilot_records'),19);
});
test('source inventory requires every exact object once and rejects missing extra duplicate and changed bytes before canonical writes',async t=>{
 const f=await setup(t);for(const fault of['missing','extra','duplicate','bytes']){const input={...f.input,requestId:crypto.randomUUID(),objects:f.input.objects.map(o=>({...o,bytes:new Uint8Array(o.bytes)}))};if(fault==='missing')input.objects.pop();if(fault==='extra')input.objects.push({source:'notion',path:'unexpected.md',bytes:new Uint8Array([1])});if(fault==='duplicate')input.objects.push(input.objects[0]);if(fault==='bytes')input.objects[0].bytes[0]^=1;await assert.rejects(()=>f.apply(input),error=>[400,409].includes(error),fault);await noPublished(f.DB);}assert.equal(await count(f.DB,'source_pilot_records'),0);
});
test('source pilot rejects source visibility broadening and unknown task status rather than guessing canonical behavior',async t=>{
 const f=await setup(t);for(const fault of['visibility','status']){const input=structuredClone(f.input);input.requestId=crypto.randomUUID();if(fault==='visibility')input.report.records.find(r=>r.kind==='document').normalized.proposedClientVisible=true;else input.report.records.find(r=>r.kind==='task').normalized.sourceStatus='UNRECOGNIZED';await assert.rejects(()=>f.apply(input),error=>[400,409].includes(error));await noPublished(f.DB);}await noLiveFinance(f.DB);
});
test('missing stale and reassigned canonical targets are never created overwritten or silently remapped',async t=>{
 const f=await setup(t);for(const snapshot of[{clientRevision:1,projectRevision:0},{clientRevision:0,projectRevision:1}])await rejected(()=>f.apply({...f.input,requestId:crypto.randomUUID(),snapshot}),409);
 await f.DB.prepare("UPDATE projects SET client_id='other-client' WHERE id='canonical-project'").run();await rejected(()=>f.apply(),404);await f.DB.prepare("UPDATE projects SET client_id='canonical-client' WHERE id='canonical-project'").run();await f.DB.prepare("DELETE FROM projects WHERE id='canonical-project'").run();await rejected(()=>f.apply(),404);assert.equal(await count(f.DB,'projects'),0);await noPublished(f.DB);
});
test('deactivated or nonstaff mapped authors cannot establish canonical ownership or provenance',async t=>{
 const f=await setup(t);await f.DB.prepare("UPDATE actors SET active=0 WHERE id='bianca'").run();await assert.rejects(()=>f.apply(),error=>[403,409].includes(error));await noPublished(f.DB);await f.DB.prepare("UPDATE actors SET active=1,role='client',client_id='canonical-client' WHERE id='bianca'").run();await assert.rejects(()=>f.apply(),error=>[403,409].includes(error));await noPublished(f.DB);
});
test('preexisting target notes tasks or files are conflicts and remain byte-for-byte unchanged',async t=>{
 for(const kind of ['note','task','file']){const f=await setup(t);let table,id;
  if(kind==='note'){table='notes';id='notion-handbook';await f.DB.prepare("INSERT INTO notes(id,organization_id,project_id,title,text,client_visible) VALUES('notion-handbook','pilot-org','canonical-project','Existing note','Existing private bytes',0)").run();}
  if(kind==='task'){table='tasks';id='canonical-legacy-task';await f.DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status,client_visible) VALUES('canonical-legacy-task','pilot-org','canonical-project','Existing task','doing',0)").run();}
  if(kind==='file'){table='files';id='canonical-legacy-attachment';await f.DB.prepare("INSERT INTO files(id,organization_id,project_id,actor_id,name,object_key,size,sha256,state,client_visible,created_at) VALUES('canonical-legacy-attachment','pilot-org','canonical-project','cameron','Existing file','existing-private-original',1,?,'ready',0,1)").bind('0'.repeat(64)).run();}
  const before=await f.DB.prepare('SELECT * FROM '+table+' WHERE id=?').bind(id).first();await rejected(()=>f.apply(),409);assert.deepEqual(await f.DB.prepare('SELECT * FROM '+table+' WHERE id=?').bind(id).first(),before);assert.equal(await count(f.DB,'notes'),kind==='note'?1:0);assert.equal(await count(f.DB,'tasks'),kind==='task'?1:0);assert.equal(await count(f.DB,'files'),kind==='file'?1:0);assert.equal(await count(f.DB,'source_pilot_records','target_kind IS NOT NULL'),0);
 }
});
const lateCanonicalBatch=(f,change)=>{let prepared=[],fired=false;const bindings={...f.env,DB:{prepare(sql){prepared.push(sql);return f.DB.prepare(sql);},async batch(statements){const queries=prepared;prepared=[];if(!fired&&queries.some(sql=>/INSERT\s+INTO\s+notes\b/i.test(sql))){fired=true;await change();}return f.DB.batch(statements);}}};return {bindings,fired:()=>fired};};
test('finance revoked inside the canonical commit batch rolls back all published work provenance and DONE state',async t=>{
 const f=await setup(t),hook=lateCanonicalBatch(f,()=>f.DB.prepare("DELETE FROM actor_finance_access WHERE id='cameron'").run());await rejected(()=>f.apply(f.input,f.actor,hook.bindings),403);assert.equal(hook.fired(),true);await noPublished(f.DB);assert.equal(await count(f.DB,'source_pilot_records','target_kind IS NOT NULL'),0);assert.equal(await count(f.DB,'source_pilot_runs',"state='DONE'"),0);
});
test('canonical project reassignment inside the commit batch cannot publish records under another client',async t=>{
 const f=await setup(t),hook=lateCanonicalBatch(f,()=>f.DB.prepare("UPDATE projects SET client_id='other-client' WHERE id='canonical-project'").run());await assert.rejects(()=>f.apply(f.input,f.actor,hook.bindings),error=>[404,409].includes(error));assert.equal(hook.fired(),true);await noPublished(f.DB);assert.equal(await count(f.DB,'source_pilot_records','target_kind IS NOT NULL'),0);assert.equal(await count(f.DB,'source_pilot_runs',"state='DONE'"),0);
});
test('R2 staging failure publishes no canonical records and same-request recovery completes exactly once',async t=>{
 const f=await setup(t);let puts=0;const bindings={...f.env,FILES:{head:(...a)=>f.FILES.head(...a),get:(...a)=>f.FILES.get(...a),put:async(...args)=>{if(++puts===3)throw Error('Synthetic source stage failure');return f.FILES.put(...args);}}};await rejected(()=>f.apply(f.input,f.actor,bindings),503);await noPublished(f.DB);assert.equal(await count(f.DB,'source_pilot_runs',"state='DONE'"),0);const receipt=await f.apply();assert.equal(receipt.state,'DONE');assert.deepEqual(await f.apply(),receipt);assert.equal(await count(f.DB,'notes'),3);assert.equal(await count(f.DB,'note_versions'),3);assert.equal(await count(f.DB,'tasks'),1);assert.equal(await count(f.DB,'files',"state='ready'"),1);assert.equal(await count(f.DB,'source_pilot_records'),19);
});
test('missing or corrupted retained source objects fail reads and DONE replay without silently replacing originals',async t=>{
 const f=await setup(t),receipt=await f.apply(),source=f.input.objects[0];for(const fault of['missing','corrupt']){let writes=0;const bindings={...f.env,FILES:{head:(...a)=>f.FILES.head(...a),put:async(...a)=>{writes++;return f.FILES.put(...a);},async get(key){const actual=await f.FILES.get(key);if(fault==='missing')return null;const bytes=new Uint8Array(await actual.arrayBuffer());bytes[0]^=1;return {size:actual.size,arrayBuffer:async()=>bytes.buffer};}}};await rejected(()=>readSourceObject(bindings,f.actor,receipt.id,source.source,source.path),503);await rejected(()=>f.apply(f.input,f.actor,bindings),503);assert.equal(writes,0);}const original=await f.DB.prepare("SELECT object_key FROM files WHERE id='canonical-legacy-attachment'").first();await f.FILES.delete(original.object_key);await rejected(()=>f.apply(),503);
});
test('source object delivery rechecks current finance and project-client scope after storage I/O',async t=>{
 for(const fault of['finance','scope']){const f=await setup(t),receipt=await f.apply(),source=f.input.objects[0];let fired=false;const bindings={...f.env,FILES:{head:(...a)=>f.FILES.head(...a),put:(...a)=>f.FILES.put(...a),async get(key){const object=await f.FILES.get(key);if(!fired){fired=true;if(fault==='finance')await f.DB.prepare("DELETE FROM actor_finance_access WHERE id='cameron'").run();else await f.DB.prepare("UPDATE projects SET client_id='other-client' WHERE id='canonical-project'").run();}return object;}}};await rejected(()=>readSourceObject(bindings,f.actor,receipt.id,source.source,source.path),fault==='finance'?403:404);assert.equal(fired,true);}
});
test('lost acknowledgement of the canonical D1 commit is recovered by the same immutable receipt without duplicate records',async t=>{
 const f=await setup(t);let prepared=[],lost=false;const bindings={...f.env,DB:{prepare(sql){prepared.push(sql);return f.DB.prepare(sql);},async batch(statements){const queries=prepared;prepared=[];const result=await f.DB.batch(statements);if(!lost&&queries.some(sql=>/INSERT\s+INTO\s+notes\b/i.test(sql))){lost=true;throw Error('Synthetic lost D1 response after commit');}return result;}}};let returned;try{returned=await f.apply(f.input,f.actor,bindings);}catch(error){assert.ok(error===503||error instanceof Error);}assert.equal(lost,true);const receipt=await f.apply();assert.equal(receipt.state,'DONE');if(returned)assert.deepEqual(returned,receipt);assert.equal(await count(f.DB,'notes'),3);assert.equal(await count(f.DB,'note_versions'),3);assert.equal(await count(f.DB,'source_pilot_records'),19);
});

test('late mutation of held provenance or pinned object metadata cannot commit canonical records or DONE',async t=>{
 for(const fault of['held-image','object-metadata','run-fingerprint','missing-run'])await t.test(fault,async child=>{const f=await setup(child),hook=lateCanonicalBatch(f,async()=>{if(fault==='missing-run'){await f.DB.prepare('DELETE FROM source_pilot_objects WHERE run_id=?').bind(f.input.requestId).run();await f.DB.prepare('DELETE FROM source_pilot_records WHERE run_id=?').bind(f.input.requestId).run();await f.DB.prepare('DELETE FROM source_pilot_runs WHERE id=?').bind(f.input.requestId).run();}else if(fault==='held-image')await f.DB.prepare("UPDATE source_pilot_records SET image_json='{}' WHERE run_id=? AND source_key='notion:database.csv'").bind(f.input.requestId).run();else if(fault==='run-fingerprint')await f.DB.prepare('UPDATE source_pilot_runs SET fingerprint=? WHERE id=?').bind('0'.repeat(64),f.input.requestId).run();else await f.DB.prepare('UPDATE source_pilot_objects SET sha256=? WHERE run_id=? AND source=? AND path=?').bind('0'.repeat(64),f.input.requestId,f.input.objects[0].source,f.input.objects[0].path).run();});await assert.rejects(()=>f.apply(f.input,f.actor,hook.bindings),error=>[409,503].includes(error),fault);assert.equal(hook.fired(),true);await noPublished(f.DB);assert.equal(await count(f.DB,'source_pilot_records','target_kind IS NOT NULL'),0);assert.equal(await count(f.DB,'source_pilot_runs',"state='DONE'"),0);});
});
test('source record reads discard cached provenance after finance is revoked during the D1 read',async t=>{
 const f=await setup(t),receipt=await f.apply();let fired=false;
 const after=async sql=>{if(!fired&&/FROM\s+["`]?source_pilot_records\b/i.test(sql)){fired=true;await f.DB.prepare("DELETE FROM actor_finance_access WHERE id='cameron'").run();}};
 const wrap=(statement,sql)=>new Proxy(statement,{get(target,key){if(key==='bind')return(...values)=>wrap(target.bind(...values),sql);if(key==='all')return async(...args)=>{const result=await target.all(...args);await after(sql);return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const bindings={...f.env,DB:{prepare:sql=>wrap(f.DB.prepare(sql),sql),batch:statements=>f.DB.batch(statements)}};
 await rejected(()=>readSourcePilot(bindings,f.actor,receipt.id),403);assert.equal(fired,true);
});

test('DONE replay rejects a deleted imported task or an original file reverted to pending',async t=>{
 for(const fault of['deleted-task','pending-file'])await t.test(fault,async child=>{const f=await setup(child),receipt=await f.apply();if(fault==='deleted-task')await f.DB.prepare("DELETE FROM tasks WHERE id='canonical-legacy-task'").run();else await f.DB.prepare("UPDATE files SET state='pending' WHERE id='canonical-legacy-attachment'").run();await rejected(()=>f.apply(),503);await rejected(()=>readSourcePilot(f.env,f.actor,receipt.id),503);});
});
test('invalid exported calendar due dates are held explicitly rather than throwing an uncoded RangeError',async t=>{
 const f=await setup(t),input=structuredClone(f.input);input.report.records.find(r=>r.kind==='task').raw.dueDate='2025-99-99';await assert.rejects(()=>f.apply(input),error=>[400,409].includes(error));await noPublished(f.DB);
});
test('archive identity cannot be swapped to an unrelated object containing identical bytes',async t=>{
 const f=await setup(t),receipt=await f.apply(),object=f.input.objects[0];await f.FILES.put('nonarchive-identical-copy',object.bytes);await f.DB.prepare('UPDATE source_pilot_objects SET object_key=? WHERE run_id=? AND source=? AND path=?').bind('nonarchive-identical-copy',receipt.id,object.source,object.path).run();await rejected(()=>readSourceObject(f.env,f.actor,receipt.id,object.source,object.path),503);await rejected(()=>f.apply(),503);
});
test('run fingerprints and target identity must remain bound to the immutable reviewed report',async t=>{
 for(const fault of['fingerprint','target'])await t.test(fault,async child=>{const f=await setup(child);await f.apply();if(fault==='fingerprint')await f.DB.prepare('UPDATE source_pilot_runs SET fingerprint=? WHERE id=?').bind('0'.repeat(64),f.input.requestId).run();else await f.DB.prepare("UPDATE source_pilot_runs SET client_id='other-client' WHERE id=?").bind(f.input.requestId).run();await rejected(()=>f.apply(),503);});
});

test('declared archive budget is rejected before cloning or hashing oversized shared source buffers',async t=>{
 const f=await setup(t),input=structuredClone(f.input),shared=new Uint8Array(5*1024*1024),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',shared)).toString('hex');let clones=0;shared.slice=()=>{clones++;throw Error('cloned before declared limit');};
 for(let i=0;i<4;i++){const path='extra-large-'+i+'.bin';input.report.sourceFiles.notion.push({path,bytes:shared.length,sha256});input.objects.push({source:'notion',path,bytes:shared});}
 await rejected(()=>f.apply(input),413);assert.equal(clones,0);await noPublished(f.DB);assert.equal(await count(f.DB,'source_pilot_runs'),0);
});
test('malformed canonical target field names fail input validation before any D1 binding or write',async t=>{
 const f=await setup(t),input=structuredClone(f.input);input.report.target={organizationId:'pilot-org',clientId:'canonical-client',wrongProjectField:'canonical-project'};await rejected(()=>f.apply(input),400);await noPublished(f.DB);assert.equal(await count(f.DB,'source_pilot_runs'),0);
});

test('concurrent identical source-pilot submissions return one stable receipt and canonical work exactly once',async t=>{
 const f=await setup(t),receipts=await Promise.all([f.apply(),f.apply()]);assert.deepEqual(receipts[0],receipts[1]);assert.equal(receipts[0].state,'DONE');assert.deepEqual(await f.apply(),receipts[0]);assert.equal(await count(f.DB,'source_pilot_runs'),1);assert.equal(await count(f.DB,'source_pilot_records'),19);assert.equal(await count(f.DB,'source_pilot_objects'),f.input.objects.length);assert.equal(await count(f.DB,'notes'),3);assert.equal(await count(f.DB,'note_versions'),3);assert.equal(await count(f.DB,'tasks'),1);assert.equal(await count(f.DB,'files'),1);
});
