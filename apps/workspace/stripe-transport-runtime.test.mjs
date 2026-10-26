import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,Response} from 'miniflare';

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
