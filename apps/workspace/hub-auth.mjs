// A same-zone Worker Route fetch reaches the retained Hub origin, not this Worker.
// Passwords, MFA and revocation remain owned by that existing authentication service.
const methods=new Map([
 ['/api/auth/me','GET'],['/api/auth/mfa','GET'],
 ...['login','login/mfa','logout','forgot-password','reset-password','mfa/enroll','mfa/confirm'].map(p=>['/api/auth/'+p,'POST'])
]);
export function sessionCookie(request){
 const cookies=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('token='));
 if(cookies.length!==1||cookies[0].length>16384||!/^token=[A-Za-z0-9_.-]+$/.test(cookies[0]))return '';
 return cookies[0];
}
function origin(env){
 if(env.APP_ORIGIN!=='https://hub.ashbi.ca'||!env.HUB_AUTH_ORGANIZATION_ID)throw 503;
 return env.APP_ORIGIN;
}
async function upstream(request,env,path,body,fetcher){
 const base=origin(env),headers=new Headers({'Accept':'application/json'}),cookie=sessionCookie(request);
 if(cookie)headers.set('Cookie',cookie);
 if(body!==undefined){headers.set('Content-Type','application/json');headers.set('Origin',base);}
 const ip=request.headers.get('CF-Connecting-IP');if(ip&&/^[0-9a-fA-F:.]{3,45}$/.test(ip))headers.set('X-Forwarded-For',ip);
 let response;try{response=await fetcher(new Request(base+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(10000)}));}catch{throw 503;}
 if(response.status>=300&&response.status<400||!response.headers.get('content-type')?.includes('application/json'))throw 503;
 return response;
}
export async function hubIdentity(request,env,fetcher=fetch){
 if(!sessionCookie(request))throw 401;
 const response=await upstream(request,env,'/api/auth/me',undefined,fetcher);
 if(!response.ok)throw response.status===401?401:response.status===403?403:503;
 let user;try{user=await response.json();}catch{throw 503;}
 if(!user||typeof user.id!=='string'||typeof user.email!=='string'||!user.email.includes('@')||user.organizationId!==env.HUB_AUTH_ORGANIZATION_ID||!['ADMIN','TEAM','CLIENT'].includes(user.role)||user.mfaEnrollmentRequired||user.impersonation)throw 403;
 return {email:user.email.toLowerCase(),subject:user.id,role:user.role==='CLIENT'?'client':'staff'};
}
export async function hubAuthRoute(request,env,readBody,security,fetcher=fetch){
 const url=new URL(request.url),method=methods.get(url.pathname);if(!method||url.search)throw 404;
 if(request.method!==method)throw 405;
 if(method==='POST'&&request.headers.get('origin')!==env.APP_ORIGIN)throw 403;
 const body=method==='POST'?await readBody(request):undefined;
 const response=await upstream(request,env,url.pathname,body,fetcher);
 const headers=new Headers({...security,'Content-Type':'application/json; charset=utf-8'});
 // Forward only the established session cookie, with explicit host-only protections.
 for(const cookie of response.headers.getSetCookie()){
  if(!cookie.startsWith('token='))continue;
  const parts=cookie.split(';').map(x=>x.trim()),value=parts.shift();
  if(!/^token=[A-Za-z0-9_.-]*$/.test(value))throw 503;
  const lifetime=parts.filter(x=>/^(?:Max-Age=-?\d+|Expires=[^;]+)$/i.test(x));
  headers.append('Set-Cookie',[value,'Path=/','HttpOnly','Secure','SameSite=Strict',...lifetime].join('; '));
 }
 const retry=response.headers.get('retry-after');if(retry&&/^\d{1,6}$/.test(retry))headers.set('Retry-After',retry);
 return new Response(response.body,{status:response.status,headers});
}
