import {scope} from './records.mjs';

const types=Object.freeze(['clients','projects','tasks','notes']);
export async function searchRoute(request,db,actor,json){
 if(request.method!=='GET')throw 405;
 const params=new URL(request.url).searchParams;
 for(const key of params.keys())if(!['q','type','after'].includes(key)||params.getAll(key).length!==1)throw 400;
 const q=params.get('q')?.trim(),type=params.get('type'),after=params.get('after')||'';
 if(!q||q.length>200||type!==null&&!types.includes(type)||params.has('after')&&(!type||!/^[a-zA-Z0-9-]{1,100}$/.test(after)))throw 400;
 const selected=type?[type]:types;
 const read=async()=>Promise.all(selected.map(async table=>{
  const {clause,values}=scope(table,actor),title=['clients','projects'].includes(table)?'name':'title';
  const activeProject=table==='projects'?' AND projects.archived=0':['tasks','notes'].includes(table)?` AND EXISTS(SELECT 1 FROM projects p WHERE p.id=${table}.project_id AND p.organization_id=${table}.organization_id AND p.archived=0)`:'';
  const current='EXISTS(SELECT 1 FROM actors viewer WHERE viewer.id=? AND viewer.organization_id=? AND viewer.active=1 AND viewer.role=? AND viewer.client_id IS ?)';
  const result=await db.prepare(`SELECT ${table}.id,${table}.${title} AS title FROM ${table} WHERE ${clause}${activeProject} AND ${current} AND instr(lower(${table}.${title}),lower(?))>0 AND ${table}.id>? ORDER BY ${table}.id LIMIT 21`).bind(...values,actor.id,actor.organization_id,actor.role,actor.client_id,q,after).all();
  const items=result.results.slice(0,20);return {type:table,items,nextCursor:result.results.length>20?items.at(-1).id:null};
 }));
 let groups=await read();if(actor.role==='client')groups=await read();
 const current=await db.prepare('SELECT id FROM actors WHERE id=? AND organization_id=? AND active=1 AND role=? AND client_id IS ?').bind(actor.id,actor.organization_id,actor.role,actor.client_id).first();if(!current)throw 403;
 return json({groups});
}
