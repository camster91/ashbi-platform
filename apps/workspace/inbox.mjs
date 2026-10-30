const preferenceKeys=['messages','assignments','deadlines','uploads','mentions'];
// Every query, including read writes, rechecks the current identity and resource scope.
export function feed(actor){
 const args=[actor.id,actor.organization_id,actor.role,actor.client_id??null];
 const identity='SELECT * FROM actors WHERE id=? AND organization_id=? AND role=? AND client_id IS ? AND active=1';
 const projects='SELECT p.* FROM projects p JOIN identity a ON a.organization_id=p.organization_id WHERE a.role=\'staff\' OR (p.client_visible=1 AND p.client_id=a.client_id)';
 const open="t.status NOT IN ('done','retired','archived') AND p.archived=0";
 const sql=`WITH identity AS (${identity}), permitted AS (${projects}), preferences AS (
 SELECT COALESCE(n.messages,1) messages,COALESCE(n.assignments,1) assignments,COALESCE(n.deadlines,1) deadlines,COALESCE(n.uploads,1) uploads,COALESCE(n.mentions,1) mentions FROM identity a LEFT JOIN notification_preferences n ON n.actor_id=a.id AND n.organization_id=a.organization_id
 ), candidates AS (
 SELECT 'message' kind,m.id,m.project_id,p.name project_name,substr(m.content,1,160) preview,m.created_at,m.id record_id,CASE WHEN r.message_id IS NULL THEN 1 ELSE 0 END unread,EXISTS(SELECT 1 FROM json_each(m.mention_ids) WHERE value=a.id) mentioned
 FROM project_messages m JOIN permitted p ON p.id=m.project_id AND p.organization_id=m.organization_id JOIN identity a LEFT JOIN project_message_reads r ON r.organization_id=m.organization_id AND r.actor_id=a.id AND r.message_id=m.id WHERE m.actor_id<>a.id AND ((EXISTS(SELECT 1 FROM json_each(m.mention_ids) WHERE value=a.id) AND (SELECT mentions FROM preferences)=1) OR (NOT EXISTS(SELECT 1 FROM json_each(m.mention_ids) WHERE value=a.id) AND (SELECT messages FROM preferences)=1))
 UNION ALL
 SELECT 'assignment',t.assignment_token,t.project_id,p.name,t.title,t.assigned_at,t.id,CASE WHEN r.item_id IS NULL THEN 1 ELSE 0 END,0
 FROM tasks t JOIN permitted p ON p.id=t.project_id AND p.organization_id=t.organization_id JOIN identity a LEFT JOIN inbox_reads r ON r.organization_id=t.organization_id AND r.actor_id=a.id AND r.kind='assignment' AND r.item_id=t.assignment_token
 WHERE a.role='staff' AND t.assignee_id=a.id AND t.assignment_token IS NOT NULL AND ${open} AND (SELECT assignments FROM preferences)=1
 UNION ALL
 SELECT 'deadline',t.id||'--'||t.due_on,t.project_id,p.name,t.title||' — due '||t.due_on,CAST(strftime('%s',t.due_on) AS INTEGER)*1000,t.id,CASE WHEN r.item_id IS NULL THEN 1 ELSE 0 END,0
 FROM tasks t JOIN permitted p ON p.id=t.project_id AND p.organization_id=t.organization_id JOIN identity a LEFT JOIN inbox_reads r ON r.organization_id=t.organization_id AND r.actor_id=a.id AND r.kind='deadline' AND r.item_id=t.id||'--'||t.due_on
 WHERE a.role='staff' AND t.assignee_id=a.id AND t.due_on<=date('now') AND ${open} AND (SELECT deadlines FROM preferences)=1
 UNION ALL
 SELECT 'upload',f.id,f.project_id,p.name,f.name,f.created_at,f.id,CASE WHEN r.item_id IS NULL THEN 1 ELSE 0 END,0
 FROM files f JOIN permitted p ON p.id=f.project_id AND p.organization_id=f.organization_id JOIN identity a LEFT JOIN inbox_reads r ON r.organization_id=f.organization_id AND r.actor_id=a.id AND r.kind='upload' AND r.item_id=f.id
 WHERE a.role='staff' AND f.actor_id<>a.id AND f.notify_staff=1 AND f.state='ready' AND f.deleted=0 AND (SELECT uploads FROM preferences)=1
 ) `;
 return {sql,args};
}
export async function inboxRoute(request,db,actor,readBody,json){
 const url=new URL(request.url),path=url.pathname,{sql,args}=feed(actor);
 if(path.endsWith('/preferences')){
  if(url.search)throw 400;
  if(request.method==='GET'){const row=await db.prepare(sql+'SELECT * FROM preferences').bind(...args).first();if(!row)throw 403;return json(Object.fromEntries(preferenceKeys.map(k=>[k,Boolean(row[k])])));}
  if(request.method!=='PUT')throw 405;
  const input=await readBody(request);if(Object.keys(input).some(k=>!preferenceKeys.includes(k))||preferenceKeys.slice(0,4).some(k=>typeof input[k]!=='boolean')||('mentions' in input&&typeof input.mentions!=='boolean'))throw 400;
  const row=await db.prepare(sql+'INSERT INTO notification_preferences(organization_id,actor_id,messages,assignments,deadlines,uploads,mentions) SELECT organization_id,id,?,?,?,?,COALESCE(?,(SELECT mentions FROM preferences)) FROM identity WHERE 1 ON CONFLICT(organization_id,actor_id) DO UPDATE SET messages=excluded.messages,assignments=excluded.assignments,deadlines=excluded.deadlines,uploads=excluded.uploads,mentions=excluded.mentions RETURNING *').bind(...args,...preferenceKeys.map(k=>k==='mentions'&&input[k]===undefined?null:Number(input[k]))).first();if(!row)throw 403;return json(Object.fromEntries(preferenceKeys.map(k=>[k,Boolean(row[k])])));
 }
 if(path.endsWith('/read')){
  if(request.method!=='POST')throw 405;if(url.search)throw 400;
  const input=await readBody(request);if(Object.keys(input).some(k=>!['items','read'].includes(k))||typeof input.read!=='boolean'||!Array.isArray(input.items)||input.items.length<1||input.items.length>50)throw 400;
  if(input.items.some(x=>!x||Object.keys(x).length!==2||!['message','assignment','deadline','upload'].includes(x.kind)||typeof x.id!=='string'||!/^[a-zA-Z0-9-]{1,120}$/.test(x.id))||new Set(input.items.map(x=>x.kind+':'+x.id)).size!==input.items.length)throw 400;
  const statements=input.items.map(item=>{
   const message=item.kind==='message',table=message?'project_message_reads':'inbox_reads',column=message?'message_id':'item_id';
   if(input.read)return db.prepare(sql+`INSERT INTO ${table}(organization_id,actor_id,${message?'':'kind,'}${column},read_at) SELECT a.organization_id,a.id,${message?'':'c.kind,'}c.id,? FROM candidates c JOIN identity a WHERE c.kind=? AND c.id=? ON CONFLICT DO NOTHING`).bind(...args,Date.now(),item.kind,item.id);
   return db.prepare(sql+`DELETE FROM ${table} WHERE organization_id=? AND actor_id=? ${message?'':'AND kind=?'} AND ${column} IN (SELECT id FROM candidates WHERE kind=? AND id=?)`).bind(...args,actor.organization_id,actor.id,...(message?[]:[item.kind]),item.kind,item.id);
  });await db.batch(statements);return json({success:true});
 }
 if(request.method!=='GET')throw 405;
 if(path.endsWith('/summary')){if(url.search)throw 400;return json(await db.prepare(sql+'SELECT count(*) unreadCount FROM candidates WHERE unread=1').bind(...args).first());}
 if([...url.searchParams.keys()].some(k=>!['after','state'].includes(k))||['after','state'].some(k=>url.searchParams.getAll(k).length>1))throw 400;
 const state=url.searchParams.get('state')||'unread';if(!['unread','read','all'].includes(state))throw 400;
 let cursor=[];const after=url.searchParams.get('after');if(after!==null){const m=after.match(/^(\d{1,16}):(message|assignment|deadline|upload):([a-zA-Z0-9-]{1,120})$/);if(!m||!Number.isSafeInteger(Number(m[1])))throw 400;cursor=[Number(m[1]),Number(m[1]),m[2],m[2],m[3]];}
 const results=await db.prepare(sql+'SELECT * FROM candidates WHERE '+(state==='all'?'1':'unread='+Number(state==='unread'))+(cursor.length?' AND (created_at<? OR (created_at=? AND (kind<? OR (kind=? AND id<?))))':'')+' ORDER BY created_at DESC,kind DESC,id DESC LIMIT 51').bind(...args,...cursor).all();const items=results.results.slice(0,50),last=items.at(-1);return json({items,nextCursor:results.results.length>50?last.created_at+':'+last.kind+':'+last.id:null});
}
