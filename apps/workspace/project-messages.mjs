import {scope} from './records.mjs';

export async function projectMessagesRoute(request,db,actor,projectId,readBody,json){
 const url=new URL(request.url),posting=request.method==='POST',recipients=url.pathname.endsWith('/message-recipients');
 if(!['GET','POST'].includes(request.method))throw 405;
 if(recipients&&(request.method!=='GET'||url.search))throw 400;
 if([...url.searchParams.keys()].some(k=>k!=='after')||url.searchParams.getAll('after').length>1||posting&&url.search)throw 400;
 const {clause,values}=scope('projects',actor);
 const allowed=`SELECT 1 FROM projects WHERE projects.id=? AND ${clause} AND EXISTS(SELECT 1 FROM actors a WHERE a.id=? AND a.organization_id=projects.organization_id AND a.active=1 AND a.role=? AND a.client_id IS ?)`;
 const args=[projectId,...values,actor.id,actor.role,actor.client_id??null];
 if(!await db.prepare(allowed).bind(...args).first())throw 404;
 const recipientScope="SELECT r.id,r.email,r.role FROM actors r JOIN projects p ON p.organization_id=r.organization_id WHERE p.id=? AND r.active=1 AND r.id<>? AND (r.role='staff' OR (?='staff' AND r.role='client' AND p.client_visible=1 AND r.client_id=p.client_id)) AND EXISTS("+allowed+")";
 const recipientArgs=[projectId,actor.id,actor.role,...args];
 if(recipients){const result=await db.prepare(recipientScope+' ORDER BY r.email,r.id LIMIT 101').bind(...recipientArgs).all();return json({items:result.results.slice(0,100).map(r=>({id:r.id,label:r.email,role:r.role})),limited:result.results.length>100});}
 const columns='m.id,m.project_id,m.actor_id,m.content,m.created_at';
 if(!posting){
  const after=url.searchParams.get('after');let cursor=[];
  if(after!==null){const match=after.match(/^(\d{1,16}):([a-zA-Z0-9-]{1,100})$/);if(!match||!Number.isSafeInteger(Number(match[1])))throw 400;cursor=[Number(match[1]),Number(match[1]),match[2]];}
  const result=await db.prepare(`SELECT ${columns},a.role AS author_role,EXISTS(SELECT 1 FROM json_each(m.mention_ids) WHERE value=?) AS mentioned,CASE WHEN m.actor_id<>? AND NOT EXISTS(SELECT 1 FROM project_message_reads mr WHERE mr.organization_id=m.organization_id AND mr.actor_id=? AND mr.message_id=m.id) THEN 1 ELSE 0 END AS unread FROM project_messages m JOIN actors a ON a.id=m.actor_id AND a.organization_id=m.organization_id WHERE m.organization_id=? AND m.project_id=? AND EXISTS(${allowed}) ${cursor.length?'AND (m.created_at<? OR (m.created_at=? AND m.id<?))':''} ORDER BY m.created_at DESC,m.id DESC LIMIT 51`).bind(actor.id,actor.id,actor.id,actor.organization_id,projectId,...args,...cursor).all();
  const items=result.results.slice(0,50),last=items.at(-1);return json({items,nextCursor:result.results.length>50?last.created_at+':'+last.id:null});
 }
 const input=await readBody(request);
 if(Object.keys(input).some(k=>!['content','requestId','mentionIds'].includes(k))||typeof input.content!=='string'||!input.content.trim()||input.content.length>10000||typeof input.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId))throw 400;
 const mentions=input.mentionIds===undefined?[]:input.mentionIds;if(!Array.isArray(mentions)||mentions.length>10||new Set(mentions).size!==mentions.length||mentions.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id)))throw 400;
 const mentionIds=JSON.stringify([...mentions].sort()),content=input.content.trim(),key=input.requestId.toLowerCase();
 // A retry can recover an already accepted message even if the project was subsequently archived.
 const existing=await db.prepare(`SELECT ${columns},m.mention_ids FROM project_messages m WHERE m.organization_id=? AND m.actor_id=? AND m.request_id=? AND EXISTS(${allowed})`).bind(actor.organization_id,actor.id,key,...args).first();
 if(existing){if(existing.project_id!==projectId||existing.content!==content||existing.mention_ids!==mentionIds)throw 409;return json(existing);}
 const recipientGuard='(SELECT count(*) FROM ('+recipientScope+') WHERE id IN (SELECT value FROM json_each(?)))=?';
 const mentionArgs=[...recipientArgs,mentionIds,mentions.length];
 if(!await db.prepare('SELECT 1 WHERE '+recipientGuard).bind(...mentionArgs).first())throw 400;
 const writable=allowed+' AND projects.archived=0';
 const row=await db.prepare(`INSERT INTO project_messages(id,organization_id,project_id,actor_id,request_id,content,created_at,mention_ids) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(${writable}) AND ${recipientGuard} ON CONFLICT(organization_id,actor_id,request_id) DO NOTHING RETURNING id,project_id,actor_id,content,created_at`).bind(crypto.randomUUID(),actor.organization_id,projectId,actor.id,key,content,Date.now(),mentionIds,...args,...mentionArgs).first();
 if(row)return json(row,201);
 const retry=await db.prepare(`SELECT ${columns},m.mention_ids FROM project_messages m WHERE m.organization_id=? AND m.actor_id=? AND m.request_id=? AND EXISTS(${allowed})`).bind(actor.organization_id,actor.id,key,...args).first();
 if(retry&&retry.project_id===projectId&&retry.content===content&&retry.mention_ids===mentionIds)return json(retry);
 if(!await db.prepare(allowed).bind(...args).first())throw 404;
 throw 409;
}
