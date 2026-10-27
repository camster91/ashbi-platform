import {observeInvoiceDeliverySent,deliveryInboxProof} from './stripe-delivery.mjs';
import {observeStripePartNative,stripePartInboxProof} from './stripe-part-lifecycle.mjs';
import {hasFinance} from './time-details.mjs';
import {stripeProviderRead,stripeInvoiceLines,stripeInvoiceContentsMatch} from './stripe-drafts.mjs';

const clock="CAST(strftime('%s','now') AS INTEGER)*1000",leaseMs=300000;
const authority="EXISTS(SELECT 1 FROM actors a JOIN actor_finance_access f ON f.id=a.id AND f.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=? AND a.active=1 AND a.role='staff')";
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(v);
const ext=(v,p)=>typeof v==='string'&&new RegExp('^'+p+'_[a-zA-Z0-9_]{1,100}$').test(v);
const money=v=>Number.isSafeInteger(v)&&v>=0;
const opaque=v=>typeof v==='string'&&/^[a-zA-Z0-9_]{1,128}$/.test(v);
const bytes=v=>new TextEncoder().encode(v);
const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(v))),b=>b.toString(16).padStart(2,'0')).join('');
class SyncError extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
const mismatch=()=>{throw new SyncError('PROVIDER_MISMATCH');};
function config(env,signature=false){
 if(env.STRIPE_MODE!=='test'||!id(env.STRIPE_ORGANIZATION_ID)||!ext(env.STRIPE_ACCOUNT_ID,'acct'))throw 503;
 if(signature&&!(typeof env.STRIPE_WEBHOOK_SECRET==='string'&&/^whsec_[a-zA-Z0-9_]{16,256}$/.test(env.STRIPE_WEBHOOK_SECRET)))throw 503;
 return {org:env.STRIPE_ORGANIZATION_ID,account:env.STRIPE_ACCOUNT_ID};
}
function sameConfig(env,c){const now=config(env);if(now.org!==c.org||now.account!==c.account)throw 503;}
function query(url,allowed=[]){const seen=new Set();for(const key of url.searchParams.keys()){if(!allowed.includes(key)||seen.has(key))throw 400;seen.add(key);}}
function empty(body){if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)throw 400;}
function canonical(v,depth=0){if(depth>30)throw 400;if(Array.isArray(v))return v.map(x=>canonical(x,depth+1));if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k],depth+1)]));return v;}
async function signedBody(request,env){
 const signature=request.headers.get('stripe-signature');if(!signature||signature.length>4096||!request.headers.get('content-type')?.startsWith('application/json'))throw 400;
 const timestamps=[],candidates=[];for(const part of signature.split(',')){const [key,...rest]=part.trim().split('='),value=rest.join('=');if(key==='t')timestamps.push(value);if(key==='v1')candidates.push(value);}
 if(timestamps.length!==1||!/^\d{1,12}$/.test(timestamps[0])||!candidates.length||candidates.length>10||candidates.some(v=>!/^([a-fA-F0-9]{2}){32}$/.test(v)))throw 400;
 const timestamp=Number(timestamps[0]);if(!Number.isSafeInteger(timestamp)||Math.abs(Math.floor(Date.now()/1000)-timestamp)>300)throw 400;
 if(Number(request.headers.get('content-length'))>65536)throw 413;const reader=request.body?.getReader();if(!reader)throw 400;const chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw 413;}chunks.push(value);}
 const prefix=bytes(timestamps[0]+'.'),message=new Uint8Array(prefix.length+size),raw=new Uint8Array(size);message.set(prefix);let pos=0;for(const chunk of chunks){raw.set(chunk,pos);message.set(chunk,prefix.length+pos);pos+=chunk.length;}
 const key=await crypto.subtle.importKey('raw',bytes(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);let verified=false;
 for(const candidate of candidates)verified=await crypto.subtle.verify('HMAC',key,Uint8Array.from(candidate.match(/../g),v=>parseInt(v,16)),message)||verified;
 if(!verified)throw 400;try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw 400;}
}
const invoiceTypes=new Set(['invoice.created','invoice.updated','invoice.finalized','invoice.finalization_failed','invoice.paid','invoice.payment_failed','invoice.payment_succeeded','invoice.payment_action_required','invoice.payment_attempt_required','invoice.marked_uncollectible','invoice.voided','invoice.deleted','invoice.overdue','invoice.overpaid','invoice.sent']);
function target(event){
 const object=event.data?.object;if(!object||typeof object!=='object')throw 400;
 const kind=invoiceTypes.has(event.type)?'invoice':event.type==='invoice_payment.paid'?'invoice_payment':['credit_note.created','credit_note.updated','credit_note.voided'].includes(event.type)?'credit_note':['refund.created','refund.updated','refund.failed','charge.refund.updated'].includes(event.type)?'refund':event.type==='charge.refunded'?'charge':null;
 if(!kind)return null;const prefix={invoice:'in',invoice_payment:'inpay',credit_note:'cn',refund:'re',charge:'ch'}[kind];if(object.object!==kind||!ext(object.id,prefix))throw 400;return {kind,id:object.id};
}
export async function stripeWebhook(request,env,json,fetcher=fetch,ctx){
 const url=new URL(request.url);query(url);if(request.method!=='POST')throw 405;const c=config(env,true),event=await signedBody(request,env);
 if(!event||event.object!=='event'||!ext(event.id,'evt')||event.livemode!==false||!money(event.created)||typeof event.type!=='string'||event.type.length>100||event.account!=null&&event.account!==c.account||event.context!=null&&event.context!==c.account||event.api_version!=null&&(typeof event.api_version!=='string'||event.api_version.length>100))throw 400;
 const resource=target(event);if(!resource)return json({received:true},200);
 if(resource.kind==='invoice'&&event.data.object.customer!=null){const known=await env.DB.prepare('SELECT customer_id FROM stripe_invoice_operations WHERE organization_id=? AND account_id=? AND stripe_invoice_id=? UNION ALL SELECT customer_id FROM stripe_part_operations WHERE organization_id=? AND account_id=? AND stripe_invoice_id=? LIMIT 1').bind(c.org,c.account,resource.id,c.org,c.account,resource.id).first();if(known&&event.data.object.customer!==known.customer_id)throw 400;}
 const hash=await digest(JSON.stringify(canonical(event))),now=Date.now();sameConfig(env,c);
 const sendEvidence=event.type==='invoice.sent'?JSON.stringify({requestId:event.request?.id??null,requestKey:event.request?.idempotency_key??null,customerId:event.data.object.customer,primaryEmail:event.data.object.customer_email??null,livemode:event.data.object.livemode,metadata:event.data.object.metadata??null}):null;
 if(sendEvidence!==null&&(new TextEncoder().encode(sendEvidence).length>16384||event.request!=null&&(typeof event.request!=='object'||event.request.id!=null&&(typeof event.request.id!=='string'||event.request.id.length>255)||event.request.idempotency_key!=null&&(typeof event.request.idempotency_key!=='string'||event.request.idempotency_key.length>255))))throw 400;
 await env.DB.prepare("INSERT INTO stripe_event_inbox(id,organization_id,account_id,event_id,event_type,target_kind,target_id,content_hash,api_version,stripe_created_at,received_at,updated_at,send_evidence_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,event_id) DO NOTHING")
  .bind(crypto.randomUUID(),c.org,c.account,event.id,event.type,resource.kind,resource.id,hash,event.api_version??null,event.created,now,now,sendEvidence).run();
 const row=await env.DB.prepare('SELECT * FROM stripe_event_inbox WHERE organization_id=? AND account_id=? AND event_id=?').bind(c.org,c.account,event.id).first();if(!row)throw 500;if(row.content_hash!==hash)throw 409;
 if(ctx?.waitUntil&&!['APPLIED','IGNORED','REVIEW_REQUIRED'].includes(row.state))ctx.waitUntil(processEvent(env,fetcher,row.id,'WEBHOOK').catch(()=>{}));
 return json({received:true},202);
}
function reader(env,fetcher){let count=0;const limited=async(...args)=>{if(++count>100)throw new SyncError('READ_LIMIT');return fetcher(...args);};return {
 async get(path){try{return await stripeProviderRead(env,limited,path);}catch(e){if(count>100)throw new SyncError('READ_LIMIT');if(e.code==='PROVIDER_MISMATCH')mismatch();if(e.httpStatus===404)throw new SyncError('PROVIDER_NOT_FOUND');throw new SyncError('PROVIDER_UNAVAILABLE',503);}},
 async lines(invoiceId,limit){try{return await stripeInvoiceLines(env,limited,invoiceId,limit);}catch(e){if(count>100)throw new SyncError('READ_LIMIT');if(e.code==='PROVIDER_MISMATCH')mismatch();throw new SyncError('PROVIDER_UNAVAILABLE',503);}},
 };
}
async function list(read,path,prefix,limit=1000){
 const result=[],seen=new Set();let cursor=null;do{const page=await read.get(path+(path.includes('?')?'&':'?')+'limit=100'+(cursor?'&starting_after='+encodeURIComponent(cursor):''));
  if(page.object!=='list'||!Array.isArray(page.data)||typeof page.has_more!=='boolean'||page.has_more&&!page.data.length)mismatch();
  for(const row of page.data){if(!ext(row.id,prefix)||seen.has(row.id))mismatch();seen.add(row.id);result.push(row);if(result.length>limit)throw new SyncError('READ_LIMIT');}cursor=page.has_more?page.data.at(-1).id:null;
 }while(cursor);return result;
}
async function account(read,c){const row=await read.get('account');if(row.object!=='account'||row.id!==c.account)mismatch();}
const opSelect=`SELECT o.*,i.client_id,i.project_id,i.snapshot_json AS invoice_snapshot_json,i.preview_fingerprint AS invoice_fingerprint,i.currency AS invoice_currency,i.total_minor AS invoice_total,i.title AS invoice_title,i.status AS local_status,i.released_at,i.stripe_invoice_id AS local_stripe_id,m.client_id AS mapping_client,m.account_id AS mapping_account,m.customer_id AS mapping_customer FROM stripe_invoice_operations o JOIN invoice_drafts i ON i.id=o.invoice_id AND i.organization_id=o.organization_id JOIN stripe_customer_links m ON m.id=o.mapping_id AND m.organization_id=o.organization_id`;
async function opFor(env,c,invoiceId,native=false){return env.DB.prepare(opSelect+' WHERE o.organization_id=? AND o.account_id=? AND '+(native?'o.stripe_invoice_id':'o.invoice_id')+'=?').bind(c.org,c.account,invoiceId).first();}
async function validateOp(op){
 if(!op)throw 404;if(op.state!=='DONE'||op.stage!=='DONE'||!ext(op.stripe_invoice_id,'in'))throw new SyncError('CREATION_INCOMPLETE');
 const plan=JSON.parse(op.plan_json),{fingerprint,...original}=plan;
 if(fingerprint!==await digest(JSON.stringify(original))||plan.invoiceId!==op.invoice_id||plan.accountId!==op.account_id||plan.mappingId!==op.mapping_id||plan.customer.id!==op.customer_id||plan.client.id!==op.client_id||plan.currency!==op.invoice_currency||plan.totalMinor!==op.invoice_total||plan.title!==op.invoice_title||plan.sourceFingerprint!==op.invoice_fingerprint||op.mapping_client!==op.client_id||op.mapping_account!==op.account_id||op.mapping_customer!==op.customer_id||op.local_status!=='DRAFT'||op.released_at!==null||op.local_stripe_id!==op.stripe_invoice_id)mismatch();return plan;
}
export async function stripeCreationProof(env,actor,invoiceId){const c=config(env);if(actor.organization_id!==c.org)throw 404;const op=await opFor(env,c,invoiceId),plan=await validateOp(op);return {op,plan};}
export async function observeStripeInvoice(env,fetcher,actor,invoiceId){const {op}=await stripeCreationProof(env,actor,invoiceId);return observe(env,fetcher,op,{actor});}
function invoiceIdentity(value,op,plan){
 if(value.id!==op.stripe_invoice_id||value.object!=='invoice'||value.livemode!==false||value.customer!==op.customer_id||value.currency!==plan.currency.toLowerCase()||value.description!==plan.title||value.metadata?.ashbi_invoice!==op.invoice_id||value.metadata?.ashbi_operation!==op.id||value.metadata?.ashbi_plan!==plan.fingerprint||value.due_date!==plan.dueAt||value.collection_method!=='send_invoice'||typeof value.auto_advance!=='boolean'||value.on_behalf_of!=null||value.issuer&&value.issuer.type!=='self'||value.amount_shipping!==0||value.automatic_tax?.enabled!==false||!Array.isArray(value.discounts)||value.discounts.length||!Array.isArray(value.default_tax_rates)||value.default_tax_rates.length)mismatch();
 if(!['draft','open','paid','void','uncollectible'].includes(value.status)||!Number.isSafeInteger(value.starting_balance))mismatch();for(const key of ['amount_due','amount_paid','amount_remaining','amount_overpaid','pre_payment_credit_notes_amount','post_payment_credit_notes_amount'])if(!money(value[key]))mismatch();
 if(value.pre_payment_credit_notes_amount+value.post_payment_credit_notes_amount>plan.totalMinor||value.amount_remaining>value.amount_due||value.status==='paid'&&value.amount_remaining!==0||value.status==='void'&&value.amount_remaining!==0)mismatch();
 const transitions=value.status_transitions;if(!transitions||Object.values(transitions).some(v=>v!==null&&!money(v))||value.status!=='draft'&&!money(transitions.finalized_at))mismatch();
}
export {invoiceIdentity as stripeInvoiceIdentity};
function hosted(value,pdf=false){if(value===null||value===undefined)return null;if(typeof value!=='string'||value.length>4096)return null;try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port)return null;if(pdf?u.hostname==='pay.stripe.com'&&u.pathname.startsWith('/invoice/')&&u.pathname.endsWith('/pdf'):(u.hostname==='invoice.stripe.com'&&u.pathname.startsWith('/i/')||u.hostname==='pay.stripe.com'&&u.pathname.startsWith('/invoice/')))return value;}catch{}return null;}
function checkedSum(values){let total=0n;for(const value of values){if(!money(value))mismatch();total+=BigInt(value);}if(total>BigInt(Number.MAX_SAFE_INTEGER))mismatch();return Number(total);}
function paymentRow(row,op,plan){
 if(row.object!=='invoice_payment'||row.invoice!==op.stripe_invoice_id||row.currency!==plan.currency.toLowerCase()||row.livemode!==false||!['paid','open','canceled'].includes(row.status)||!money(row.amount_requested)||row.status==='paid'&&!money(row.amount_paid)||row.status!=='paid'&&row.amount_paid!==null&&row.amount_paid!==0)mismatch();
 const type=row.payment?.type,reference=row.payment?.[type];if(!['payment_intent','charge','payment_record'].includes(type)||!opaque(reference)||type==='payment_intent'&&!ext(reference,'pi')||type==='charge'&&!ext(reference,'ch'))mismatch();
 return {id:row.id,status:row.status,amountMinor:row.status==='paid'?row.amount_paid:0,requestedMinor:row.amount_requested,type,reference};
}
async function settlement(read,value,op,plan){
 const currency=plan.currency.toLowerCase(),rawPayments=await list(read,'invoice_payments?invoice='+op.stripe_invoice_id,'inpay'),payments=rawPayments.map(row=>paymentRow(row,op,plan)),refunds=new Map(),allocations=new Map(),references=new Map(),credits=[];let allocationComplete=true;
 const recorded=checkedSum(payments.map(p=>p.amountMinor));if(recorded>value.amount_paid)mismatch();
 function refund(row,ref,type){
  if(row.object!=='refund'||!ext(row.id,'re')||row.currency!==currency||row.livemode!=null&&row.livemode!==false||!money(row.amount)||!['succeeded','pending','requires_action','failed','canceled'].includes(row.status)||type==='payment_intent'&&row.payment_intent!==ref||type==='charge'&&row.charge!==ref||row.customer!=null&&row.customer!==op.customer_id)mismatch();
  const previous=refunds.get(row.id),image={id:row.id,amountMinor:row.amount,status:row.status};if(previous&&JSON.stringify(previous)!==JSON.stringify(image))mismatch();refunds.set(row.id,image);
 }
 for(const p of payments){if(p.status!=='paid'||references.has(p.reference))continue;references.set(p.reference,p.type);if(p.type==='payment_record')continue;
  const path=p.type==='payment_intent'?'payment_intents/':'charges/',remote=await read.get(path+p.reference);if(remote.id!==p.reference||remote.object!==p.type||remote.livemode!==false||remote.customer!==op.customer_id||remote.currency!==currency)mismatch();const received=p.type==='payment_intent'?remote.amount_received:remote.amount;if(!money(received)||checkedSum(payments.filter(v=>v.reference===p.reference).map(v=>v.amountMinor))>received)mismatch();
  const rows=await list(read,'refunds?'+(p.type==='payment_intent'?'payment_intent':'charge')+'='+p.reference,'re');for(const row of rows)refund(row,p.reference,p.type);if(checkedSum(rows.filter(r=>r.status==='succeeded').map(r=>r.amount))>received)mismatch();
  if(rows.length){if(p.type==='payment_intent'){const related=await list(read,'invoice_payments?payment%5Btype%5D=payment_intent&payment%5Bpayment_intent%5D='+p.reference,'inpay');if(!related.length||related.some(r=>r.object!=='invoice_payment'||r.livemode!==false||r.currency!==currency||r.payment?.type!=='payment_intent'||r.payment.payment_intent!==p.reference))mismatch();if(related.some(r=>r.invoice!==op.stripe_invoice_id&&r.status==='paid'&&r.amount_paid>0))allocationComplete=false;}else allocationComplete=false;}
 }
 for(const note of await list(read,'credit_notes?invoice='+op.stripe_invoice_id,'cn')){
  if(note.object!=='credit_note'||note.invoice!==op.stripe_invoice_id||note.customer!==op.customer_id||note.currency!==currency||note.livemode!==false||!['issued','void'].includes(note.status)||!money(note.amount)||!money(note.pre_payment_amount)||!money(note.post_payment_amount)||note.amount!==note.pre_payment_amount+note.post_payment_amount||!Array.isArray(note.refunds)||note.refunds.length>1000)mismatch();
  const row={id:note.id,status:note.status,amountMinor:note.amount,preMinor:note.pre_payment_amount,postMinor:note.post_payment_amount,refundAllocatedMinor:0,reportedExternalRefundMinor:0,outOfBandMinor:note.out_of_band_amount??0,balanceCreditMinor:0};if(!money(row.outOfBandMinor))mismatch();
  if(note.status==='issued'){
   for(const allocation of note.refunds){if(!money(allocation.amount_refunded))mismatch();if(allocation.type==='payment_record_refund'){if(!opaque(allocation.payment_record_refund?.payment_record)||!opaque(allocation.payment_record_refund?.refund_group))mismatch();row.reportedExternalRefundMinor+=allocation.amount_refunded;continue;}
    if(allocation.type!=null&&allocation.type!=='refund'||!ext(allocation.refund,'re'))mismatch();let r=refunds.get(allocation.refund);if(!r){const remote=await read.get('refunds/'+allocation.refund),type=references.get(remote.payment_intent)||references.get(remote.charge),ref=type==='payment_intent'?remote.payment_intent:remote.charge;if(!type||type==='payment_record')mismatch();refund(remote,ref,type);r=refunds.get(allocation.refund);}const total=(allocations.get(r.id)||0)+allocation.amount_refunded;if(total>r.amountMinor)mismatch();allocations.set(r.id,total);row.refundAllocatedMinor+=allocation.amount_refunded;
   }
   row.balanceCreditMinor=row.postMinor-row.refundAllocatedMinor-row.reportedExternalRefundMinor-row.outOfBandMinor;if(!money(row.balanceCreditMinor))mismatch();
   if(row.balanceCreditMinor){if(!ext(note.customer_balance_transaction,'cbtxn'))mismatch();const balance=await read.get('customers/'+op.customer_id+'/balance_transactions/'+note.customer_balance_transaction);if(balance.id!==note.customer_balance_transaction||balance.object!=='customer_balance_transaction'||balance.customer!==op.customer_id||balance.currency!==currency||balance.type!=='credit_note'||balance.credit_note!==note.id||balance.amount!==-row.balanceCreditMinor)mismatch();}
  }credits.push(row);
 }
 const issued=credits.filter(c=>c.status==='issued'),pre=checkedSum(issued.map(c=>c.preMinor)),post=checkedSum(issued.map(c=>c.postMinor));if(pre!==value.pre_payment_credit_notes_amount||post!==value.post_payment_credit_notes_amount)mismatch();
 const refundRows=[...refunds.values()],sumStatus=statuses=>checkedSum(refundRows.filter(r=>statuses.includes(r.status)).map(r=>r.amountMinor));
 return {payments,credits,refunds:refundRows,recordedPaymentMinor:recorded,unallocatedPaidMinor:value.amount_paid-recorded,preCreditMinor:pre,postCreditMinor:post,balanceCreditMinor:checkedSum(issued.map(c=>c.balanceCreditMinor)),outOfBandCreditMinor:checkedSum(issued.map(c=>c.outOfBandMinor)),creditRefundAllocatedMinor:checkedSum(issued.map(c=>c.refundAllocatedMinor)),reportedExternalRefundMinor:checkedSum(issued.map(c=>c.reportedExternalRefundMinor)),refundAllocationComplete:allocationComplete,refundedMinor:allocationComplete?sumStatus(['succeeded']):null,pendingRefundMinor:allocationComplete?sumStatus(['pending','requires_action']):null,failedRefundMinor:allocationComplete?sumStatus(['failed']):null,canceledRefundMinor:allocationComplete?sumStatus(['canceled']):null};
}
async function image(env,fetcher,c,op,plan,{partId=null,scheduleId=null}={}){
 const read=reader(env,fetcher);await account(read,c);const customer=await read.get('customers/'+op.customer_id);if(customer.object!=='customer'||customer.id!==op.customer_id||customer.livemode!==false||customer.deleted)mismatch();
 const value=await read.get('invoices/'+op.stripe_invoice_id);invoiceIdentity(value,op,plan);const lines=await read.lines(op.stripe_invoice_id,plan.lines.length);if(!stripeInvoiceContentsMatch(value,lines,op,plan))mismatch();if(partId&&(value.metadata?.ashbi_schedule!==scheduleId||value.metadata?.ashbi_part!==partId||lines.some(row=>row.metadata?.ashbi_invoice!==op.invoice_id||row.metadata?.ashbi_plan!==plan.fingerprint||row.metadata?.ashbi_schedule!==scheduleId||row.metadata?.ashbi_part!==partId)))mismatch();const paid=await settlement(read,value,op,plan),link=hosted(value.hosted_invoice_url),pdf=hosted(value.invoice_pdf,true);
 return {version:1,invoiceId:op.invoice_id,stripeInvoiceId:op.stripe_invoice_id,title:plan.title,client:{id:plan.client.id,name:plan.client.name},currency:plan.currency,status:value.status,totalMinor:plan.totalMinor,subtotalMinor:plan.subtotalMinor,taxMinor:plan.taxMinor,dueAt:value.due_date,paidMinor:value.amount_paid,dueMinor:value.amount_due,remainingMinor:value.amount_remaining,overpaidMinor:value.amount_overpaid,startingBalanceMinor:value.starting_balance,finalizedAt:value.status_transitions.finalized_at??null,paidAt:value.status_transitions.paid_at??null,voidedAt:value.status_transitions.voided_at??null,uncollectibleAt:value.status_transitions.marked_uncollectible_at??null,autoAdvance:value.auto_advance,hostedInvoiceUrl:link,invoicePdf:pdf,linkIssue:Boolean(value.hosted_invoice_url&&!link||value.invoice_pdf&&!pdf),lines:plan.lines.map(l=>({description:l.description,amountMinor:l.amountMinor,taxMinor:l.taxMinor})),...paid};
}
const currentOp=`EXISTS(SELECT 1 FROM stripe_invoice_operations o JOIN invoice_drafts i ON i.id=o.invoice_id AND i.organization_id=o.organization_id JOIN stripe_customer_links m ON m.id=o.mapping_id AND m.organization_id=o.organization_id WHERE o.id=? AND o.organization_id=? AND o.state='DONE' AND o.stage='DONE' AND o.account_id=? AND o.stripe_invoice_id=? AND o.plan_json=? AND i.snapshot_json=? AND i.status='DRAFT' AND i.released_at IS NULL AND i.stripe_invoice_id=o.stripe_invoice_id AND i.client_id=m.client_id AND m.customer_id=o.customer_id AND m.account_id=o.account_id AND i.client_id=? AND i.project_id IS ? AND i.currency=? AND i.total_minor=? AND i.title=? AND i.preview_fingerprint=?)`;
const opValues=op=>[op.id,op.organization_id,op.account_id,op.stripe_invoice_id,op.plan_json,op.invoice_snapshot_json,op.client_id,op.project_id,op.invoice_currency,op.invoice_total,op.invoice_title,op.invoice_fingerprint];
async function observe(env,fetcher,op,{actor=null,inbox=null,source='STAFF'}={}){
 const c=config(env),db=env.DB,plan=await validateOp(op);if(op.organization_id!==c.org||op.account_id!==c.account)throw 404;if(actor&&!await hasFinance(db,actor))throw 403;
 if(inbox){const done=await db.prepare('SELECT id FROM stripe_lifecycle_events WHERE inbox_id=? AND invoice_id=? AND organization_id=?').bind(inbox.id,op.invoice_id,c.org).first();if(done)return;}
 const guard=currentOp+(actor?' AND '+authority:''),guards=[...opValues(op),...(actor?[actor.id,c.org]:[])];
 await db.prepare(`INSERT INTO stripe_invoice_projection(invoice_id,organization_id,operation_id,account_id,stripe_invoice_id) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(invoice_id,organization_id) DO NOTHING`).bind(op.invoice_id,c.org,op.id,c.account,op.stripe_invoice_id,...guards).run();
 const lease=crypto.randomUUID(),claimed=await db.prepare(`UPDATE stripe_invoice_projection SET lease_token=?,lease_until=? WHERE invoice_id=? AND organization_id=? AND operation_id=? AND stripe_invoice_id=? AND lease_until<=${clock} AND ${guard} RETURNING *`).bind(lease,Date.now()+leaseMs,op.invoice_id,c.org,op.id,op.stripe_invoice_id,...guards).first();
 if(!claimed){if(actor&&!await hasFinance(db,actor))throw 403;throw 409;}
 try{
  const snapshot=await image(env,fetcher,c,op,plan),serialized=JSON.stringify(snapshot);if(claimed.snapshot_json){const previous=JSON.parse(claimed.snapshot_json);if(['paid','void'].includes(previous.status)&&snapshot.status!==previous.status||previous.status!=='draft'&&snapshot.status==='draft')throw new SyncError('STATE_REGRESSION');}if(serialized.length>262144)throw new SyncError('READ_LIMIT');sameConfig(env,c);const token=crypto.randomUUID(),now=Date.now(),eventGuard=inbox?` AND EXISTS(SELECT 1 FROM stripe_event_inbox WHERE id=? AND organization_id=? AND account_id=? AND lease_token=? AND lease_until>${clock} AND state='PROCESSING')`:'',eventValues=inbox?[inbox.id,c.org,c.account,inbox.lease_token]:[];
  const updated=db.prepare(`UPDATE stripe_invoice_projection SET snapshot_json=?,observed_at=?,revision=revision+1,write_token=?,last_error=NULL,last_attempt_at=? WHERE invoice_id=? AND organization_id=? AND lease_token=? AND lease_until>${clock} AND ${guard}${eventGuard} RETURNING invoice_id`).bind(serialized,now,token,now,op.invoice_id,c.org,lease,...guards,...eventValues);
  const journal=db.prepare(`INSERT INTO stripe_lifecycle_events(id,organization_id,invoice_id,account_id,inbox_id,actor_id,revision,observed_at,source,snapshot_json) SELECT ?,organization_id,invoice_id,account_id,?,?,revision,observed_at,?,snapshot_json FROM stripe_invoice_projection WHERE invoice_id=? AND organization_id=? AND write_token=? RETURNING id`).bind(token,inbox?.id??null,actor?.id??null,source,op.invoice_id,c.org,token);
  const fence=db.prepare(`UPDATE stripe_invoice_projection SET write_token=CASE WHEN EXISTS(SELECT 1 FROM stripe_lifecycle_events e WHERE e.id=? AND e.organization_id=stripe_invoice_projection.organization_id AND e.invoice_id=stripe_invoice_projection.invoice_id AND e.revision=stripe_invoice_projection.revision AND e.snapshot_json=stripe_invoice_projection.snapshot_json) THEN write_token ELSE NULL END WHERE invoice_id=? AND organization_id=? AND write_token=? RETURNING invoice_id`).bind(token,op.invoice_id,c.org,token);
  const results=await db.batch([updated,journal,fence]);if(!results[0].results.length){if(actor&&!await hasFinance(db,actor))throw 403;throw 409;}if(!results[1].results.length||!results[2].results.length)throw 500;return snapshot;
 }catch(e){if(!actor||await hasFinance(db,actor))await db.prepare('UPDATE stripe_invoice_projection SET last_error=?,last_attempt_at=? WHERE invoice_id=? AND organization_id=? AND lease_token=?').bind(e instanceof SyncError?e.code:typeof e==='number'?'CONFLICT':'PERSISTENCE',Date.now(),op.invoice_id,c.org,lease).run();throw e;
 }finally{await db.prepare('UPDATE stripe_invoice_projection SET lease_token=NULL,lease_until=0 WHERE invoice_id=? AND organization_id=? AND lease_token=?').bind(op.invoice_id,c.org,lease).run();}
}
async function eventInvoices(env,fetcher,c,row){
 const read=reader(env,fetcher);await account(read,c);if(row.target_kind==='invoice')return [row.target_id];
 const paths={invoice_payment:'invoice_payments/',credit_note:'credit_notes/',refund:'refunds/',charge:'charges/'},resource=await read.get(paths[row.target_kind]+row.target_id);if(resource.id!==row.target_id||resource.object!==row.target_kind||resource.livemode!=null&&resource.livemode!==false)mismatch();
 if(['credit_note','invoice_payment'].includes(row.target_kind)){if(!ext(resource.invoice,'in'))mismatch();return [resource.invoice];}
 const pi=resource.payment_intent;if(ext(pi,'pi')){const rows=await list(read,'invoice_payments?payment%5Btype%5D=payment_intent&payment%5Bpayment_intent%5D='+pi,'inpay');if(rows.some(p=>p.object!=='invoice_payment'||p.livemode!==false||p.payment?.type!=='payment_intent'||p.payment.payment_intent!==pi||!ext(p.invoice,'in')))mismatch();return [...new Set(rows.map(p=>p.invoice))];}
 // Legacy charges without an intent have no documented charge filter on Invoice Payments.
 // Search the existing scoped observations; never scan unrelated customer payment data.
 const known=await env.DB.prepare('SELECT snapshot_json,stripe_invoice_id FROM stripe_invoice_projection WHERE organization_id=? AND account_id=? AND snapshot_json IS NOT NULL UNION ALL SELECT snapshot_json,stripe_invoice_id FROM stripe_part_projection WHERE organization_id=? AND account_id=? AND snapshot_json IS NOT NULL LIMIT 1001').bind(c.org,c.account,c.org,c.account).all();if(known.results.length>1000)throw new SyncError('READ_LIMIT');const charge=row.target_kind==='charge'?resource.id:resource.charge;
 return known.results.filter(p=>JSON.parse(p.snapshot_json).payments.some(v=>v.type==='charge'&&v.reference===charge)).map(p=>p.stripe_invoice_id);
}
async function processEvent(env,fetcher,inboxId,source,actor=null,force=false){
 const c=config(env),db=env.DB;if(actor&&(actor.organization_id!==c.org||!await hasFinance(db,actor)))throw 403;const lease=crypto.randomUUID();
 const row=await db.prepare(`UPDATE stripe_event_inbox SET state='PROCESSING',lease_token=?,lease_until=?,attempts=attempts+1,next_attempt_at=0,updated_at=? WHERE id=? AND organization_id=? AND account_id=? AND state IN ('PENDING','RETRY','PROCESSING'${force?",'REVIEW_REQUIRED'":''}) AND lease_until<=${clock}${force?'':` AND next_attempt_at<=${clock}`} ${actor?'AND '+authority:''} RETURNING *`).bind(lease,Date.now()+leaseMs,Date.now(),inboxId,c.org,c.account,...(actor?[actor.id,c.org]:[])).first();if(!row)return;
 try{
  const delivery=await observeInvoiceDeliverySent(env,row);
  const invoices=await eventInvoices(env,fetcher,c,row),owned=[],ownedParts=[];for(const nativeId of invoices){const child=await observeStripePartNative(env,fetcher,nativeId,{actor,inbox:row,source});if(child){ownedParts.push(child.partId);continue;}let op=await opFor(env,c,nativeId,true);if(!op){
    const read=reader(env,fetcher);let remote;try{remote=await read.get('invoices/'+nativeId);}catch(e){if(e.code==='PROVIDER_NOT_FOUND')continue;throw e;}
    if(remote.object!=='invoice'||remote.id!==nativeId||remote.livemode!==false)mismatch();const pendingChild=await observeStripePartNative(env,fetcher,nativeId,{actor,inbox:row,source,remote});if(pendingChild){ownedParts.push(pendingChild.partId);continue;}const operationId=remote.metadata?.ashbi_operation,invoiceId=remote.metadata?.ashbi_invoice;
    if(id(invoiceId)&&id(operationId)){const pending=await opFor(env,c,invoiceId);if(pending?.id===operationId){const plan=JSON.parse(pending.plan_json);if(remote.customer!==pending.customer_id||remote.metadata.ashbi_plan!==plan.fingerprint)mismatch();if(pending.state!=='DONE')throw new SyncError('CREATION_INCOMPLETE');mismatch();}}
    continue;
   }owned.push(op.invoice_id);await observe(env,fetcher,op,{actor,inbox:row,source});}
  const childProofs=[];for(const partId of ownedParts)childProofs.push(await stripePartInboxProof(env,partId,row.id,actor));
  sameConfig(env,c);const partRequired=ownedParts.length?` AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM stripe_part_lifecycle_events e WHERE e.inbox_id=stripe_event_inbox.id AND e.organization_id=stripe_event_inbox.organization_id AND e.part_id=expected.value))`:'';const required=owned.length?` AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM stripe_lifecycle_events e WHERE e.inbox_id=stripe_event_inbox.id AND e.organization_id=stripe_event_inbox.organization_id AND e.invoice_id=expected.value))`:'';
  const terminal=db.prepare(`UPDATE stripe_event_inbox SET state=?,invoice_id=?,last_error=NULL,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND organization_id=? AND lease_token=? AND lease_until>${clock}${childProofs.length?" AND state='PROCESSING'":''}${required}${partRequired}${actor?' AND '+authority:''} RETURNING id`).bind(owned.length||ownedParts.length?'APPLIED':'IGNORED',owned.length===1&&!ownedParts.length?owned[0]:null,Date.now(),row.id,c.org,lease,...(owned.length?[JSON.stringify(owned)]:[]),...(ownedParts.length?[JSON.stringify(ownedParts)]:[]),...(actor?[actor.id,c.org]:[]));
  const deliveryProofs=delivery?deliveryInboxProof(delivery):[];
  if(childProofs.length||deliveryProofs.length){
   // Each owner proof stays below D1's per-statement parameter bound. The
   // NOT NULL fence and terminal transition share one atomic batch snapshot.
   const checks=[...childProofs,...deliveryProofs].map(proof=>db.prepare(`UPDATE stripe_event_inbox SET content_hash=CASE WHEN (${proof.sql}) THEN content_hash ELSE NULL END WHERE id=? AND organization_id=? AND lease_token=? AND state='PROCESSING' AND lease_until>${clock} RETURNING id`).bind(...proof.args,row.id,c.org,lease));
   let results;try{results=await db.batch([...checks,terminal]);}catch{if(actor&&!await hasFinance(db,actor))throw 403;throw 409;}
   if(results.some(result=>!result.results.length))throw 409;
  }else if(!await terminal.first())throw 409;
 }catch(e){const code=e.code??(typeof e==='number'?'CONFLICT':'PERSISTENCE'),review=Boolean(e.code&&e.status!==503&&e.code!=='CREATION_INCOMPLETE');await db.prepare(`UPDATE stripe_event_inbox SET state=?,last_error=?,next_attempt_at=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND organization_id=? AND lease_token=?`).bind(review?'REVIEW_REQUIRED':'RETRY',code,Date.now()+Math.min(3600000,30000*2**Math.min(row.attempts-1,7)),Date.now(),row.id,c.org,lease).run();if(actor)throw e;
 }
}
export async function drainStripeEvents(env,fetcher=fetch,ctx){
 let c;try{c=config(env);}catch{return;}const rows=await env.DB.prepare(`SELECT id FROM stripe_event_inbox WHERE organization_id=? AND account_id=? AND state IN ('PENDING','RETRY','PROCESSING') AND lease_until<=${clock} AND next_attempt_at<=${clock} ORDER BY received_at,id LIMIT 20`).bind(c.org,c.account).all();
 const work=(async()=>{for(const row of rows.results)try{await processEvent(env,fetcher,row.id,'SCHEDULED');}catch{}})();if(ctx?.waitUntil)ctx.waitUntil(work);else await work;
}

