import {outstandingInvoiceRows} from './stripe-lifecycle.mjs';

export async function dashboardInvoices(request,env,actor,json){
 if(request.method!=='GET')throw 405;
 const params=new URL(request.url).searchParams,allowed=['clientId','projectId','currency','due','after'];
 for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw 400;
 for(const key of ['clientId','projectId','after'])if(params.has(key)&&!/^[a-zA-Z0-9-]{1,100}$/.test(params.get(key)))throw 400;
 const currency=params.get('currency'),due=params.get('due')??'all';if(currency!==null&&!['CAD','USD','EUR','GBP'].includes(currency)||!['all','overdue'].includes(due))throw 400;
 const observedAt=Date.now(),currencies={};let rows;
 try{rows=await outstandingInvoiceRows(env,actor,{currency,due,clientId:params.get('clientId'),projectId:params.get('projectId')},observedAt);}catch(error){if(error!==409)throw error;return json({error:'More than 1000 outstanding invoices match. Use narrower filters to calculate complete totals.',code:'DASHBOARD_INVOICE_LIMIT',limit:1000},409);}
 const unsafe=()=>json({error:'Invoice amounts cannot be totaled safely. Review the source invoice observations before continuing.',code:'UNSAFE_INVOICE_AMOUNTS'},409);
 for(const row of rows){const group=currencies[row.currency]??={invoiceCount:0,totalMinor:0,dueMinor:0,paidMinor:0,remainingMinor:0,overdueCount:0};group.invoiceCount++;if(row.dueAt!==null&&row.dueAt*1000<observedAt)group.overdueCount++;
  for(const key of ['totalMinor','dueMinor','paidMinor','remainingMinor']){if(!Number.isSafeInteger(row[key])||row[key]<0)return unsafe();const sum=BigInt(group[key])+BigInt(row[key]);if(sum>BigInt(Number.MAX_SAFE_INTEGER))return unsafe();group[key]=Number(sum);}
 }
 const after=params.get('after'),page=rows.filter(row=>!after||row.invoiceId>after),items=page.slice(0,50).map(row=>({id:row.invoiceId,title:row.title,status:row.status,source:{kind:'invoices',id:row.invoiceId},client:row.client,project:row.project,owner:{id:null,state:'UNASSIGNED'},currency:row.currency,totalMinor:row.totalMinor,dueMinor:row.dueMinor,paidMinor:row.paidMinor,remainingMinor:row.remainingMinor,dueAt:row.dueAt,overdue:row.dueAt!==null&&row.dueAt*1000<observedAt,revision:row.revision,observedAt:row.observedAt,observationAgeMs:row.observedAt===null?null:Math.max(0,observedAt-row.observedAt),syncState:row.syncState}));
 return json({items,nextCursor:page.length>50?items.at(-1).id:null,complete:page.length<=50,limit:50,currencies,totalsComplete:true,observedAt,dateBasis:'UTC'});
}
