import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,Response} from 'miniflare';
import {partServices} from './stripe-drafts.mjs';

test('Stripe create omits invalid empty default tax rates while retaining explicit discount suppression',async t=>{
 const env={STRIPE_MODE:'test',STRIPE_ACCOUNT_ID:'acct_fixture',STRIPE_SECRET_KEY:'sk_test_fixture'},op={id:'operation',invoice_id:'invoice',customer_id:'cus_fixture',schedule_id:'schedule',part_id:'part',stripe_invoice_id:'in_fixture'},plan={currency:'CAD',title:'Reviewed HST invoice',dueAt:1800000000,fingerprint:'reviewed',tax:{type:'HST',rateBps:1300},lines:[{index:0,amountMinor:10000,taxMinor:1300,description:'Reviewed service'}]};
 const requests=[],services=partServices(async(url,options)=>{const params=new URLSearchParams(options.body);requests.push({url,params});if(params.has('default_tax_rates'))return Response.json({error:{code:'parameter_invalid_empty',param:'default_tax_rates'}},{status:400});return Response.json({object:'invoice',id:'in_fixture'});});
 await t.test('create sends no default_tax_rates parameter and keeps discounts empty',async()=>{
  assert.equal((await services.create(env,op,plan,'original-create-key')).id,'in_fixture');const {url,params}=requests.at(-1);assert.equal(url,'https://api.stripe.com/v1/invoices');assert.equal(params.has('default_tax_rates'),false);assert.equal(params.get('discounts'),'');assert.equal(params.get('automatic_tax[enabled]'),'false');assert.equal(params.get('auto_advance'),'false');
 });
 await t.test('HST remains an exact exclusive line amount',async()=>{
  await services.addLines(env,op,plan,'original-lines-key');const {params}=requests.at(-1);assert.equal(params.get('lines[0][tax_amounts][0][amount]'),'1300');assert.equal(params.get('lines[0][tax_amounts][0][taxable_amount]'),'10000');assert.equal(params.get('lines[0][tax_amounts][0][tax_rate_data][percentage]'),'13');assert.equal(params.get('lines[0][tax_amounts][0][tax_rate_data][inclusive]'),'false');assert.equal(params.get('lines[0][discountable]'),'false');
 });
 await t.test('readback still refuses inherited default tax rates or discounts',()=>{
  const value={object:'invoice',id:'in_fixture',livemode:false,customer:op.customer_id,currency:'cad',status:'draft',auto_advance:false,collection_method:'send_invoice',due_date:plan.dueAt,description:plan.title,metadata:{ashbi_operation:op.id,ashbi_invoice:op.invoice_id,ashbi_plan:plan.fingerprint,ashbi_schedule:op.schedule_id,ashbi_part:op.part_id},amount_paid:0,starting_balance:0,amount_shipping:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,automatic_tax:{enabled:false},discounts:[],default_tax_rates:[]};
  assert.doesNotThrow(()=>services.baseMatches(value,op,plan));for(const change of [{default_tax_rates:[{id:'txr_inherited'}]},{discounts:[{id:'di_inherited'}]}])assert.throws(()=>services.baseMatches({...value,...change},op,plan),{code:'PROVIDER_MISMATCH'});
 });
});

// Run the production transport in workerd: Node fetch accepts redirect:'error',
// but Workers supports only follow/manual. Intercept outbound traffic after
// workerd validates RequestInit so no real provider or credential is involved.
test('Stripe transport works in workerd and refuses redirects without forwarding credentials',async t=>{
 const bundle=await build({stdin:{contents:`import {stripeProviderRead,stripeFinalizeInvoice} from './stripe-drafts.mjs';
export default {async fetch(request,env){try{const url=new URL(request.url);return Response.json(url.pathname==='/post'?await stripeFinalizeInvoice(env,fetch,'in_fixture','fixture-key'):await stripeProviderRead(env,fetch,url.pathname.slice(1)));}catch(error){return Response.json({code:error.code,status:error.httpStatus},{status:503});}}};`,resolveDir:fileURLToPath(new URL('.',import.meta.url)),sourcefile:'stripe-runtime-fixture.mjs'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const requests=[];
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-07-30',script:bundle.outputFiles[0].text,cf:false,bindings:{STRIPE_MODE:'test',STRIPE_ACCOUNT_ID:'acct_fixture',STRIPE_SECRET_KEY:'sk_test_fixture'},outboundService:async request=>{
  requests.push({url:request.url,method:request.method,authorization:request.headers.get('Authorization'),key:request.headers.get('Idempotency-Key'),body:await request.text()});
  if(request.url.endsWith('/redirect'))return new Response(null,{status:302,headers:{Location:'https://credential-sink.invalid/collect'}});
  return Response.json({object:'fixture',ok:true});
 }});t.after(()=>mf.dispose());
 await t.test('GET account reaches provider using the native runtime',async()=>{
  const response=await mf.dispatchFetch('http://localhost/account');assert.equal(response.status,200);assert.deepEqual(await response.json(),{object:'fixture',ok:true});
  assert.deepEqual(requests.at(-1),{url:'https://api.stripe.com/v1/account',method:'GET',authorization:'Bearer sk_test_fixture',key:null,body:''});
 });
 await t.test('POST finalize preserves its body and idempotency key',async()=>{
  const response=await mf.dispatchFetch('http://localhost/post');assert.equal(response.status,200);assert.deepEqual(await response.json(),{object:'fixture',ok:true});
  assert.deepEqual(requests.at(-1),{url:'https://api.stripe.com/v1/invoices/in_fixture/finalize',method:'POST',authorization:'Bearer sk_test_fixture',key:'fixture-key',body:'auto_advance=false'});
 });
 await t.test('302 fails closed without following Location',async()=>{
  const before=requests.length,response=await mf.dispatchFetch('http://localhost/redirect');assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'PROVIDER_UNAVAILABLE',status:302});assert.equal(requests.length,before+1);assert.equal(requests.at(-1).url,'https://api.stripe.com/v1/redirect');
 });
});
