import {noteColumns} from './documents.mjs';

export const noteTreeColumns=noteColumns+', (SELECT parent_id FROM note_positions WHERE id=notes.id) AS parent_id, (SELECT archived FROM note_positions WHERE id=notes.id) AS archived';
const idValue=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(v);

export function documentScope(actor,includeArchived=false){
 let clause='notes.organization_id=? AND EXISTS(SELECT 1 FROM note_positions WHERE id=notes.id AND organization_id=notes.organization_id)',values=[actor.organization_id];
 if(!includeArchived||actor.role==='client')clause+=` AND NOT EXISTS(WITH RECURSIVE path(id,parent_id,archived,client_visible) AS (
  SELECT p.id,p.parent_id,p.archived,n.client_visible FROM note_positions p JOIN notes n ON n.id=p.id WHERE p.id=notes.id
  UNION SELECT p.id,p.parent_id,p.archived,n.client_visible FROM note_positions p JOIN notes n ON n.id=p.id JOIN path a ON p.id=a.parent_id
 ) SELECT 1 FROM path WHERE archived=1 ${actor.role==='client'?'OR client_visible=0':''})`;
 if(actor.role==='client'){clause+=' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=notes.project_id AND p.organization_id=notes.organization_id AND p.client_id=? AND p.client_visible=1)';values.push(actor.client_id);}
 return {clause,values};
}

export function documentQuery(request,actor,id){
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(k=>!(id?['includeArchived']:['after','q','projectId','parentId','includeArchived']).includes(k)))throw 400;
 const archived=params.get('includeArchived');if(archived!==null&&!['true','false'].includes(archived))throw 400;
 if(archived==='true'&&actor.role!=='staff')throw 403;
 const scope=documentScope(actor,archived==='true');let clause=scope.clause,values=[...scope.values];
 for(const key of ['projectId','parentId'])if(params.has(key)){
  const value=params.get(key);if(key==='parentId'&&value===''){clause+=' AND (SELECT parent_id FROM note_positions WHERE id=notes.id) IS NULL';continue;}
  if(!idValue(value))throw 400;clause+=key==='projectId'?' AND notes.project_id=?':' AND (SELECT parent_id FROM note_positions WHERE id=notes.id)=?';values.push(value);
 }
 const q=params.get('q')?.trim()||'';if(q.length>200)throw 400;if(q){clause+=" AND instr(lower(notes.title||' '||notes.text),lower(?))>0";values.push(q);}
 return {clause,values};
}

export function parentGuard(parentId,id,organizationId,projectExpression){
 if(parentId===null||parentId===undefined)return {clause:'1',values:[]};
 return {clause:`EXISTS(SELECT 1 FROM note_positions parent WHERE parent.id=? AND parent.organization_id=? AND parent.project_id=${projectExpression}
  AND NOT EXISTS(WITH RECURSIVE ancestors(id,parent_id) AS (
   SELECT id,parent_id FROM note_positions WHERE id=? AND organization_id=?
   UNION SELECT p.id,p.parent_id FROM note_positions p JOIN ancestors a ON p.id=a.parent_id WHERE p.organization_id=?
  ) SELECT 1 FROM ancestors WHERE id=?))`,values:[parentId,organizationId,parentId,organizationId,organizationId,id]};
}

export async function validateParent(db,actor,id,projectId,parentId){
 if(parentId===null||parentId===undefined)return;
 const parent=await db.prepare('SELECT id FROM note_positions WHERE id=? AND organization_id=? AND project_id=?').bind(parentId,actor.organization_id,projectId).first();if(!parent)throw 404;
 const guard=parentGuard(parentId,id,actor.organization_id,'notes.project_id');
 if(id&&!await db.prepare(`SELECT id FROM notes WHERE id=? AND organization_id=? AND ${guard.clause}`).bind(id,actor.organization_id,...guard.values).first())throw 400;
}

export const validParent=value=>value===null||idValue(value);
