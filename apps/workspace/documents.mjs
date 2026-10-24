export const noteColumns='id,organization_id,project_id,title,text,revision,client_visible';

// The random token ties capture to this successful write, rather than a revision won by another editor.
export async function commitNote(db,actor,statement,token,sourceRevision=null){
 const results=await db.batch([statement,db.prepare(`INSERT INTO note_versions(id,note_id,organization_id,project_id,revision,title,text,client_visible,recorded_at,actor_id,source_revision)
  SELECT history_token,id,organization_id,project_id,revision,title,text,client_visible,?,?,? FROM notes WHERE history_token=? AND organization_id=? RETURNING id`)
  .bind(Date.now(),actor.id,sourceRevision,token,actor.organization_id)]);
 const row=results[0].results[0];if(row&&!results[1].results.length)throw 503;return row;
}

export async function documentHistory(request,db,actor,id,version,restore,readBody,json){
 if(actor.role!=='staff')throw 403;
 const url=new URL(request.url);
 if(request.method!==(restore?'POST':'GET'))throw 405;
 if([...url.searchParams.keys()].some(k=>k!=='before')||((restore||version!==undefined)&&url.search))throw 400;
 const note=await db.prepare('SELECT revision FROM notes WHERE id=? AND organization_id=?').bind(id,actor.organization_id).first();if(!note)throw 404;
 if(version===undefined){
  const before=url.searchParams.get('before');if(before!==null&&(!/^\d{1,16}$/.test(before)||!Number.isSafeInteger(Number(before))))throw 400;
  const result=await db.prepare(`SELECT revision,title,client_visible,recorded_at,actor_id,source_revision FROM note_versions WHERE note_id=? AND organization_id=? ${before!==null?'AND revision<?':''} ORDER BY revision DESC LIMIT 51`)
   .bind(id,actor.organization_id,...(before!==null?[Number(before)]:[])).all();
  const items=result.results.slice(0,50);return json({items,currentRevision:note.revision,nextCursor:result.results.length>50?String(items.at(-1).revision):null});
 }
 const revision=Number(version);if(!Number.isSafeInteger(revision)||revision<0)throw 400;
 const snapshot=await db.prepare('SELECT revision,title,text,client_visible,recorded_at,actor_id,source_revision FROM note_versions WHERE note_id=? AND organization_id=? AND revision=?')
  .bind(id,actor.organization_id,revision).first();if(!snapshot)throw 404;
 if(!restore)return json({...snapshot,currentRevision:note.revision});
 const input=await readBody(request);
 if(Object.keys(input).some(k=>!['revision','clientVisible'].includes(k))||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER||typeof input.clientVisible!=='boolean')throw 400;
 if(note.revision!==input.revision||revision>=note.revision)throw 409;
 if(typeof snapshot.title!=='string'||!snapshot.title.trim()||snapshot.title.length>200||typeof snapshot.text!=='string'||!snapshot.text.trim()||snapshot.text.length>20000)throw 409;
 const token=crypto.randomUUID();
 const row=await commitNote(db,actor,db.prepare(`UPDATE notes SET title=?,text=?,client_visible=?,revision=revision+1,history_token=? WHERE id=? AND organization_id=? AND revision=? RETURNING ${noteColumns}`)
  .bind(snapshot.title,snapshot.text,Number(input.clientVisible),token,id,actor.organization_id,input.revision),token,revision);
 if(!row)throw 409;return json(row);
}
