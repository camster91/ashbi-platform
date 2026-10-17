import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyRequest, sanitizeBrowserEvent, sanitizeFontChecks, startPortalChooserEvidence, PORTAL_CHOOSER_TITLE, TRACE_POLICY } from './portal-chooser-evidence.ts';
const origin = 'http://127.0.0.1:4188';

test('only exact synthetic API methods and identities are admitted', () => {
  for (const [method,path] of [['GET','/api/auth/me'],['POST','/api/client-portal/verify-token'],['GET','/api/client-portal/projects/project-a/documents'],['POST','/api/client-portal/projects/project-a/upload'],['POST','/api/client-portal/projects/project-a/messages'],['DELETE','/api/client-portal/documents/document-a']]) assert.equal(classifyRequest(origin+path,method,'fetch',origin).allowed,true);
  for (const [method,path] of [['POST','/api/auth/me'],['GET','/api/client-portal/verify-token'],['POST','/api/client-portal/projects/project-b/upload'],['DELETE','/api/client-portal/documents/document-b'],['GET','/api/client-portal/me?secret=sentinel']]) assert.equal(classifyRequest(origin+path,method,'fetch',origin).allowed,false);
});
test('remote content, wrong documents and nonasset endpoints are refused', () => {
  assert.equal(classifyRequest('https://example.com/src/a.js','GET','script',origin).kind,'external');
  assert.equal(classifyRequest(origin+'/client-portal/verify?token=portal-keyboard-token','GET','document',origin).allowed,true);
  for(const path of ['/client/client-a','/client-portal/verify?token=other','/admin.js']) assert.equal(classifyRequest(origin+path,'GET',path.includes('.js')?'script':'document',origin).allowed,false);
  assert.equal(classifyRequest(origin+'/src/main.jsx','GET','script',origin).allowed,true);
});
test('sanitizer removes unknown data and closes aliases/keys/path', () => {
  const clean = sanitizeBrowserEvent({seq:1,ms:3,event:'CLICK',target:'upload-button',active:'secret-sentinel',key:'password-sentinel',path:['file-input','secret-sentinel'],text:'secret-sentinel',url:'secret-sentinel',headers:{secret:'secret-sentinel'},connected:true,generation:999999});
  assert.equal(JSON.stringify(clean).includes('secret-sentinel'),false);
  assert.deepEqual(clean.path,['file-input','other']);
  assert.equal(clean.connected,true); assert.equal(clean.generation,undefined);
  assert.equal(sanitizeBrowserEvent({seq:401,ms:0,event:'CLICK'}),null);
  assert.equal(sanitizeBrowserEvent({seq:1,ms:0,event:'SECRET'}),null);
});
async function harness(closed=false) {
  const directory=await mkdtemp(join(tmpdir(),'portal-659-offline-'));
  const contextRoutes=[],pageRoutes=[],socketRoutes=[],listeners=new Map(),attachments=[];
  const context={route:async(pattern,handler)=>contextRoutes.push(handler),routeWebSocket:async(pattern,handler)=>socketRoutes.push(handler)};
  const page={context:()=>context,route:async(pattern,handler)=>pageRoutes.push(handler),addInitScript:async()=>{},on:(name,fn)=>listeners.set(name,fn),off:(name)=>listeners.delete(name),once:(name,fn)=>listeners.set(name,fn),isClosed:()=>closed,evaluate:async()=>({events:[{seq:1,ms:1,event:'CLICK',target:'file-input',value:'secret-sentinel'}],truncated:false})};
  const info={annotations:[],title:PORTAL_CHOOSER_TITLE,project:{name:'chromium'},retry:1,repeatEachIndex:0,outputPath:name=>join(directory,name),attach:async(name,attachment)=>attachments.push({name,...attachment})};
  return {directory,contextRoutes,pageRoutes,socketRoutes,listeners,attachments,page,info};
}
test('network API never escapes context; page fence falls back only to canned exact route',async()=>{
 const h=await harness();try{
  await startPortalChooserEvidence(h.page,h.info,origin);
  const route=(url,method='GET',type='fetch')=>({request:()=>({url:()=>url,method:()=>method,resourceType:()=>type}),abort:async()=>{route.aborted++},continue:async()=>{route.continued++},fallback:async()=>{route.fallback++}});route.aborted=0;route.continued=0;route.fallback=0;
  await h.contextRoutes[0](route(origin+'/api/client-portal/me'));
  await h.pageRoutes[0](route(origin+'/api/client-portal/me'));
  await h.pageRoutes[0](route('https://example.com/api/client-portal/me'));
  assert.equal(route.aborted,2);assert.equal(route.fallback,1);assert.equal(route.continued,0);
 }finally{await rm(h.directory,{recursive:true,force:true})}
});
test('failed body flush retains bounded sanitized events and standard trace policy',async()=>{
 const h=await harness();try{
  const evidence=await startPortalChooserEvidence(h.page,h.info,origin);
  for(let i=0;i<180;i++) evidence.mark('ENTER_START');
  await evidence.finish('failed');
  const proof=JSON.parse(await readFile(h.attachments[0].path,'utf8'));
  assert.equal(h.attachments[0].name,'portal-chooser-659-chronology');assert.equal(proof.boundary.truncated,true);
  assert.equal(proof.events.filter(e=>e.clock==='node').length,160);
  assert.equal(JSON.stringify(proof).includes('secret-sentinel'),false);
  assert.deepEqual(h.info.annotations,[{type:'portal-chooser-repeat',description:'0'}]);assert.deepEqual(proof.tracePolicy,TRACE_POLICY);assert.equal(proof.retry,1);assert.equal(h.listeners.size,0);
 }finally{await rm(h.directory,{recursive:true,force:true})}
});
test('normal failed body has explicit failure event and closed page reports incomplete drain',async()=>{
 const h=await harness(true);try{
  const evidence=await startPortalChooserEvidence(h.page,h.info,origin);await evidence.finish('failed');
  const proof=JSON.parse(await readFile(h.attachments[0].path,'utf8'));
  assert.equal(proof.boundary.drainStatus,'page_closed');assert.ok(proof.events.some(e=>e.event==='BODY_FAILED'));
 }finally{await rm(h.directory,{recursive:true,force:true})}
});
test('wrong source case or nonloopback base refuses before route installation',async()=>{
 const h=await harness();try{
  await assert.rejects(startPortalChooserEvidence(h.page,{...h.info,title:'other'},origin),/SCOPE/);
  await assert.rejects(startPortalChooserEvidence(h.page,h.info,'https://example.com'),/SCOPE/);
  assert.equal(h.contextRoutes.length,0);
 }finally{await rm(h.directory,{recursive:true,force:true})}
});

