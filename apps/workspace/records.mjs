import {commitNote,noteColumns} from './documents.mjs';
const short=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200;
const bool=value=>typeof value==='boolean';
const date=value=>value===null||(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
const sqlValue=value=>typeof value==='boolean'?Number(value):typeof value==='string'?value.trim():value;
const descriptors={
 clients:{fields:{name:short,email:v=>typeof v==='string'&&v.length<=254&&(v===''||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),company:v=>typeof v==='string'&&v.length<=200},create:['name']},
 projects:{fields:{name:short,clientId:short,clientVisible:bool,status:v=>['planned','active','complete'].includes(v)},create:['name','clientId','clientVisible'],parent:'clients'},
 tasks:{fields:{title:short,projectId:short,clientVisible:bool,assigneeId:v=>v===null||short(v),dueOn:date,status:v=>['todo','doing','done'].includes(v)},create:['title','projectId','clientVisible'],parent:'projects'},
 notes:{fields:{title:short,projectId:short,clientVisible:bool,text:v=>typeof v==='string'&&v.trim().length>0&&v.length<=20000},create:['title','projectId','clientVisible','text'],parent:'projects'},
};
const columns={clientId:'client_id',projectId:'project_id',clientVisible:'client_visible',assigneeId:'assignee_id',dueOn:'due_on'};
export function scope(table,actor){
 let clause=`${table}.organization_id=?`;const values=[actor.organization_id];
 if(actor.role==='client'){
  if(table==='clients'){clause+=' AND clients.id=?';values.push(actor.client_id);}
  else if(table==='projects'){clause+=' AND projects.client_id=? AND projects.client_visible=1';values.push(actor.client_id);}
  else {clause+=` AND ${table}.client_visible=1 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=${table}.project_id AND p.organization_id=${table}.organization_id AND p.client_id=? AND p.client_visible=1)`;values.push(actor.client_id);}
 }
 return {clause,values};
}
export async function records(request,db,actor,table,id,input,json){
 const spec=descriptors[table];if(!spec)return null;
 const projection=table==='notes'?noteColumns:'*';
 const {clause,values}=scope(table,actor);
 if(request.method==='GET'){
  if(id){const row=await db.prepare(`SELECT ${projection} FROM ${table} WHERE ${clause} AND id=?`).bind(...values,id).first();return row?json(row):json({error:'Not found'},404);}
  const after=new URL(request.url).searchParams.get('after')||'';if(after.length>100)throw 400;
  const result=await db.prepare(`SELECT ${projection} FROM ${table} WHERE ${clause} AND id>? ORDER BY id LIMIT 51`).bind(...values,after).all();
  const items=result.results.slice(0,50);return json({items,nextCursor:result.results.length>50?items.at(-1).id:null});
 }
 if(actor.role!=='staff')throw 403;
 if(!['POST','PATCH'].includes(request.method))throw 405;
 if((request.method==='PATCH')!==Boolean(id))throw 400;
 const allowed=Object.keys(spec.fields).filter(k=>!id||!['projectId','clientId'].includes(k));
 if(Object.keys(input).some(k=>!allowed.includes(k)&&!(id&&k==='revision')))throw 400;
 for(const key of Object.keys(input).filter(k=>k!=='revision'))if(!spec.fields[key](input[key]))throw 400;
 if(input.assigneeId){const target=await db.prepare("SELECT id FROM actors WHERE id=? AND organization_id=? AND role='staff' AND active=1").bind(input.assigneeId,actor.organization_id).first();if(!target)throw 404;}
 if(id){
  if(!Number.isSafeInteger(input.revision)||input.revision<0)throw 400;
  const keys=Object.keys(input).filter(k=>k!=='revision');if(!keys.length)throw 400;
  if(table==='notes'){
   if(input.revision>=Number.MAX_SAFE_INTEGER)throw 400;
   const token=crypto.randomUUID(),statement=db.prepare(`UPDATE notes SET ${keys.map(k=>`${columns[k]||k}=?`).join(',')},revision=revision+1,history_token=? WHERE organization_id=? AND id=? AND revision=? RETURNING ${noteColumns}`)
    .bind(...keys.map(k=>sqlValue(input[k])),token,actor.organization_id,id,input.revision);
   const row=await commitNote(db,actor,statement,token);if(row)return json(row);
   const exists=await db.prepare('SELECT id FROM notes WHERE organization_id=? AND id=?').bind(actor.organization_id,id).first();throw exists?409:404;
  }
  const row=await db.prepare(`UPDATE ${table} SET ${keys.map(k=>`${columns[k]||k}=?`).join(',')},revision=revision+1 WHERE organization_id=? AND id=? AND revision=? RETURNING *`)
   .bind(...keys.map(k=>sqlValue(input[k])),actor.organization_id,id,input.revision).first();
  if(row)return json(row);
  const exists=await db.prepare(`SELECT id FROM ${table} WHERE organization_id=? AND id=?`).bind(actor.organization_id,id).first();throw exists?409:404;
 }
 if(spec.create.some(k=>!(k in input)))throw 400;
 if(spec.parent){const parent=input.clientId||input.projectId;const found=await db.prepare(`SELECT id FROM ${spec.parent} WHERE organization_id=? AND id=?`).bind(actor.organization_id,parent).first();if(!found)throw 404;}
 const keys=Object.keys(input),recordId=crypto.randomUUID();
 if(table==='notes'){
  const token=crypto.randomUUID(),statement=db.prepare(`INSERT INTO notes(id,organization_id,${keys.map(k=>columns[k]||k).join(',')},history_token) VALUES(${Array(keys.length+3).fill('?').join(',')}) RETURNING ${noteColumns}`)
   .bind(recordId,actor.organization_id,...keys.map(k=>sqlValue(input[k])),token);
  return json(await commitNote(db,actor,statement,token),201);
 }
 await db.prepare(`INSERT INTO ${table}(id,organization_id,${keys.map(k=>columns[k]||k).join(',')}) VALUES(${Array(keys.length+2).fill('?').join(',')})`)
  .bind(recordId,actor.organization_id,...keys.map(k=>sqlValue(input[k]))).run();
 return json(await db.prepare(`SELECT * FROM ${table} WHERE id=? AND organization_id=?`).bind(recordId,actor.organization_id).first(),201);
}
