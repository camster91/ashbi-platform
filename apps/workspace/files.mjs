const limit=5*1024*1024;
const publicColumns='f.id,f.project_id,f.name,f.size,f.sha256,f.client_visible,f.deleted,f.revision,f.created_at';
const hex=bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
async function boundedBytes(request){
 const reader=request.body?.getReader();if(!reader)throw 400;
 const chunks=[];let length=0;
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw 413;}chunks.push(value);}
 if(!length)throw 400;const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}
export async function filesRoute(request,env,actor,readBody,json){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/files(?:\/([a-zA-Z0-9-]{1,100})(\/download)?)?$/);if(!match)throw 404;
 if(!env.FILES)throw 503;
 const db=env.DB,id=match[1],download=!!match[2],staff=actor.role==='staff';
 const scope=`f.organization_id=? AND f.state='ready'${staff?'':' AND f.deleted=0 AND f.client_visible=1 AND p.client_visible=1 AND p.client_id=?'}`;
 const scopeArgs=[actor.organization_id,...(staff?[]:[actor.client_id])];
 const join=' FROM files f JOIN projects p ON p.id=f.project_id AND p.organization_id=f.organization_id';
 if(request.method==='GET'){
  if(download){
   const row=await db.prepare('SELECT f.*'+join+' WHERE '+scope+' AND f.id=? AND f.deleted=0').bind(...scopeArgs,id).first();if(!row)throw 404;
   const object=await env.FILES.get(row.object_key);if(!object||object.size!==row.size)throw 503;
   let bytes;
   if(row.size>limit){
    // Only the trusted administrative importer can create these larger rows.
    // R2 validates put({sha256}) and exposes that native checksum on reads;
    // custom metadata is not an integrity proof. Keep the ordinary upload cap.
    const checksum=object.checksums?.sha256;
    if(!checksum||new Uint8Array(checksum).length!==32||hex(checksum)!==row.sha256||!object.body)throw 503;
    bytes=object.body;
   }else{bytes=await object.arrayBuffer();if(hex(await crypto.subtle.digest('SHA-256',bytes))!==row.sha256)throw 503;}
    // Storage and hashing can outlive a sharing/deletion or identity change.
    // Check the current viewer and file/project scope in one D1 snapshot before
    // returning either buffered bytes or the original stream.
    const [viewer,current]=await db.batch([
     db.prepare('SELECT id FROM actors WHERE id=? AND organization_id=? AND active=1 AND role=? AND client_id IS ?').bind(actor.id,actor.organization_id,actor.role,actor.client_id??null),
     db.prepare('SELECT f.*'+join+' WHERE '+scope+' AND f.id=? AND f.deleted=0').bind(...scopeArgs,id)
    ]);
    if(!viewer.results[0])throw 403;
    const latest=current.results[0];if(!latest)throw 404;
    if(['object_key','size','sha256','project_id'].some(key=>latest[key]!==row[key]))throw 409;
    return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(row.size),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(latest.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}});
  }
  if(id)throw 404;
  const includeDeleted=url.searchParams.get('includeDeleted');if(includeDeleted!==null&&!['true','false'].includes(includeDeleted))throw 400;if(includeDeleted==='true'&&!staff)throw 403;
  const after=url.searchParams.get('after')||'';if(after&&!/^[a-zA-Z0-9-]{1,100}$/.test(after))throw 400;
  const projectId=url.searchParams.get('projectId');
  if(url.searchParams.getAll('projectId').length>1||projectId!==null&&!/^[a-zA-Z0-9-]{1,100}$/.test(projectId))throw 400;
  const rows=await db.prepare('SELECT '+publicColumns+join+' WHERE '+scope+(includeDeleted==='true'?'':' AND f.deleted=0')+(projectId?' AND f.project_id=?':'')+' AND f.id>? ORDER BY f.id LIMIT 51').bind(...scopeArgs,...(projectId?[projectId]:[]),after).all();
  return json({items:rows.results.slice(0,50),nextCursor:rows.results.length>50?rows.results[49].id:null});
 }
 if(!staff&&!(request.method==='POST'&&!id))throw 403;
 if(request.method==='POST'&&!id){
  if(request.headers.get('content-type')!=='application/octet-stream')throw 400;
  let name;try{name=decodeURIComponent(request.headers.get('x-file-name')||'');}catch{throw 400;}
  if(!name.trim()||name!==name.trim()||name.length>180||/[\p{Cc}\p{Cf}\\/]/u.test(name)||['.','..'].includes(name))throw 400;
  const project=request.headers.get('x-project-id'),visible=request.headers.get('x-client-visible');
  if(!project||!/^[a-zA-Z0-9-]{1,100}$/.test(project)||!['true','false'].includes(visible))throw 400;
  const permissionSql="SELECT p.id FROM projects p JOIN actors a ON a.organization_id=p.organization_id WHERE p.id=? AND p.organization_id=? AND a.id=? AND a.active=1 AND a.role=? AND a.client_id IS ?"+(staff?'':" AND p.client_id=? AND p.client_visible=1 AND p.client_uploads=1 AND p.archived=0");
  const permissionArgs=[project,actor.organization_id,actor.id,actor.role,actor.client_id??null,...(staff?[]:[actor.client_id])];
  if(!staff&&visible!=='true')throw 400;
  if(!await db.prepare(permissionSql).bind(...permissionArgs).first())throw staff?404:403;
  const bytes=await boundedBytes(request),sha256=hex(await crypto.subtle.digest('SHA-256',bytes)),fileId=crypto.randomUUID(),key='originals/'+crypto.randomUUID();
  // Reserve hidden metadata first. A crash leaves a pending record for reconciliation,
  // never a download. D1/R2 are not one transaction; original bytes are not auto-deleted.
  await db.prepare('INSERT INTO files(id,organization_id,project_id,actor_id,name,object_key,size,sha256,client_visible,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(fileId,actor.organization_id,project,actor.id,name,key,bytes.length,sha256,visible==='true'?1:0,Date.now()).run();
  const object=await env.FILES.put(key,bytes,{sha256});if(!object)throw 503;
  const published=await db.prepare("UPDATE files SET state='ready' WHERE id=? AND state='pending' AND EXISTS("+permissionSql+") RETURNING id").bind(fileId,...permissionArgs).first();
  if(!published)throw 403;
  const row=await db.prepare('SELECT '+publicColumns+' FROM files f WHERE f.id=?').bind(fileId).first();return json(row,201);
 }
 if(request.method==='PATCH'&&id&&!download){
  const input=await readBody(request),keys=Object.keys(input);
  if(!Number.isSafeInteger(input.revision)||input.revision<0||keys.some(k=>!['revision','deleted','clientVisible'].includes(k))||keys.length<2||('deleted'in input&&typeof input.deleted!=='boolean')||('clientVisible'in input&&typeof input.clientVisible!=='boolean'))throw 400;
  const row=await db.prepare("SELECT id FROM files WHERE id=? AND organization_id=? AND state='ready'").bind(id,actor.organization_id).first();if(!row)throw 404;
  const fields=keys.filter(k=>k!=='revision');const updated=await db.prepare('UPDATE files SET '+fields.map(k=>(k==='clientVisible'?'client_visible':k)+'=?').join(',')+",revision=revision+1 WHERE id=? AND organization_id=? AND revision=? RETURNING id").bind(...fields.map(k=>input[k]?1:0),id,actor.organization_id,input.revision).first();if(!updated)throw 409;
  return json(await db.prepare('SELECT '+publicColumns+' FROM files f WHERE f.id=?').bind(id).first());
 }
 throw 405;
}