const readFrom=`FROM stripe_invoice_projection p JOIN invoice_drafts i ON i.id=p.invoice_id AND i.organization_id=p.organization_id JOIN stripe_invoice_operations o ON o.id=p.operation_id AND o.organization_id=p.organization_id JOIN stripe_customer_links m ON m.id=o.mapping_id AND m.organization_id=o.organization_id`;
const readIntegrity="p.snapshot_json IS NOT NULL AND o.state='DONE' AND o.account_id=p.account_id AND o.stripe_invoice_id=p.stripe_invoice_id AND i.stripe_invoice_id=p.stripe_invoice_id AND i.client_id=m.client_id AND m.customer_id=o.customer_id AND m.account_id=o.account_id AND i.status='DRAFT' AND i.released_at IS NULL AND json_extract(p.snapshot_json,'$.invoiceId')=i.id AND json_extract(p.snapshot_json,'$.client.id')=i.client_id AND json_extract(p.snapshot_json,'$.currency')=i.currency AND json_extract(p.snapshot_json,'$.totalMinor')=i.total_minor AND json_extract(i.snapshot_json,'$.client.id')=i.client_id AND json_extract(i.snapshot_json,'$.project.id') IS i.project_id";
const clientScope=`EXISTS(SELECT 1 FROM actors a WHERE a.id=? AND a.organization_id=p.organization_id AND a.active=1 AND a.role='client' AND a.client_id=i.client_id) AND json_extract(p.snapshot_json,'$.status') IN ('open','paid','void','uncollectible') AND json_extract(p.snapshot_json,'$.finalizedAt') IS NOT NULL AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects pr WHERE pr.id=i.project_id AND pr.organization_id=i.organization_id AND pr.client_id=i.client_id AND pr.client_visible=1))`;
const selectFields='p.invoice_id,p.organization_id,p.account_id,p.stripe_invoice_id,p.revision,p.snapshot_json,p.observed_at,p.last_error,p.last_attempt_at';
function dto(row,client=false){const image=JSON.parse(row.snapshot_json);if(client&&!image.refundAllocationComplete)image.refunds=[];return {...image,revision:row.revision,observedAt:row.observed_at,syncState:row.last_error?(['PROVIDER_UNAVAILABLE','PERSISTENCE','CONFLICT','CREATION_INCOMPLETE'].includes(row.last_error)?'RETRY':'REVIEW_REQUIRED'):row.pending_sync?'SYNC_PENDING':'OBSERVED',overdue:image.status==='open'&&image.remainingMinor>0&&image.dueAt*1000<Date.now(),...(!client?{accountId:row.account_id,lastError:row.last_error,lastAttemptAt:row.last_attempt_at}:{})};}
function readStatement(env,actor,{client=false,invoiceId=null,limit=25,cursor=null,status=null,currency=null,dashboard=null,identities=false,byteGate=null}={}){
 const scope=client?clientScope:authority,values=client?[actor.id]:[actor.id,actor.organization_id],filters=[readIntegrity,'p.organization_id=?',scope],args=[actor.organization_id,...values];if(invoiceId){filters.push('p.invoice_id=?');args.push(invoiceId);}if(cursor){filters.push('p.invoice_id>?');args.push(cursor);}if(status){filters.push("json_extract(p.snapshot_json,'$.status')=?");args.push(status);}if(currency){filters.push("json_extract(p.snapshot_json,'$.currency')=?");args.push(currency);}args.push(limit);
 if(dashboard){args.pop();filters.push("json_extract(p.snapshot_json,'$.remainingMinor')>0");for(const [key,column]of [['clientId','i.client_id'],['projectId','i.project_id']])if(dashboard[key]){filters.push(column+'=?');args.push(dashboard[key]);}if(dashboard.due==='overdue'){filters.push("json_extract(p.snapshot_json,'$.dueAt') IS NOT NULL AND json_extract(p.snapshot_json,'$.dueAt')*1000<?");args.push(dashboard.now);}args.push(limit);}
 const pending=`(p.lease_until>${clock} OR EXISTS(SELECT 1 FROM stripe_event_inbox pending WHERE pending.organization_id=p.organization_id AND pending.account_id=p.account_id AND (pending.invoice_id=p.invoice_id OR (pending.target_kind='invoice' AND pending.target_id=p.stripe_invoice_id)) AND pending.state IN ('PENDING','PROCESSING','RETRY','REVIEW_REQUIRED'))) AS pending_sync`;
 const metadata=dashboard?",json_extract(i.snapshot_json,'$.project') AS dashboard_project":'';
 // A final proof returning no rows does not stop later batch statements.
 // Gate the canonical payload itself in the same SQL snapshot, including its
 // final repeated read, and never load identities outside the measured set.
 if(byteGate)filters.push('p.invoice_id IN (SELECT invoice_id FROM chosen) AND (SELECT bytes FROM read_budget)<=2097152');
 return env.DB.prepare(`${byteGate?.sql??''}SELECT ${identities?'p.invoice_id':selectFields+metadata+','+pending} ${readFrom} WHERE ${filters.join(' AND ')} ORDER BY p.invoice_id LIMIT ?`).bind(...(byteGate?.args??[]),...args);
}
async function readRows(env,actor,options={}){const statement=readStatement(env,actor,options);let rows=await statement.all();if(options.client)rows=await statement.all();return rows.results;}
// The combined dashboard defers every proof to its single final batch. Keep
// these identities light so its complete bound precedes loading any history.
export function invoiceDashboardAuthority(db,actor){return actor.role==='client'?db.prepare("SELECT 1 AS valid FROM actors WHERE id=? AND organization_id=? AND role='client' AND active=1 AND client_id=?").bind(actor.id,actor.organization_id,actor.client_id):db.prepare('SELECT 1 AS valid WHERE '+authority).bind(actor.id,actor.organization_id);}
export function fullDashboardSelection(db,actor,filters,now){return {statement:()=>readStatement({DB:db},actor,{client:actor.role==='client',status:'open',currency:filters.currency,limit:1001,dashboard:{...filters,now},identities:true}),rows:null};}
const dashboardTables=['invoice_drafts','stripe_invoice_operations','stripe_customer_links','stripe_invoice_projection','stripe_lifecycle_events'];
// Retain precisely the FULL reader's source and projection dependencies. Its
// legacy read semantics do not require private creation plans or credentials.
const dashboardFields=[
 'id,organization_id,client_id,project_id,currency,total_minor,status,released_at,stripe_invoice_id,revision,write_token',
 'id,organization_id,invoice_id,mapping_id,account_id,customer_id,state,stripe_invoice_id,revision,write_token',
 'id,organization_id,client_id,account_id,customer_id',
 'invoice_id,organization_id,operation_id,account_id,stripe_invoice_id,revision,snapshot_json,observed_at,last_error,last_attempt_at,lease_token,lease_until,write_token',
 'id,organization_id,invoice_id,account_id,inbox_id,actor_id,revision,observed_at,source,snapshot_json'
].map(columns=>columns.split(',').map(name=>({name,sql:'e.'+name})));
 dashboardFields[0].push({name:'snapshot_client_id',sql:"json_extract(e.snapshot_json,'$.client.id')"},{name:'snapshot_project',sql:"json_extract(e.snapshot_json,'$.project')"});
