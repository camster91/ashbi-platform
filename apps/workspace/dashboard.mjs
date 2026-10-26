import {scope} from './records.mjs';

// A read projection of canonical tasks. No copied state, inferred priority or writes.
export async function dashboardTasks(request,db,actor,json){
 if(request.method!=='GET')throw 405;
 const params=new URL(request.url).searchParams,allowed=['owner','ownerId','clientId','projectId','status','due','after','includeArchivedProjects'];
 for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw 400;
 const status=params.get('status')??'open',due=params.get('due')??'all',owner=params.get('owner');
 if(!['open','all','todo','doing','review','waiting','later','done','retired','archived'].includes(status)||!['all','overdue','today','none'].includes(due)||owner!==null&&!['mine','unassigned'].includes(owner)||owner&&params.has('ownerId'))throw 400;
 for(const key of ['ownerId','clientId','projectId','after'])if(params.has(key)&&!/^[a-zA-Z0-9-]{1,100}$/.test(params.get(key)))throw 400;
 const archive=params.get('includeArchivedProjects');if(archive!==null&&!['true','false'].includes(archive))throw 400;
 const {clause,values}=scope('tasks',actor),where=[clause],bindings=[...values];if(archive!=='true')where.push('p.archived=0');
 if(status==='open')where.push("tasks.status IN ('todo','doing','review','waiting','later')");else if(status!=='all'){where.push('tasks.status=?');bindings.push(status);}
 for(const [key,column] of [['ownerId','tasks.assignee_id'],['clientId','p.client_id'],['projectId','tasks.project_id'],['after','tasks.id']])if(params.has(key)){where.push(column+(key==='after'?'>?':'=?'));bindings.push(params.get(key));}
 if(owner==='mine'){where.push('tasks.assignee_id=?');bindings.push(actor.id);}else if(owner==='unassigned')where.push('tasks.assignee_id IS NULL');
 const observedAt=Date.now(),today=new Date(observedAt).toISOString().slice(0,10);
 if(due==='none')where.push('tasks.due_on IS NULL');else if(due!=='all'){where.push('tasks.due_on'+(due==='overdue'?'< ?':'= ?'));bindings.push(today);}
 if(due==='overdue')where.push("tasks.status IN ('todo','doing','review','waiting')");
 // Current identity is part of the query, not just the initial authentication.
 where.push('EXISTS(SELECT 1 FROM actors viewer WHERE viewer.id=? AND viewer.organization_id=tasks.organization_id AND viewer.active=1 AND viewer.role=? AND viewer.client_id IS ?)');bindings.push(actor.id,actor.role,actor.client_id);
 const sql=`SELECT tasks.id,tasks.title,tasks.status,tasks.revision,tasks.assignee_id,tasks.due_on,p.id AS project_id,p.name AS project_name,c.id AS client_id,c.name AS client_name,a.active AS owner_active
 FROM tasks JOIN projects p ON p.id=tasks.project_id AND p.organization_id=tasks.organization_id
 JOIN clients c ON c.id=p.client_id AND c.organization_id=p.organization_id
 LEFT JOIN actors a ON a.id=tasks.assignee_id AND a.organization_id=tasks.organization_id AND a.role='staff'
 WHERE ${where.join(' AND ')} ORDER BY tasks.id LIMIT 51`;
 const read=()=>db.prepare(sql).bind(...bindings).all();
 let result=await read();
 // Re-read client sharing before returning, as other client projections do.
 if(actor.role==='client')result=await read();
 const current=await db.prepare('SELECT id FROM actors WHERE id=? AND organization_id=? AND active=1 AND role=? AND client_id IS ?').bind(actor.id,actor.organization_id,actor.role,actor.client_id).first();if(!current)throw 403;
 const items=result.results.slice(0,50).map(row=>({id:row.id,title:row.title,status:row.status,revision:row.revision,source:{kind:'tasks',id:row.id},client:{id:row.client_id,name:row.client_name},project:{id:row.project_id,name:row.project_name},owner:{id:row.assignee_id,state:row.assignee_id===null?'UNASSIGNED':row.owner_active===1?'ACTIVE':row.owner_active===0?'INACTIVE':'UNAVAILABLE'},dueOn:row.due_on,overdue:['todo','doing','review','waiting'].includes(row.status)&&row.due_on!==null&&row.due_on<today}));
 return json({items,nextCursor:result.results.length>50?items.at(-1).id:null,complete:result.results.length<=50,limit:50,observedAt,dateBasis:'UTC'});
}
