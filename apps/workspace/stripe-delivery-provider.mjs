import assert from 'node:assert/strict';
import {stripeLifecycleProvider} from './stripe-lifecycle-provider.mjs';

// Synthetic test-only send contract; no network and no email delivery.
export function stripeDeliveryProvider(organizationId='a'){
 const p=stripeLifecycleProvider(organizationId),original=p.fetch,sendKeys=new Map();let sequence=0;
 Object.assign(p,{sendKeys,sendEffects:[],loseSend:false,failSendBefore:false,cacheSend500:false,omitRequestId:false,beforeSend:null,afterSend:null,mutateSendResponse:null});
 const seedSnapshot=()=>{for(const row of p.invoices.values())if(row.customer_email===undefined){const customer=p.customers.get(row.customer);row.customer_email=customer?.email??null;row.customer_name=customer?.name??null;}};
 p.fetch=async(url,options={})=>{const u=new URL(url),method=options.method||'GET',match=u.pathname.match(/^\/v1\/invoices\/(in_[a-zA-Z0-9_]+)\/send$/);
  if(method==='POST'&&match){const headers=new Headers(options.headers),params=Object.fromEntries(new URLSearchParams(options.body)),key=headers.get('Idempotency-Key');assert.equal(u.origin,'https://api.stripe.com');assert.equal(options.redirect,'manual');assert.equal(headers.get('Authorization'),'Bearer '+p.bindings.STRIPE_SECRET_KEY);assert.equal(headers.get('Stripe-Version'),'2026-09-30.endive');assert.ok(key);assert.deepEqual(params,{});p.requests.push({method,path:u.pathname,key,params});await p.pause?.({method,path:u.pathname});await p.beforeSend?.({key,invoiceId:match[1]});const intent=JSON.stringify({path:u.pathname,params}),prior=sendKeys.get(key);
   if(prior){if(prior.intent!==intent)return Response.json({error:{type:'idempotency_error'}},{status:409});return Response.json(prior.body,{status:prior.status,headers:prior.headers});}
   if(p.failSendBefore){p.failSendBefore=false;throw Error('Synthetic send interrupted before effect');}
   if(p.cacheSend500){p.cacheSend500=false;const entry={intent,status:500,body:{error:{type:'api_error'}},headers:{'Request-Id':'req_send_failed_'+(++sequence)}};sendKeys.set(key,entry);return Response.json(entry.body,{status:entry.status,headers:entry.headers});}
   seedSnapshot();const row=p.invoices.get(match[1]);if(!row||!['open','paid'].includes(row.status))return Response.json({error:{}},{status:row?409:404});const requestId='req_send_'+(++sequence),body=structuredClone(row),responseHeaders=p.omitRequestId?{}:{'Request-Id':requestId};p.mutateSendResponse?.(body);const entry={intent,status:200,body,headers:responseHeaders};sendKeys.set(key,entry);p.sendEffects.push({key,invoiceId:row.id,requestId});await p.afterSend?.({key,invoiceId:row.id,requestId});if(p.loseSend){p.loseSend=false;throw Error('Synthetic lost send acknowledgement');}return Response.json(body,{headers:responseHeaders});
  }
  seedSnapshot();const response=await original(url,options);seedSnapshot();const value=await response.clone().json();if(value.object==='invoice'){const native=p.invoices.get(value.id);if(native){value.customer_email=native.customer_email;value.customer_name=native.customer_name;return Response.json(value,{status:response.status,headers:response.headers});}}return response;
 };return p;
}
