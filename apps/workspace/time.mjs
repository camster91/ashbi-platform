import {timeColumns,commitTimeWrite,timeExportStatement,publicTime,validWorkedOn,hasFinance} from './time-details.mjs';
import {invoiceExportStatement} from './invoices.mjs';
import {contractPublicationExportStatement} from './contract-publications.mjs';
import {commercialExportStatement} from './commercial.mjs';
import {reviewExportStatement} from './proposal-reviews.mjs';
import {stripeExportStatement} from './stripe-drafts.mjs';
import {lifecycleExport} from './stripe-lifecycle.mjs';
export async function timeRoute(request,db,actor,input,json){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/time')&&!path.startsWith('/api/timer/'))return null;
 if(actor.role!=='staff')throw 403;
 if(path==='/api/timer/current'){
  if(request.method!=='GET')throw 405;
  if(new URL(request.url).search)throw 400;
  const item=await db.prepare(`SELECT ${timeColumns.split(',').map(c=>'t.'+c).join(',')},p.name AS project_name FROM time_entries t JOIN projects p ON p.id=t.project_id AND p.organization_id=t.organization_id
   WHERE t.organization_id=? AND t.actor_id=? AND t.ended_at IS NULL`).bind(actor.organization_id,actor.id).first();
  return json({item:item||null});
 }
 if(path==='/api/time'&&request.method==='GET'){
  // One snapshot: the active timer first, independently of the last 100 completed entries.
  const r=await db.prepare(`SELECT * FROM (SELECT ${timeColumns} FROM time_entries WHERE organization_id=? AND actor_id=? AND ended_at IS NULL
   UNION ALL SELECT * FROM (SELECT ${timeColumns} FROM time_entries WHERE organization_id=? AND actor_id=? AND ended_at IS NOT NULL ORDER BY started_at DESC,id DESC LIMIT 100))
   ORDER BY ended_at IS NOT NULL,started_at DESC,id DESC`)
   .bind(actor.organization_id,actor.id,actor.organization_id,actor.id).all();
  return json({items:r.results});
 }
 if(request.method!=='POST')throw 405;
 const stop=path.match(/^\/api\/timer\/([a-zA-Z0-9-]{1,100})\/stop$/);
 if(stop){
  if(Object.keys(input).length)throw 400;
  const now=Date.now(),token=crypto.randomUUID(),statement=db.prepare(`UPDATE time_entries SET ended_at=?,seconds=CAST((?-started_at)/1000 AS INTEGER),write_token=?
   WHERE id=? AND organization_id=? AND actor_id=? AND ended_at IS NULL AND started_at<=?
   AND NOT EXISTS(SELECT 1 FROM time_details d WHERE d.id=time_entries.id AND d.organization_id=time_entries.organization_id AND (d.review_status='APPROVED' OR d.invoice_ref IS NOT NULL)) RETURNING ${timeColumns}`)
   .bind(now,now,token,stop[1],actor.organization_id,actor.id,now);
  const row=await commitTimeWrite(db,actor,statement,token);if(!row)throw 404;return json(row);
 }
 const manual=path==='/api/time/manual';if(!manual&&path!=='/api/timer/start')throw 404;
 if(Object.keys(input).some(k=>!(manual?['projectId','seconds','description','workedOn','billable','requestId']:['projectId','description','billable']).includes(k))||typeof input.projectId!=='string'||input.projectId.length>100)throw 400;
 if('requestId'in input&&(typeof input.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)))throw 400;
 if('workedOn'in input&&!validWorkedOn(input.workedOn))throw 400;
 if('description'in input&&(typeof input.description!=='string'||input.description.length>2000||input.description.includes('\0')))throw 400;
 if('billable'in input&&typeof input.billable!=='boolean')throw 400;
 if(manual&&(!Number.isSafeInteger(input.seconds)||input.seconds<1||input.seconds>86400))throw 400;
 const parent=await db.prepare('SELECT id FROM projects WHERE id=? AND organization_id=?').bind(input.projectId,actor.organization_id).first();if(!parent)throw 404;
 const requestId=input.requestId?.toLowerCase()??null;let fingerprint=null;
 if(requestId){const canonical=JSON.stringify({projectId:input.projectId,seconds:input.seconds,description:input.description??'',workedOn:input.workedOn??null,billable:input.billable??true});fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical))),b=>b.toString(16).padStart(2,'0')).join('');}
 const replay=async()=>{if(!requestId)return null;const row=await db.prepare(`SELECT ${timeColumns.split(',').map(c=>'t.'+c).join(',')},d.request_fingerprint FROM time_entries t JOIN time_details d ON d.id=t.id AND d.organization_id=t.organization_id WHERE d.organization_id=? AND d.actor_id=? AND d.request_key=?`).bind(actor.organization_id,actor.id,requestId).first();if(!row)return null;if(row.request_fingerprint!==fingerprint)throw 409;delete row.request_fingerprint;return row;};
 const prior=await replay();if(prior)return json(prior);
 const now=Date.now(),id=crypto.randomUUID(),token=crypto.randomUUID();
 const statement=db.prepare(`INSERT INTO time_entries(id,organization_id,project_id,actor_id,started_at,ended_at,seconds,write_token) SELECT ?,?,?,?,?,?,?,? ${manual?'':'WHERE NOT EXISTS(SELECT 1 FROM time_entries WHERE actor_id=? AND ended_at IS NULL)'} RETURNING ${timeColumns}`)
  .bind(id,actor.organization_id,input.projectId,actor.id,manual?now-input.seconds*1000:now,manual?now:null,manual?input.seconds:0,token,...(manual?[]:[actor.id]));
 let row;try{row=await commitTimeWrite(db,actor,statement,token,{sourceKind:manual?'MANUAL':'TIMER',description:input.description??'',...(manual&&'workedOn'in input?{workedOn:input.workedOn}:{}),billable:input.billable??true,requestId,fingerprint});}catch(e){const saved=await replay();if(saved)return json(saved);throw e;}
 if(!row)throw 409;return json(row,201);
}
export async function exportRecords(db,actor,json){
 if(actor.role!=='staff')throw 403;
 const names=['clients','projects','tasks','notes','time_entries','task_comments','note_versions','note_positions','time_details','time_detail_events','time_billing_events',...(await hasFinance(db,actor)?['invoice_drafts','invoice_events','cancelled_invoice_requests','commercial_drafts','commercial_versions','cancelled_commercial_requests','proposal_reviews','proposal_review_events','cancelled_proposal_review_requests','contract_publications','contract_publication_events','cancelled_contract_publication_requests','stripe_customer_links','stripe_invoice_operations','stripe_invoice_events','cancelled_stripe_customer_requests','cancelled_stripe_invoice_requests','stripe_event_inbox','stripe_invoice_projection','stripe_lifecycle_events']:[])];
 const results=await db.batch(names.map(name=>(['stripe_event_inbox','stripe_invoice_projection','stripe_lifecycle_events'].includes(name))?lifecycleExport(db,actor,name):(name.startsWith('stripe_')||name.startsWith('cancelled_stripe_'))?stripeExportStatement(db,actor,name):name.includes('contract_publication')?contractPublicationExportStatement(db,actor,name):name.includes('proposal_review')?reviewExportStatement(db,actor,name):name.includes('commercial_')?commercialExportStatement(db,actor,name):['time_details','time_detail_events','time_billing_events'].includes(name)?timeExportStatement(db,actor,name):['invoice_drafts','invoice_events','cancelled_invoice_requests'].includes(name)?invoiceExportStatement(db,actor,name):db.prepare(`SELECT ${name==='time_entries'?timeColumns:'*'} FROM ${name} WHERE organization_id=? ORDER BY id LIMIT 1001`).bind(actor.organization_id)));
 // The selected batch can outlive an access change. Do not return its cached
 // staff or financial rows after the identity/grant is revoked.
 const current=await db.prepare("SELECT id FROM actors WHERE id=? AND organization_id=? AND role='staff' AND active=1").bind(actor.id,actor.organization_id).first();
 if(!current||names.includes('invoice_drafts')&&!await hasFinance(db,actor))throw 403;
 if(results.some(r=>r.results.length>1000))return json({error:'Export exceeds pilot limit; use the administrator backup procedure'},409);
 return json({version:1,createdAt:new Date().toISOString(),tables:Object.fromEntries(names.map((n,i)=>[n,['time_details','time_detail_events','time_billing_events'].includes(n)?results[i].results.map(publicTime):results[i].results]))});
}