test('chooser observer is registered only after explicit original-listener marker',async()=>{
 const h=await harness();try{
  const evidence=await startPortalChooserEvidence(h.page,h.info,origin);
  assert.equal(h.listeners.has('filechooser'),false);
  assert.throws(()=>evidence.mark('RAW_ERROR_SECRET'),/MARK/);
  evidence.mark('LISTENER_ARMED');assert.equal(h.listeners.has('filechooser'),true);
  h.listeners.get('filechooser')();await evidence.finish('completed');
  const proof=JSON.parse(await readFile(h.attachments[0].path,'utf8'));
  assert.equal(proof.boundary.drainStatus,'complete');
  assert.deepEqual(proof.events.filter(e=>['LISTENER_ARMED','FILECHOOSER','BODY_COMPLETED'].includes(e.event)).map(e=>e.event),['LISTENER_ARMED','FILECHOOSER','BODY_COMPLETED']);
 }finally{await rm(h.directory,{recursive:true,force:true})}
});

test('font metadata has fixed known checks only and retains loading as a limitation',()=>{
 assert.deepEqual(sanitizeFontChecks({status:'loading',registeredDmSans:true,dmSans400:true,dmSans500:false,dmSans600:true,family:'secret-sentinel'}),{status:'loading',registeredDmSans:true,dmSans400:true,dmSans500:false,dmSans600:true});
 assert.deepEqual(sanitizeFontChecks({status:42,registeredDmSans:'true',dmSans400:1,dmSans500:{},dmSans600:[]} ),{status:'unavailable',registeredDmSans:false,dmSans400:false,dmSans500:false,dmSans600:false});
 assert.deepEqual(sanitizeFontChecks(undefined),{status:'unavailable',registeredDmSans:false,dmSans400:false,dmSans500:false,dmSans600:false});
});
