import { html, css, clientScript } from './ui.mjs';
import { authenticate } from './auth.mjs';
import { filesRoute } from './files.mjs';
import { records } from './records.mjs';
import { commentsRoute } from './comments.mjs';
import { timeRoute, exportRecords } from './time.mjs';
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
export function createWorker(resolveKey){return {async fetch(request,env){try{
 const url=new URL(request.url);if(url.origin!==env.APP_ORIGIN)throw 404;
 if(url.pathname==='/health')return json({status:'ok',release:env.RELEASE||'unversioned'});
 let identity;try{identity=await authenticate(request,env,resolveKey);}catch{throw 401;}
 const actor=await env.DB.prepare('SELECT id,organization_id,role,client_id FROM actors WHERE email=? AND active=1').bind(identity.email).first();if(!actor)throw 403;
 if(request.method==='GET'&&['/','/app.js','/app.css'].includes(url.pathname)){
  const type=url.pathname==='/'?'text/html':url.pathname==='/app.js'?'application/javascript':'text/css';
  return new Response(url.pathname==='/'?html:url.pathname==='/app.js'?clientScript:css,{headers:{...security,'Content-Type':type+'; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
 }
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==url.origin)throw 403;
 const comment=url.pathname.match(/^\/api\/tasks\/([a-zA-Z0-9-]{1,100})\/comments$/);
 if(comment)return await commentsRoute(request,env.DB,actor,comment[1],readBody,json);
 if(url.pathname==='/api/files'||url.pathname.startsWith('/api/files/'))return await filesRoute(request,env,actor,readBody,json);
 if(url.pathname==='/api/me'&&request.method==='GET')return json({role:actor.role,id:actor.id,pilot:true,features:{files:!!env.FILES}});
 if(url.pathname==='/api/export'&&request.method==='GET')return await exportRecords(env.DB,actor,json);
 if(url.pathname.startsWith('/api/time')){const result=await timeRoute(request,env.DB,actor,request.method==='POST'?await readBody(request):{},json);if(result)return result;}
 if(url.pathname==='/api/staff'&&request.method==='GET'){if(actor.role!=='staff')throw 403;const r=await env.DB.prepare("SELECT id,id AS name FROM actors WHERE organization_id=? AND active=1 AND role='staff' ORDER BY id LIMIT 50").bind(actor.organization_id).all();return json({items:r.results});}
 const match=url.pathname.match(/^\/api\/(clients|projects|tasks|notes)(?:\/([a-zA-Z0-9-]{1,100}))?$/);
 if(match)return await records(request,env.DB,actor,match[1],match[2],['POST','PATCH'].includes(request.method)?await readBody(request):{},json);
 throw 404;
 }catch(e){const status=Number.isInteger(e)&&[400,401,403,404,405,409,413,503].includes(e)?e:500;
 return json({error:({400:'Invalid request',401:'Sign in required',403:'Forbidden',404:'Not found',405:'Method not allowed',409:'Record changed; reload and try again',413:'Request too large',503:'Unavailable'})[status]||'Request failed'},status);}}};}
export default createWorker();
