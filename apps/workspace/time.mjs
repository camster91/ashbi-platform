export async function timeRoute(request,db,actor,input,json){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/time')&&!path.startsWith('/api/timer/'))return null;
 if(actor.role!=='staff')throw 403;
 if(path==='/api/timer/current'){
  if(request.method!=='GET')throw 405;
  if(new URL(request.url).search)throw 400;
  const item=await db.prepare(`SELECT t.*,p.name AS project_name FROM time_entries t JOIN projects p ON p.id=t.project_id AND p.organization_id=t.organization_id
   WHERE t.organization_id=? AND t.actor_id=? AND t.ended_at IS NULL`).bind(actor.organization_id,actor.id).first();
  return json({item:item||null});
 }
 if(path==='/api/time'&&request.method==='GET'){
  // One snapshot: the active timer first, independently of the last 100 completed entries.
  const r=await db.prepare(`SELECT * FROM (SELECT * FROM time_entries WHERE organization_id=? AND actor_id=? AND ended_at IS NULL
   UNION ALL SELECT * FROM (SELECT * FROM time_entries WHERE organization_id=? AND actor_id=? AND ended_at IS NOT NULL ORDER BY started_at DESC,id DESC LIMIT 100))
   ORDER BY ended_at IS NOT NULL,started_at DESC,id DESC`)
   .bind(actor.organization_id,actor.id,actor.organization_id,actor.id).all();
  return json({items:r.results});
 }
 if(request.method!=='POST')throw 405;
 const stop=path.match(/^\/api\/timer\/([a-zA-Z0-9-]{1,100})\/stop$/);
 if(stop){
  if(Object.keys(input).length)throw 400;
  const now=Date.now();const row=await db.prepare('UPDATE time_entries SET ended_at=?,seconds=CAST((?-started_at)/1000 AS INTEGER) WHERE id=? AND organization_id=? AND actor_id=? AND ended_at IS NULL AND started_at<=? RETURNING *')
   .bind(now,now,stop[1],actor.organization_id,actor.id,now).first();if(!row)throw 404;return json(row);
 }
 const manual=path==='/api/time/manual';if(!manual&&path!=='/api/timer/start')throw 404;
 if(Object.keys(input).some(k=>!(manual?['projectId','seconds']:['projectId']).includes(k))||typeof input.projectId!=='string'||input.projectId.length>100)throw 400;
 if(manual&&(!Number.isSafeInteger(input.seconds)||input.seconds<1||input.seconds>86400))throw 400;
 const parent=await db.prepare('SELECT id FROM projects WHERE id=? AND organization_id=?').bind(input.projectId,actor.organization_id).first();if(!parent)throw 404;
 const now=Date.now(),id=crypto.randomUUID();
 const row=await db.prepare(`INSERT INTO time_entries(id,organization_id,project_id,actor_id,started_at,ended_at,seconds) SELECT ?,?,?,?,?,?,? ${manual?'':'WHERE NOT EXISTS(SELECT 1 FROM time_entries WHERE actor_id=? AND ended_at IS NULL)'} RETURNING *`)
  .bind(id,actor.organization_id,input.projectId,actor.id,manual?now-input.seconds*1000:now,manual?now:null,manual?input.seconds:0,...(manual?[]:[actor.id])).first();
 if(!row)throw 409;return json(row,201);
}
export async function exportRecords(db,actor,json){
 if(actor.role!=='staff')throw 403;
 const names=['clients','projects','tasks','notes','time_entries','task_comments','note_versions','note_positions'];
 const results=await db.batch(names.map(name=>db.prepare(`SELECT * FROM ${name} WHERE organization_id=? ORDER BY id LIMIT 1001`).bind(actor.organization_id)));
 if(results.some(r=>r.results.length>1000))return json({error:'Export exceeds pilot limit; use the administrator backup procedure'},409);
 return json({version:1,createdAt:new Date().toISOString(),tables:Object.fromEntries(names.map((n,i)=>[n,results[i].results]))});
}
