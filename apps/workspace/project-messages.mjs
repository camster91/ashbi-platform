import {scope} from './records.mjs';

export async function projectMessagesRoute(request,db,actor,projectId,readBody,json){
 const url=new URL(request.url),posting=request.method==='POST';
 if(!['GET','POST'].includes(request.method))throw 405;
 if([...url.searchParams.keys()].some(k=>k!=='after')||url.searchParams.getAll('after').length>1||posting&&url.search)throw 400;
 const {clause,values}=scope('projects',actor);
 const allowed=`SELECT 1 FROM projects WHERE projects.id=? AND ${clause} AND EXISTS(SELECT 1 FROM actors a WHERE a.id=? AND a.organization_id=projects.organization_id AND a.active=1 AND a.role=? AND a.client_id IS ?)`;
 const args=[projectId,...values,actor.id,actor.role,actor.client_id??null];
 if(!await db.prepare(allowed).bind(...args).first())throw 404;
 const columns='m.id,m.project_id,m.actor_id,m.content,m.created_at';
 if(!posting){
  const after=url.searchParams.get('after');let cursor=[];
  if(after!==null){const match=after.match(/^(\d{1,16}):([a-zA-Z0-9-]{1,100})$/);if(!match||!Number.isSafeInteger(Number(match[1])))throw 400;cursor=[Number(match[1]),Number(match[1]),match[2]];}
  const result=await db.prepare(`SELECT ${columns},a.role AS author_role FROM project_messages m JOIN actors a ON a.id=m.actor_id AND a.organization_id=m.organization_id WHERE m.organization_id=? AND m.project_id=? AND EXISTS(${allowed}) ${cursor.length?'AND (m.created_at<? OR (m.created_at=? AND m.id<?))':''} ORDER BY m.created_at DESC,m.id DESC LIMIT 51`).bind(actor.organization_id,projectId,...args,...cursor).all();
  const items=result.results.slice(0,50),last=items.at(-1);return json({items,nextCursor:result.results.length>50?last.created_at+':'+last.id:null});
 }
 const input=await readBody(request);
 if(Object.keys(input).some(k=>!['content','requestId'].includes(k))||typeof input.content!=='string'||!input.content.trim()||input.content.length>10000||typeof input.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId))throw 400;
 const content=input.content.trim(),key=input.requestId.toLowerCase();
 // A retry can recover an already accepted message even if the project was subsequently archived.
 const existing=await db.prepare(`SELECT ${columns} FROM project_messages m WHERE m.organization_id=? AND m.actor_id=? AND m.request_id=? AND EXISTS(${allowed})`).bind(actor.organization_id,actor.id,key,...args).first();
 if(existing){if(existing.project_id!==projectId||existing.content!==content)throw 409;return json(existing);}
 const writable=allowed+' AND projects.archived=0';
 const row=await db.prepare(`INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(${writable}) ON CONFLICT(organization_id,actor_id,request_id) DO NOTHING RETURNING id,project_id,actor_id,content,created_at`).bind(crypto.randomUUID(),actor.organization_id,projectId,actor.id,key,content,Date.now(),...args).first();
 if(row)return json(row,201);
 const retry=await db.prepare(`SELECT ${columns} FROM project_messages m WHERE m.organization_id=? AND m.actor_id=? AND m.request_id=? AND EXISTS(${allowed})`).bind(actor.organization_id,actor.id,key,...args).first();
 if(retry&&retry.project_id===projectId&&retry.content===content)return json(retry);
 if(!await db.prepare(allowed).bind(...args).first())throw 404;
 throw 409;
}