export async function fullDashboardSnapshot(env,actor,selected,filters,now){
 if(!selected.rows.length)return {values:[],proofs:[]};
 const db=env.DB,org=actor.organization_id,chosen=JSON.stringify(selected.rows),cte="WITH chosen AS (SELECT json_extract(value,'$.invoice_id') AS invoice_id FROM json_each(?)), mappings AS (SELECT mapping_id FROM stripe_invoice_operations WHERE organization_id=? AND invoice_id IN (SELECT invoice_id FROM chosen)) ",args=[chosen,org],scopes=dashboardTables.map((table,i)=>i===0?'e.id IN (SELECT invoice_id FROM chosen)':i===2?'e.id IN (SELECT mapping_id FROM mappings)':'e.invoice_id IN (SELECT invoice_id FROM chosen)');
 const budgetBody='SELECT (10+'+dashboardTables.map((table,i)=>{const overhead=2+dashboardFields[i].reduce((sum,field)=>sum+JSON.stringify(field.name).length+2,0),bytes=dashboardFields[i].map(field=>"length(CAST(json_quote("+(field.sql.startsWith('json_extract(')?'('+field.sql+")||''":field.sql)+") AS BLOB))").join('+');return '(SELECT COALESCE(SUM('+overhead+'+'+bytes+'),0) FROM '+table+' e WHERE e.organization_id=? AND '+scopes[i]+')';}).join('+')+') AS bytes',budgetArgs=[...args,...dashboardTables.map(()=>org)],budget=await db.prepare(cte+budgetBody).bind(...budgetArgs).first();
 const bounded=value=>Number.isSafeInteger(value)&&value>=0&&value<=2097152;if(!budget||!bounded(budget.bytes))throw {code:'DASHBOARD_INVOICE_READ_LIMIT',status:409};
 const scoped=cte.trimEnd()+', read_budget AS ('+budgetBody+') ',loaded=await db.batch([db.prepare(cte+budgetBody).bind(...budgetArgs),...dashboardTables.map((table,i)=>db.prepare(scoped+'SELECT '+dashboardFields[i].map(field=>field.sql+' AS '+field.name).join(',')+' FROM '+table+' e WHERE e.organization_id=? AND '+scopes[i]+' AND (SELECT bytes FROM read_budget)<=2097152 ORDER BY e.'+(i===3?'invoice_id':'id')).bind(...budgetArgs,org))]);
 if(!loaded[0].results[0]||!bounded(loaded[0].results[0].bytes))throw {code:'DASHBOARD_INVOICE_READ_LIMIT',status:409};
 const proofs=dashboardTables.map((table,i)=>{const rows=loaded[i+1].results,fields=dashboardFields[i],sql=cte+'SELECT 1 AS valid WHERE (SELECT COUNT(*) FROM '+table+' e WHERE e.organization_id=? AND '+scopes[i]+')=? AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM '+table+' e WHERE ('+fields.map(field=>field.sql).join(',')+') IS ('+fields.map(field=>"json_extract(expected.value,'$."+field.name+"')").join(',')+')))';return {statement:db.prepare(sql).bind(...args,org,rows.length,JSON.stringify(rows)),rows:[{valid:1}]};});
 const statement=()=>readStatement(env,actor,{client:actor.role==='client',status:'open',currency:filters.currency,limit:1001,dashboard:{...filters,now},byteGate:{sql:scoped,args:budgetArgs}}),rows=(await statement().all()).results;
 if(JSON.stringify(rows.map(row=>({invoice_id:row.invoice_id})))!==JSON.stringify(selected.rows)){await currentReader(db,actor,actor.role==='client');throw 409;}
 proofs.push({statement:statement(),rows});
 return {values:rows.map(row=>({...dto(row,actor.role==='client'),project:row.dashboard_project?JSON.parse(row.dashboard_project):null})),proofs};
}
// Dashboard shares the lifecycle's current authority, integrity and client redaction.
// The bound is for complete totals, not a page size; never call a provider here.
export async function outstandingInvoiceRows(env,actor,filters,now){
 const client=actor.role==='client';await currentReader(env.DB,actor,client);
 const rows=await readRows(env,actor,{client,status:'open',currency:filters.currency,limit:1001,dashboard:{...filters,now}});
 await currentReader(env.DB,actor,client);if(rows.length>1000)throw 409;
 return rows.map(row=>({...dto(row,client),project:row.dashboard_project?JSON.parse(row.dashboard_project):null}));
}
async function currentReader(db,actor,client){if(client){if(!await db.prepare("SELECT id FROM actors WHERE id=? AND organization_id=? AND role='client' AND active=1 AND client_id=?").bind(actor.id,actor.organization_id,actor.client_id).first())throw 403;}else if(!await hasFinance(db,actor))throw 403;}
function pagination(url){query(url,['limit','cursor','status','currency']);const limit=url.searchParams.get('limit')??'25',cursor=url.searchParams.get('cursor'),status=url.searchParams.get('status'),currency=url.searchParams.get('currency');if(!/^[1-9]\d?$/.test(limit)||Number(limit)>50||cursor!==null&&!id(cursor)||status!==null&&!['draft','open','paid','void','uncollectible'].includes(status)||currency!==null&&!['CAD','USD','EUR','GBP'].includes(currency))throw 400;return {limit:Number(limit),cursor,status,currency};}
const inboxFields='id,event_id,event_type,target_kind,target_id,invoice_id,state,attempts,next_attempt_at,last_error,received_at,updated_at';
export function lifecycleExport(db,actor,table){const fields=table==='stripe_event_inbox'?inboxFields+',organization_id,account_id,api_version,stripe_created_at':table==='stripe_invoice_projection'?selectFields+',operation_id': 'id,organization_id,invoice_id,account_id,inbox_id,actor_id,revision,observed_at,source,snapshot_json';const from=table==='stripe_invoice_projection'?table+' p':table;return db.prepare(`SELECT ${fields} FROM ${from} WHERE organization_id=? AND ${authority} ORDER BY ${table==='stripe_invoice_projection'?'invoice_id':'id'} LIMIT 1001`).bind(actor.organization_id,actor.id,actor.organization_id);}
export async function stripeLifecycleRoute(request,env,actor,readBody,json,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname,portal=path.startsWith('/api/portal/invoices');if(portal){if(actor.role!=='client')throw 403;}else if(!await hasFinance(env.DB,actor))throw 403;
 const detail=path.endsWith('/summary')?null:portal?path.match(/^\/api\/portal\/invoices\/([a-zA-Z0-9-]{1,100})$/):path.match(/^\/api\/invoices\/([a-zA-Z0-9-]{1,100})\/billing(\/reconcile)?$/),events=path.match(/^\/api\/stripe\/events(?:\/(evt_[a-zA-Z0-9_]{1,100})(\/retry)?)?$/);
 if(!detail&&!events&&!['/api/billing/invoices','/api/billing/summary','/api/portal/invoices','/api/portal/invoices/summary'].includes(path))throw 404;
 if(events){const c=config(env);if(actor.organization_id!==c.org)throw 404;query(url,events[1]?[]:['limit','cursor','state']);const row=events[1]?await env.DB.prepare(`SELECT ${inboxFields} FROM stripe_event_inbox WHERE organization_id=? AND account_id=? AND event_id=? AND ${authority}`).bind(c.org,c.account,events[1],actor.id,c.org).first():null;if(events[1]&&!row)throw 404;
  if(events[2]){if(request.method!=='POST')throw 405;empty(await readBody(request));try{await processEvent(env,fetcher,row.id,'STAFF',actor,true);}catch(e){if(e instanceof SyncError)throw e.status;throw e;}await currentReader(env.DB,actor,false);return json(await env.DB.prepare(`SELECT ${inboxFields} FROM stripe_event_inbox WHERE id=? AND organization_id=? AND ${authority}`).bind(row.id,c.org,actor.id,c.org).first());}
  if(request.method!=='GET')throw 405;if(row){await currentReader(env.DB,actor,false);return json(row);}const limit=url.searchParams.get('limit')??'25',cursor=url.searchParams.get('cursor'),state=url.searchParams.get('state');if(!/^[1-9]\d?$/.test(limit)||Number(limit)>50||cursor!==null&&!id(cursor)||state!==null&&!['PENDING','PROCESSING','RETRY','REVIEW_REQUIRED','APPLIED','IGNORED'].includes(state))throw 400;
  const rows=await env.DB.prepare(`SELECT ${inboxFields} FROM stripe_event_inbox WHERE organization_id=? AND account_id=? AND ${authority}${cursor?' AND id>?':''}${state?' AND state=?':''} ORDER BY id LIMIT ?`).bind(c.org,c.account,actor.id,c.org,...(cursor?[cursor]:[]),...(state?[state]:[]),Number(limit)+1).all();await currentReader(env.DB,actor,false);const items=rows.results.slice(0,Number(limit));return json({items,nextCursor:rows.results.length>Number(limit)?items.at(-1).id:null});
 }
 if(detail){query(url);const invoiceId=detail[1];if(detail[2]){if(portal)throw 405;if(request.method!=='POST')throw 405;empty(await readBody(request));const c=config(env);if(actor.organization_id!==c.org)throw 404;try{await observe(env,fetcher,await opFor(env,c,invoiceId),{actor});}catch(e){if(e instanceof SyncError)throw e.status;throw e;}}
  else if(request.method!=='GET')throw 405;const rows=await readRows(env,actor,{client:portal,invoiceId,limit:1});await currentReader(env.DB,actor,portal);if(!rows.length)throw 404;return json(dto(rows[0],portal));
 }
 if(request.method!=='GET')throw 405;const summary=path==='/api/billing/summary'||path==='/api/portal/invoices/summary';if(summary){query(url);const rows=await readRows(env,actor,{client:portal,limit:1001});await currentReader(env.DB,actor,portal);if(rows.length>1000)throw 409;const currencies={};for(const row of rows){const image=dto(row,portal),group=currencies[image.currency]??={invoiceCount:0,statusCounts:{},overdueCount:0};group.invoiceCount++;group.statusCounts[image.status]=(group.statusCounts[image.status]||0)+1;if(image.overdue)group.overdueCount++;for(const key of ['totalMinor','paidMinor','remainingMinor','overpaidMinor','preCreditMinor','postCreditMinor','refundedMinor','pendingRefundMinor','failedRefundMinor','balanceCreditMinor']){if(image[key]===null||group[key]===null)group[key]=null;else{const sum=BigInt(group[key]||0)+BigInt(image[key]);if(sum>BigInt(Number.MAX_SAFE_INTEGER))throw 409;group[key]=Number(sum);}}}return json({currencies});}
 const paging=pagination(url),rows=await readRows(env,actor,{client:portal,...paging,limit:paging.limit+1});await currentReader(env.DB,actor,portal);const items=rows.slice(0,paging.limit).map(r=>dto(r,portal));return json({items,nextCursor:rows.length>paging.limit?items.at(-1).invoiceId:null});
}

// Bounded authoritative reader for caller-proven identities; no FULL projection.
export {image as stripeAuthoritativeSnapshot};
