import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { generateKeyPair,SignJWT } from 'jose';
import { Miniflare } from 'miniflare';
import { createWorker } from './worker.mjs';

const {publicKey,privateKey}=await generateKeyPair('RS256');
const issuer='https://identity.cloudflareaccess.com',origin='https://workspace.example.invalid';

test('manual Meta Ads agency workspace enforces tenant and client boundaries',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test storage")}}',d1Databases:{DB:'meta-ads-test'},cf:false});
 t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');
  await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
 }
 const env={DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'workspace'};
 const worker=createWorker(publicKey),tokens={};
 for(const [id,email,org,role,client] of [
  ['staff','staff@example.invalid','a','staff',null],
  ['client1','client1@example.invalid','a','client','c1'],
  ['client2','client2@example.invalid','a','client','c2'],
  ['foreign','foreign@example.invalid','b','staff',null]
 ]){
  await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,email,org,role,client).run();
  tokens[id]=await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('workspace').setSubject(id).setIssuedAt().setExpirationTime('5m').sign(privateKey);
 }
 for(const [id,name] of [['c1','Client One'],['c2','Client Two']])await DB.prepare('INSERT INTO clients(id,organization_id,name,revision) VALUES(?,?,?,0)').bind(id,'a',name).run();
 const call=(path,actor='staff',method='GET',body,extra={})=>worker.fetch(new Request(origin+path,{method,headers:{...(actor?{'Cf-Access-Jwt-Assertion':tokens[actor]}:{}),...(body?{'Content-Type':'application/json','Origin':origin}:{}),...extra},body:body?JSON.stringify(body):undefined}),env);
 await t.test('authentication and client workspace creation',async()=>{
  assert.equal((await call('/api/meta-ads',null)).status,401);
  const response=await call('/api/meta-ads','staff','POST',{clientId:'c1',businessName:'Painting Co',currency:'CAD',timezone:'America/Toronto',serviceAreas:['Toronto','Scarborough'],checklist:{partner_access:'complete'}});
  assert.equal(response.status,201);
  const account=await response.json();assert.equal(account.client_id,'c1');assert.equal(account.service_areas[0],'Toronto');assert.equal(account.checklist.partner_access,'complete');
  assert.equal((await call('/api/meta-ads/c1','client1')).status,200);
  assert.equal((await call('/api/meta-ads/c1','client2')).status,404);
  assert.equal((await call('/api/meta-ads/c1','foreign')).status,404);
  assert.equal((await call('/api/meta-ads','client1','POST',{clientId:'c2'})).status,403);
 });
 let campaign,creative,lead;
 await t.test('campaign plans are staff-managed and client-visible only when shared',async()=>{
  const response=await call('/api/meta-ads/c1/campaigns','staff','POST',{name:'GTA Interior Painting',objective:'leads',conversionLocation:'instant_form',dailyBudgetMinor:1500,currency:'CAD',serviceArea:'Toronto and Scarborough',status:'draft',clientVisible:true});
  assert.equal(response.status,201);campaign=await response.json();assert.equal(campaign.daily_budget_minor,1500);
  assert.equal((await call('/api/meta-ads/c1/campaigns','client1')).status,200);
  assert.equal((await call('/api/meta-ads/c1/campaigns','client2')).status,404);
  assert.equal((await call('/api/meta-ads/campaigns/'+campaign.id,'client1')).status,200);
  assert.equal((await call('/api/meta-ads/campaigns/'+campaign.id,'client2')).status,404);
  assert.equal((await call('/api/meta-ads/c1/campaigns','client1','POST',{name:'No',objective:'leads',conversionLocation:'instant_form',dailyBudgetMinor:1000,currency:'CAD'})).status,403);
  assert.equal((await call('/api/meta-ads/campaigns/'+campaign.id,'staff','PATCH',{revision:0,status:'entered_in_meta'})).status,200);
  assert.equal((await call('/api/meta-ads/campaigns/'+campaign.id,'staff','PATCH',{revision:0,status:'paused'})).status,409);
 });
 await t.test('creative approval is explicit and never publishes in Meta',async()=>{
  const response=await call('/api/meta-ads/campaigns/'+campaign.id+'/creatives','staff','POST',{name:'Before and after',format:'feed_portrait',primaryText:'Refresh your home with professional painting.',headline:'Get a free estimate',cta:'get_quote',status:'awaiting_approval',clientVisible:true});
  assert.equal(response.status,201);creative=await response.json();assert.equal(creative.status,'awaiting_approval');
  const visible=await call('/api/meta-ads/campaigns/'+campaign.id+'/creatives','client1');assert.equal(visible.status,200);assert.equal((await visible.json()).items.length,1);
  assert.equal((await call('/api/meta-ads/campaigns/'+campaign.id+'/creatives','client2')).status,404);
  assert.equal((await call('/api/meta-ads/creatives/'+creative.id+'/decision','staff','POST',{decision:'approved'})).status,403);
  const decision=await call('/api/meta-ads/creatives/'+creative.id+'/decision','client1','POST',{decision:'approved',feedback:'Looks good'});
  assert.equal(decision.status,200);assert.equal((await decision.json()).status,'approved');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM meta_ad_approvals WHERE creative_id=?').bind(creative.id).first()).n,1);
 });
 await t.test('lead PII and internal notes are restricted to the correct client and staff',async()=>{
  const response=await call('/api/meta-ads/c1/leads','staff','POST',{fullName:'Synthetic Lead',email:'lead@example.invalid',phone:'4165550100',city:'Toronto',service:'Interior painting',campaignId:campaign.id,stage:'new',internalNotes:'Internal qualification note',clientVisible:false});
  assert.equal(response.status,201);lead=await response.json();assert.equal(lead.internal_notes,'Internal qualification note');
  assert.equal((await (await call('/api/meta-ads/c1/leads','client1')).json()).items.length,0);
  assert.equal((await call('/api/meta-ads/leads/'+lead.id,'client2')).status,404);
  assert.equal((await call('/api/meta-ads/leads/'+lead.id,'staff','PATCH',{revision:0,clientVisible:true})).status,200);
  const clientLead=await (await call('/api/meta-ads/c1/leads','client1')).json();
  assert.equal(clientLead.items.length,1);assert.equal('internal_notes' in clientLead.items[0],false);
  assert.equal((await call('/api/meta-ads/leads/'+lead.id,'client1','PATCH',{revision:1,stage:'won'})).status,403);
 });
 await t.test('manual reports require matching campaign currency and do not mix clients',async()=>{
  const report={campaignId:campaign.id,reportDate:'2026-11-09',spendMinor:1500,revenueMinor:0,currency:'CAD',impressions:1000,reach:800,clicks:20,leads:2,qualifiedLeads:1,estimatesBooked:1,jobsWon:0,clientVisible:true};
  const response=await call('/api/meta-ads/c1/reports','staff','POST',report);assert.equal(response.status,201);
  assert.equal((await call('/api/meta-ads/c1/reports','client1')).status,200);
  assert.equal((await call('/api/meta-ads/c1/reports','client2')).status,404);
  assert.equal((await call('/api/meta-ads/c1/reports','staff','POST',{...report,currency:'USD'})).status,400);
  assert.equal((await call('/api/meta-ads/c1/reports','client1','POST',report)).status,403);
 });
 await t.test('activity is staff-only and input/origin validation fails closed',async()=>{
  assert.equal((await call('/api/meta-ads/c1/activity','client1')).status,403);
  assert.equal((await call('/api/meta-ads/c1','staff','PATCH',{revision:0,websiteUrl:'javascript:alert(1)'})).status,400);
  assert.equal((await call('/api/meta-ads/c1','staff','PATCH',{revision:0,notes:'No origin'},{Origin:'https://attacker.invalid'})).status,403);
  assert.ok((await (await call('/api/meta-ads/c1/activity','staff')).json()).items.length>=4);
 });
});

