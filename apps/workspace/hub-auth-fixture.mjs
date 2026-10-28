import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
export async function hubAuthFixture(createWorker){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'native-auth'},cf:false}),DB=await mf.getD1Database('DB');
 for(const file of(await readdir(new URL('./migrations',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile(new URL('./migrations/'+file,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));}
 await DB.prepare("INSERT INTO actors VALUES('native-staff','staff@example.invalid','qa','staff',NULL,1),('native-client','client@example.invalid','qa','client','own',1)").run();
 await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('own','qa','Own client'),('other','qa','Other client')").run();
 const env={DB,APP_ORIGIN:'https://hub.ashbi.ca',AUTH_MODE:'hub',HUB_AUTH_ORGANIZATION_ID:'hub-org'},calls=[],sessions=new Map();let nextUser={id:'hub-staff',email:'staff@example.invalid',organizationId:'hub-org',role:'ADMIN'},mode='password';
 const cookie='token=fixture-session',response=(data,status=200,headers={})=>Response.json(data,{status,headers});
 const fetcher=async req=>{
  const path=new URL(req.url).pathname,body=req.method==='POST'?await req.json():undefined;calls.push({path,headers:req.headers,body});
  if(mode==='offline')throw Error('Synthetic offline');
  if(mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://foreign.invalid'}});
  if(path==='/api/auth/login'){
   if(body.password!=='synthetic-password')return response({error:'Invalid credentials'},401);
   if(mode==='mfa')return response({mfaRequired:true,challengeToken:'fixture-challenge'});
   sessions.set(cookie,{...nextUser});return response({user:nextUser},200,{'Set-Cookie':cookie+'; HttpOnly; Path=/; Secure; SameSite=Strict'});
  }
  if(path==='/api/auth/login/mfa'){
   if(body.challengeToken!=='fixture-challenge'||body.code!=='123456'&&body.recoveryCode!=='synthetic-recovery-code')return response({error:'Invalid authentication code'},401);
   sessions.set(cookie,{...nextUser});return response({user:nextUser},200,{'Set-Cookie':cookie+'; Secure; HttpOnly; Path=/'});
  }
  if(path==='/api/auth/logout'){sessions.delete(req.headers.get('cookie'));return response({success:true},200,{'Set-Cookie':'token=; Max-Age=0; Path=/'});}
  if(path==='/api/auth/me'){const user=sessions.get(req.headers.get('cookie'));return user?response(user):response({error:'Unauthorized'},401);}
  if(path==='/api/auth/forgot-password')return response({success:true});
  if(path==='/api/auth/reset-password')return body.token==='synthetic-reset'?response({success:true}):response({error:'Invalid or expired reset token'},400);
  if(path==='/api/auth/mfa/enroll')return response({secret:'SYNTHETICSETUPKEY'});
  if(path==='/api/auth/mfa/confirm'){nextUser={...nextUser,mfaEnrollmentRequired:false};sessions.set(cookie,nextUser);return response({recoveryCodes:['synthetic-recovery-code']});}
  return response({error:'Unknown fixture route'},404);
 };
 const worker=createWorker(undefined,{authFetch:fetcher});
 return {DB,env,worker,calls,sessions,cookie,setMode:v=>{mode=v;},setUser:v=>{nextUser=v;},login:()=>{sessions.set(cookie,{...nextUser});},close:()=>mf.dispose(),call:(path,{method='GET',body,cookie:token,headers={}}={})=>worker.fetch(new Request(env.APP_ORIGIN+path,{method,headers:{...(body?{'Content-Type':'application/json',Origin:env.APP_ORIGIN}:{}),...(token?{Cookie:token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env)};
}
