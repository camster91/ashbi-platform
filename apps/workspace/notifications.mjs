// Unread state is per message, never a clock watermark that can swallow a later arrival.
export async function notificationsRoute(request,db,actor,readBody,json){
 const url=new URL(request.url),path=url.pathname;
 const scope=`m.organization_id=? AND m.actor_id<>? AND EXISTS(SELECT 1 FROM actors a WHERE a.id=? AND a.organization_id=m.organization_id AND a.active=1 AND a.role=? AND a.client_id IS ?)${actor.role==='client'?' AND p.client_id=? AND p.client_visible=1':''}`;
 const args=[actor.organization_id,actor.id,actor.id,actor.role,actor.client_id??null,...(actor.role==='client'?[actor.client_id]:[])];
 const join=' FROM project_messages m JOIN projects p ON p.id=m.project_id AND p.organization_id=m.organization_id';
 const unread='NOT EXISTS(SELECT 1 FROM project_message_reads r WHERE r.organization_id=m.organization_id AND r.actor_id=? AND r.message_id=m.id)';
 if(request.method==='GET'&&(path==='/api/notifications'||path==='/api/notifications/summary')){
  if([...url.searchParams.keys()].some(k=>k!=='after')||url.searchParams.getAll('after').length>1||path.endsWith('/summary')&&url.search)throw 400;
  if(path.endsWith('/summary'))return json(await db.prepare('SELECT count(*) AS unreadCount'+join+' WHERE '+scope+' AND '+unread).bind(...args,actor.id).first());
  const after=url.searchParams.get('after');let cursor=[];
  if(after!==null){const match=after.match(/^(\d{1,16}):([a-zA-Z0-9-]{1,100})$/);if(!match||!Number.isSafeInteger(Number(match[1])))throw 400;cursor=[Number(match[1]),Number(match[1]),match[2]];}
  const result=await db.prepare('SELECT m.id,m.project_id,p.name AS project_name,substr(m.content,1,160) AS preview,m.created_at'+join+' WHERE '+scope+' AND '+unread+(cursor.length?' AND (m.created_at<? OR (m.created_at=? AND m.id<?))':'')+' ORDER BY m.created_at DESC,m.id DESC LIMIT 51').bind(...args,actor.id,...cursor).all();
  const items=result.results.slice(0,50),last=items.at(-1);return json({items,nextCursor:result.results.length>50?last.created_at+':'+last.id:null});
 }
 if(request.method==='POST'&&path==='/api/notifications/read'){
  if(url.search)throw 400;const input=await readBody(request);
  if(Object.keys(input).some(k=>k!=='messageIds')||!Array.isArray(input.messageIds)||input.messageIds.length<1||input.messageIds.length>50||new Set(input.messageIds).size!==input.messageIds.length||input.messageIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id)))throw 400;
  // Inaccessible and nonexistent IDs are both ignored. Authorization and marking are one statement.
  await db.prepare('INSERT INTO project_message_reads(organization_id,actor_id,message_id,read_at) SELECT m.organization_id,?,m.id,?'+join+' WHERE '+scope+' AND m.id IN ('+input.messageIds.map(()=>'?').join(',')+') ON CONFLICT(organization_id,actor_id,message_id) DO NOTHING').bind(actor.id,Date.now(),...args,...input.messageIds).run();
  return json({success:true});
 }
 throw 405;
}
