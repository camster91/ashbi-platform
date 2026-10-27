import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {records} from './records.mjs';
import {dashboardTasks} from './dashboard.mjs';

test('status migration retains existing records and references, and source states stay distinct through API and dashboard',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'statuses'},cf:false});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 const migrate=async name=>{const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));};
 for(const name of(await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')&&n<'0027.sql').sort())await migrate(name);
 await DB.prepare("INSERT INTO actors VALUES('staff','staff@example.invalid','a','staff',NULL,1)").run();
 await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('client','a','Client')").run();
 await DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,revision,client_visible,status) VALUES('project','a','client','Project',7,1,'complete')").run();
 await DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status,revision,client_visible,assignee_id,due_on) VALUES('task','a','project','Task','done',5,1,'staff','2026-01-01')").run();
 await DB.prepare("INSERT INTO task_comments(id,organization_id,task_id,actor_id,request_id,content,client_visible,created_at) VALUES('comment','a','task','staff','request','Retained comment',1,1)").run();
 await DB.prepare("INSERT INTO notes(id,organization_id,project_id,title,text) VALUES('note','a','project','Document','Retained bytes')").run();
 const beforeProject=await DB.prepare('SELECT * FROM projects').first(),beforeTask=await DB.prepare('SELECT * FROM tasks').first();
 await migrate('0027.sql');
 assert.deepEqual(await DB.prepare('SELECT * FROM projects').first(),beforeProject);assert.deepEqual(await DB.prepare('SELECT * FROM tasks').first(),beforeTask);assert.equal((await DB.prepare('SELECT * FROM task_comments').first()).content,'Retained comment');assert.equal((await DB.prepare('SELECT * FROM notes').first()).text,'Retained bytes');assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
 await migrate('0028.sql');
 const actor={id:'staff',organization_id:'a',role:'staff',client_id:null},json=(data,status=200)=>({data,status}),request=(path,method='GET')=>new Request('https://workspace.invalid/api/'+path,{method});
 for(const status of ['review','waiting','later','retired','archived']){
  const created=await records(request('tasks','POST'),DB,actor,'tasks',null,{title:status,projectId:'project',clientVisible:false,status,dueOn:'2000-01-01'},json);assert.equal(created.status,201);assert.equal(created.data.status,status);
  const filtered=await dashboardTasks(request('dashboard/tasks?status='+status),DB,actor,json);assert.equal(filtered.data.items.length,1);assert.equal(filtered.data.items[0].status,status);assert.equal(filtered.data.items[0].overdue,['review','waiting'].includes(status));
 }
 const open=await dashboardTasks(request('dashboard/tasks'),DB,actor,json);assert.deepEqual(open.data.items.map(r=>r.status).sort(),['later','review','waiting']);
 const overdue=await dashboardTasks(request('dashboard/tasks?status=all&due=overdue'),DB,actor,json);assert.deepEqual(overdue.data.items.map(r=>r.status).sort(),['review','waiting']);
 for(const status of ['waiting','canceled']){const current=await DB.prepare("SELECT revision FROM projects WHERE id='project'").first();const updated=await records(request('projects/project','PATCH'),DB,actor,'projects','project',{status,revision:current.revision},json);assert.equal(updated.data.status,status);}
 await assert.rejects(()=>records(request('tasks','POST'),DB,actor,'tasks',null,{title:'Unknown',projectId:'project',clientVisible:false,status:'mystery'},json),e=>e===400);
 await assert.rejects(()=>DB.prepare("UPDATE tasks SET status='mystery'").run());assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
