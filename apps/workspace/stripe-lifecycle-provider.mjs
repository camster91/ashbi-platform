import assert from 'node:assert/strict';
import {stripeTestProvider} from './stripe-test-provider.mjs';

// HTTP-only synthetic provider: never imported by the Worker.
export function stripeLifecycleProvider(organizationId='life-a'){
 const p=stripeTestProvider({organizationId,enabled:true}),original=p.fetch;
 Object.assign(p,{payments:new Map(),credits:new Map(),refunds:new Map(),intents:new Map(),charges:new Map(),balances:new Map(),pageSize:2,failPath:null});
 const page=(rows,u)=>{const after=u.searchParams.get('starting_after'),offset=after?rows.findIndex(r=>r.id===after)+1:0;assert.ok(!after||offset>0);return Response.json({object:'list',data:rows.slice(offset,offset+p.pageSize),has_more:rows.length>offset+p.pageSize,url:'/untrusted-do-not-follow'});};
 p.fetch=async(url,options={})=>{
  const u=new URL(url),path=u.pathname,method=options.method||'GET';
  if(p.failPath&&path.includes(p.failPath))throw Error('Synthetic provider interruption');
  const custom=path==='/v1/invoice_payments'||path==='/v1/credit_notes'||path==='/v1/refunds'||/^\/v1\/(invoice_payments|payment_intents|charges|refunds|credit_notes)\//.test(path)||path.includes('/balance_transactions/');
  if(!custom)return original(url,options);
  assert.equal(u.origin,'https://api.stripe.com');assert.equal(method,'GET');assert.equal(options.redirect,'manual');assert.equal(new Headers(options.headers).get('Stripe-Version'),'2026-09-30.endive');assert.equal(new Headers(options.headers).get('Authorization'),'Bearer '+p.bindings.STRIPE_SECRET_KEY);
  p.requests.push({method,path,params:Object.fromEntries(u.searchParams)});await p.pause?.({method,path});
  if(path==='/v1/invoice_payments'){
   const invoice=u.searchParams.get('invoice'),intent=u.searchParams.get('payment[payment_intent]');
   return page(invoice?(p.payments.get(invoice)||[]):[...p.payments.values()].flat().filter(r=>r.payment.payment_intent===intent),u);
  }
  if(path==='/v1/credit_notes')return page(p.credits.get(u.searchParams.get('invoice'))||[],u);
  if(path==='/v1/refunds')return page([...p.refunds.values()].filter(r=>u.searchParams.has('payment_intent')?r.payment_intent===u.searchParams.get('payment_intent'):r.charge===u.searchParams.get('charge')),u);
  const id=path.split('/').at(-1),map=path.startsWith('/v1/invoice_payments/')?new Map([...p.payments.values()].flat().map(r=>[r.id,r])):path.includes('/balance_transactions/')?p.balances:path.startsWith('/v1/refunds/')?p.refunds:path.startsWith('/v1/charges/')?p.charges:path.startsWith('/v1/credit_notes/')?new Map([...p.credits.values()].flat().map(r=>[r.id,r])):p.intents,row=map.get(id);
  return Response.json(row||{error:{}},{status:row?200:404});
 };return p;
}
