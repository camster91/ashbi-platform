import {invoiceDashboardAuthority,fullDashboardSelection,fullDashboardSnapshot} from './stripe-lifecycle.mjs';
import {partDashboardSelection,partDashboardSnapshot} from './stripe-part-lifecycle.mjs';

export async function dashboardInvoices(request,env,actor,json){
 if(request.method!=='GET')throw 405;
 const params=new URL(request.url).searchParams,allowed=['clientId','projectId','currency','due','after'];
 for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw 400;
 for(const key of ['clientId','projectId'])if(params.has(key)&&!/^[a-zA-Z0-9-]{1,100}$/.test(params.get(key)))throw 400;
 if(params.has('after')&&!/^(?:part:)?[a-zA-Z0-9-]{1,100}$/.test(params.get('after')))throw 400;
 const currency=params.get('currency'),due=params.get('due')??'all';if(currency!==null&&!['CAD','USD','EUR','GBP'].includes(currency)||!['all','overdue'].includes(due))throw 400;
 const observedAt=Date.now(),currencies={},filters={currency,due,clientId:params.get('clientId'),projectId:params.get('projectId')},db=env.DB,full=fullDashboardSelection(db,actor,filters,observedAt),parts=partDashboardSelection(db,actor,filters,observedAt);
 const initial=await db.batch([invoiceDashboardAuthority(db,actor),full.statement(),parts.statement()]);if(!initial[0].results.length)throw 403;full.rows=initial[1].results;parts.rows=initial[2].results;
 if(full.rows.length+parts.rows.length>1000)return json({error:'More than 1000 outstanding invoices match. Use narrower filters to calculate complete totals.',code:'DASHBOARD_INVOICE_LIMIT',limit:1000},409);
 let fullSnapshot,partSnapshot;try{fullSnapshot=await fullDashboardSnapshot(env,actor,full,filters,observedAt);partSnapshot=await partDashboardSnapshot(env,actor,parts);}catch(error){if(error?.code==='DASHBOARD_INVOICE_READ_LIMIT')return json({error:'Saved invoice history exceeds the safe read size. Use narrower filters to calculate complete totals.',code:error.code},409);if(error?.status)throw error.status;throw error;}
 const proofs=[{statement:full.statement(),rows:full.rows},{statement:parts.statement(),rows:parts.rows},...fullSnapshot.proofs,...partSnapshot.proofs],final=await db.batch([invoiceDashboardAuthority(db,actor),...proofs.map(proof=>proof.statement)]);if(!final[0].results.length)throw 403;if(proofs.some((proof,i)=>JSON.stringify(final[i+1].results)!==JSON.stringify(proof.rows)))throw 409;
 const rows=[...fullSnapshot.values.map(row=>({...row,dashboardId:row.invoiceId,source:{kind:'invoices',id:row.invoiceId}})),...partSnapshot.values.map(row=>({...row,dashboardId:'part:'+row.partId,source:{kind:'invoice-parts',id:row.partId,invoiceId:row.invoiceId,scheduleId:row.scheduleId,partKind:row.kind}}))].sort((a,b)=>a.dashboardId<b.dashboardId?-1:a.dashboardId>b.dashboardId?1:0);
 const unsafe=()=>json({error:'Invoice amounts cannot be totaled safely. Review the source invoice observations before continuing.',code:'UNSAFE_INVOICE_AMOUNTS'},409);
 for(const row of rows){const group=currencies[row.currency]??={invoiceCount:0,totalMinor:0,dueMinor:0,paidMinor:0,remainingMinor:0,overdueCount:0};group.invoiceCount++;if(row.dueAt!==null&&row.dueAt*1000<observedAt)group.overdueCount++;
  for(const key of ['totalMinor','dueMinor','paidMinor','remainingMinor']){if(!Number.isSafeInteger(row[key])||row[key]<0)return unsafe();const sum=BigInt(group[key])+BigInt(row[key]);if(sum>BigInt(Number.MAX_SAFE_INTEGER))return unsafe();group[key]=Number(sum);}
 }
 const after=params.get('after'),page=rows.filter(row=>!after||row.dashboardId>after),items=page.slice(0,50).map(row=>({id:row.dashboardId,title:row.title,status:row.status,source:row.source,client:row.client,project:row.project,owner:{id:null,state:'UNASSIGNED'},currency:row.currency,totalMinor:row.totalMinor,dueMinor:row.dueMinor,paidMinor:row.paidMinor,remainingMinor:row.remainingMinor,dueAt:row.dueAt,overdue:row.dueAt!==null&&row.dueAt*1000<observedAt,revision:row.revision,observedAt:row.observedAt,observationAgeMs:row.observedAt===null?null:Math.max(0,observedAt-row.observedAt),syncState:row.syncState}));
 return json({items,nextCursor:page.length>50?items.at(-1).id:null,complete:page.length<=50,limit:50,currencies,totalsComplete:true,observedAt,dateBasis:'UTC'});
}
