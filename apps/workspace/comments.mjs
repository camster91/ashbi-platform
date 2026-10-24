import {scope} from './records.mjs';

export async function commentsRoute(request,db,actor,taskId,readBody,json){
 const url=new URL(request.url);
 if(!['GET','POST'].includes(request.method))throw 405;
 if([...url.searchParams.keys()].some(k=>k!=='after')||(request.method==='POST'&&url.search))throw 400;
 const {clause,values}=scope('tasks',actor);
 const allowed=`SELECT 1 FROM tasks WHERE tasks.id=? AND ${clause}`;
 if(!await db.prepare(allowed).bind(taskId,...values).first())throw 404;

 if(request.method==='GET'){
  const after=url.searchParams.get('after');let cursor=[];
  if(after!==null){
   const match=after.match(/^(\d{1,16}):([a-zA-Z0-9-]{1,100})$/);
   if(!match||!Number.isSafeInteger(Number(match[1])))throw 400;
   cursor=[Number(match[1]),Number(match[1]),match[2]];
  }
  // Recheck the task/project permission in the data read, even if it changed after the existence check.
  const result=await db.prepare(`SELECT c.id,c.task_id,c.actor_id,c.content,c.client_visible,c.created_at FROM task_comments c
   WHERE c.organization_id=? AND c.task_id=? AND EXISTS(${allowed}) ${actor.role==='client'?'AND c.client_visible=1':''}
   ${cursor.length?'AND (c.created_at<? OR (c.created_at=? AND c.id<?))':''}
   ORDER BY c.created_at DESC,c.id DESC LIMIT 51`).bind(actor.organization_id,taskId,taskId,...values,...cursor).all();
  const items=result.results.slice(0,50),last=items.at(-1);
  return json({items,nextCursor:result.results.length>50?last.created_at+':'+last.id:null});
 }

 const input=await readBody(request);
 if(Object.keys(input).some(k=>!['content','clientVisible','requestId'].includes(k))||typeof input.content!=='string'||!input.content.trim()||input.content.length>10000||
  typeof input.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)||
  ('clientVisible' in input&&typeof input.clientVisible!=='boolean'))throw 400;
 if(actor.role==='client'&&input.clientVisible===false)throw 403;
 const content=input.content.trim(),visible=actor.role==='client'?1:Number(input.clientVisible??false),requestId=input.requestId.toLowerCase();
 const id=crypto.randomUUID(),now=Date.now();
 // The scoped INSERT and per-author key protect permission changes and simultaneous retries.
 const row=await db.prepare(`INSERT INTO task_comments(id,organization_id,task_id,actor_id,request_id,content,client_visible,created_at)
  SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(${allowed}) ON CONFLICT(organization_id,actor_id,request_id) DO NOTHING
  RETURNING id,task_id,actor_id,content,client_visible,created_at`)
  .bind(id,actor.organization_id,taskId,actor.id,requestId,content,visible,now,taskId,...values).first();
 if(row)return json(row,201);
 const existing=await db.prepare(`SELECT id,task_id,actor_id,content,client_visible,created_at FROM task_comments
  WHERE organization_id=? AND actor_id=? AND request_id=? AND EXISTS(${allowed})`)
  .bind(actor.organization_id,actor.id,requestId,taskId,...values).first();
 if(existing&&existing.task_id===taskId&&existing.content===content&&existing.client_visible===visible)return json(existing);
 if(!await db.prepare(allowed).bind(taskId,...values).first())throw 404;
 throw 409;
}
