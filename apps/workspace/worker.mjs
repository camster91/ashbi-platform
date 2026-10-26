import { html, css, clientScript } from './ui.mjs';
import { authenticate } from './auth.mjs';
import { filesRoute } from './files.mjs';
import { records } from './records.mjs';
import { dashboardTasks } from './dashboard.mjs';
import { dashboardInvoices } from './dashboard-invoices.mjs';
import { commentsRoute } from './comments.mjs';
import { documentHistory } from './documents.mjs';
import { timeRoute, exportRecords } from './time.mjs';
import { timeDetailsRoute, timePeople, hasFinance } from './time-details.mjs';
import { invoicesRoute } from './invoices.mjs';
import { commercialRoute } from './commercial.mjs';
import { contractPublicationsRoute } from './contract-publications.mjs';
import { readSigningPolicy,decorateSignature,decorateSignatures,contractSignaturesRoute } from './contract-signatures.mjs';
import { proposalReviewsRoute, dashboardReviews } from './proposal-reviews.mjs';
import { stripeDraftsRoute } from './stripe-drafts.mjs';
import {stripeIssuanceRoute} from './stripe-issuance.mjs';
import {sourceHistoryRoute} from './source-pilot.mjs';
import { stripeWebhook, stripeLifecycleRoute, drainStripeEvents } from './stripe-lifecycle.mjs';
import { stripePartLifecycleRoute } from './stripe-part-lifecycle.mjs';
const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Strict-Transport-Security':'max-age=31536000'};
export const json=(value,status=200)=>Response.json(value,{status,headers:security});
export async function readBody(request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw 400;
 const reader=request.body?.getReader();if(!reader)throw 400;
 const chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw 413;}chunks.push(value);}
 const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
 let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{throw 400;}
 if(!input||typeof input!=='object'||Array.isArray(input))throw 400;return input;
}
export function createWorker(resolveKey,providers={}){return {async scheduled(event,env,ctx){await drainStripeEvents(env,providers.stripeFetch,ctx);},async fetch(request,env,ctx){try{
 const url=new URL(request.url);if(url.origin!==env.APP_ORIGIN)throw 404;
 if(url.pathname==='/health')return json({status:'ok',release:env.RELEASE||'unversioned'});
 if(url.pathname==='/api/stripe/webhook')return await stripeWebhook(request,env,json,providers.stripeFetch,ctx);
 let identity;try{identity=await authenticate(request,env,resolveKey);}catch{throw 401;}
 const actor=await env.DB.prepare('SELECT id,organization_id,role,client_id FROM actors WHERE email=? AND active=1').bind(identity.email).first();if(!actor)throw 403;
 if(request.method==='GET'&&['/','/app.js','/app.css'].includes(url.pathname)){
  const type=url.pathname==='/'?'text/html':url.pathname==='/app.js'?'application/javascript':'text/css';
  return new Response(url.pathname==='/'?html:url.pathname==='/app.js'?clientScript:css,{headers:{...security,'Content-Type':type+'; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
 }
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==url.origin)throw 403;
 const history=url.pathname.match(/^\/api\/notes\/([a-zA-Z0-9-]{1,100})\/versions(?:\/(\d{1,16})(\/restore)?)?$/);
 if(history)return await documentHistory(request,env.DB,actor,history[1],history[2],Boolean(history[3]),readBody,json);
 const comment=url.pathname.match(/^\/api\/tasks\/([a-zA-Z0-9-]{1,100})\/comments$/);
 if(comment)return await commentsRoute(request,env.DB,actor,comment[1],readBody,json);
 if(url.pathname==='/api/files'||url.pathname.startsWith('/api/files/'))return await filesRoute(request,env,actor,readBody,json);
 if(url.pathname==='/api/me'&&request.method==='GET')return json({role:actor.role,id:actor.id,pilot:true,features:{files:!!env.FILES,finance:await hasFinance(env.DB,actor)}});
 if(url.pathname==='/api/source-history'||url.pathname.startsWith('/api/source-history/'))return await sourceHistoryRoute(request,env,actor,json);
 if(url.pathname==='/api/export'&&request.method==='GET')return await exportRecords(env.DB,actor,json);
 if(url.pathname==='/api/dashboard/tasks')return await dashboardTasks(request,env.DB,actor,json);
 if(url.pathname==='/api/dashboard/invoices')return await dashboardInvoices(request,env,actor,json);
 if(url.pathname==='/api/dashboard/reviews')return await dashboardReviews(request,env.DB,actor,json);
 if(['/api/billing/parts','/api/billing/parts/summary','/api/portal/invoice-parts','/api/portal/invoice-parts/summary'].includes(url.pathname)||url.pathname.startsWith('/api/portal/invoice-parts/')||/^\/api\/invoices\/[^/]+\/parts\/[^/]+\/billing(?:\/reconcile)?$/.test(url.pathname))return await stripePartLifecycleRoute(request,env,actor,readBody,json,providers.stripeFetch);
 if(url.pathname.startsWith('/api/stripe/events')||/^\/api\/invoices\/[^/]+\/billing(?:\/reconcile)?$/.test(url.pathname)||['/api/billing/invoices','/api/billing/summary'].includes(url.pathname)||url.pathname==='/api/portal/invoices'||url.pathname.startsWith('/api/portal/invoices/'))return await stripeLifecycleRoute(request,env,actor,readBody,json,providers.stripeFetch);
 if(/^\/api\/invoices\/[^/]+\/stripe\/finalize/.test(url.pathname))return await stripeIssuanceRoute(request,env,actor,readBody,json,providers.stripeFetch);
 if(url.pathname.startsWith('/api/stripe/')||/^\/api\/invoices\/[^/]+\/stripe(?:-preview|-schedule-preview|\/reconcile|\/requests\/[^/]+(?:\/cancel)?)?$/.test(url.pathname))return await stripeDraftsRoute(request,env,actor,readBody,json,providers.stripeFetch);
 if(url.pathname==='/api/invoices'||url.pathname.startsWith('/api/invoices/'))return await invoicesRoute(request,env.DB,actor,readBody,json);
 if(url.pathname==='/api/commercial'||url.pathname.startsWith('/api/commercial/'))return await commercialRoute(request,env.DB,actor,readBody,json);
 if(url.pathname==='/api/proposal-reviews'||url.pathname.startsWith('/api/proposal-reviews/')||url.pathname==='/api/portal/proposals'||url.pathname.startsWith('/api/portal/proposals/'))return await proposalReviewsRoute(request,env.DB,actor,readBody,json);
 if(/^\/api\/(?:portal\/contracts|contract-publications)\/[^/]+\/(?:signing|signature|signed-document|pdf|signed-pdf|requests)(?:\/[^/]+(?:\/cancel)?)?$/.test(url.pathname))return await contractSignaturesRoute(request,env,actor,readBody,json);
 if(url.pathname==='/api/contract-publications'||url.pathname.startsWith('/api/contract-publications/')||url.pathname==='/api/portal/contracts'||url.pathname.startsWith('/api/portal/contracts/'))return await contractPublicationsRoute(request,env.DB,actor,readBody,json,{policy:()=>readSigningPolicy(env),decorate:(row,client)=>decorateSignature(env,actor,row,client),decorateMany:(rows,client)=>decorateSignatures(env,actor,rows,client)});
 const timeDetail=url.pathname.match(/^\/api\/time\/details\/([a-zA-Z0-9-]{1,100})(?:\/(approve|reject|history))?$/);
 if(url.pathname==='/api/time/people')return await timePeople(request,env.DB,actor,json);
 if(timeDetail||url.pathname==='/api/time/entries')return await timeDetailsRoute(request,env.DB,actor,timeDetail?.[1],timeDetail?.[2],readBody,json);
 if(url.pathname.startsWith('/api/time')){const result=await timeRoute(request,env.DB,actor,request.method==='POST'?await readBody(request):{},json);if(result)return result;}
 if(url.pathname==='/api/staff'&&request.method==='GET'){if(actor.role!=='staff')throw 403;const r=await env.DB.prepare("SELECT id,id AS name FROM actors WHERE organization_id=? AND active=1 AND role='staff' ORDER BY id LIMIT 50").bind(actor.organization_id).all();return json({items:r.results});}
 const match=url.pathname.match(/^\/api\/(clients|projects|tasks|notes)(?:\/([a-zA-Z0-9-]{1,100}))?$/);
 if(match)return await records(request,env.DB,actor,match[1],match[2],['POST','PATCH'].includes(request.method)?await readBody(request):{},json);
 throw 404;
 }catch(e){const status=Number.isInteger(e)&&[400,401,403,404,405,409,413,503].includes(e)?e:500;
 return json({error:({400:'Invalid request',401:'Sign in required',403:'Forbidden',404:'Not found',405:'Method not allowed',409:'Record changed; reload and try again',413:'Request too large',503:'Unavailable'})[status]||'Request failed'},status);}}};}
export default createWorker();
