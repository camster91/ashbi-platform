import test from 'node:test';
import assert from 'node:assert/strict';

// Requests are held explicitly, rather than racing a timeout against navigation.
export async function hold(page,pattern){
 let release,arrive,done,request;
 const gate=new Promise(r=>release=r),entered=new Promise(r=>arrive=r),finished=new Promise(r=>done=r);
 await page.route(pattern,async route=>{if(request)return route.fallback();request=route.request();arrive();try{await route.fulfill(await gate);done();}catch(e){done(e);}});
 return {entered,async release(response){release(response);const error=await finished;if(error)throw error;const received=await request.response();assert.ok(received,'held response was delivered');await received.finished();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}};
}
const json=data=>({status:200,contentType:'application/json',body:JSON.stringify(data)});
const failed={status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic delayed failure'})};
async function ready(page,origin,route){await page.goto(origin+'/#'+route);await page.locator(route==='overview'?'.stats':'section[aria-label="'+(route==='tasks'?'Tasks':'Files')+' list"]').waitFor();await page.locator('main[aria-busy]').waitFor({state:'detached'});}
async function tasksRemain(page){
 assert.equal(new URL(page.url()).hash,'#tasks');
 assert.equal(await page.locator('h1').textContent(),'Tasks');
 assert.equal(await page.getByRole('button',{name:'Edit QA task revised',exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'Edit Delayed client',exact:true}).count(),0);
 assert.equal(await page.getByRole('alert').count(),0);
}
export async function runRegressions({browser,origin,DB}){
 await test('#704 delayed route success cannot replace Tasks records, controls or focus',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await ready(page,origin,'tasks');
  const old=await hold(page,'**/api/clients');
  await page.getByRole('link',{name:'Clients',exact:true}).click();await old.entered;
  await page.getByRole('link',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Edit QA task revised',exact:true}).waitFor();
  await page.getByRole('link',{name:'Files',exact:true}).focus();
  await old.release(json({items:[{id:'delayed-client',name:'Delayed client'}],nextCursor:'stale-cursor'}));
  await tasksRemain(page);assert.equal(await page.locator(':focus').textContent(),'Files');
  assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
 });
 for(const failure of [false,true])await test('#704 stale '+(failure?'failure':'success')+' leaves newer loading state and focus intact',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await ready(page,origin,'tasks');
  const old=await hold(page,'**/api/clients'),current=await hold(page,'**/api/tasks');
  await page.getByRole('link',{name:'Clients',exact:true}).click();await old.entered;
  await page.getByRole('link',{name:'Tasks',exact:true}).click();await current.entered;
  await page.getByRole('link',{name:'Tasks',exact:true}).focus();
  await old.release(failure?failed:json({items:[{id:'delayed-client',name:'Delayed client'}],nextCursor:null}));
  try{
   assert.equal(await page.locator('main').getAttribute('aria-busy'),'true');
   assert.equal(await page.locator('h1').textContent(),'Tasks');
   assert.equal(await page.getByText('Loading…',{exact:true}).count(),1);
   assert.equal(await page.getByRole('alert').count(),0);
   assert.equal(await page.locator(':focus').textContent(),'Tasks');
  }finally{await current.release(json({items:[{id:'held-task',title:'Current task',status:'todo'}],nextCursor:null}));}
  await page.getByText('Current task',{exact:true}).waitFor();
 });
 for(const destination of ['tasks','clients'])for(const failure of [false,true])await test('#704 stale pagination '+(failure?'failure':'success')+' cannot affect a newer '+destination+' visit',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await ready(page,origin,'tasks');
  await page.route('**/api/clients',route=>route.fulfill(json({items:[{id:'first-client',name:'First client'}],nextCursor:'first-client'})),{times:1});
  await page.getByRole('link',{name:'Clients',exact:true}).click();await page.getByRole('button',{name:'Load more',exact:true}).waitFor();
  const more=await hold(page,'**/api/clients?after=*');
  await page.getByRole('button',{name:'Load more',exact:true}).click();await more.entered;
  await page.getByRole('link',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Edit QA task revised',exact:true}).waitFor();
  if(destination==='clients'){await page.getByRole('link',{name:'Clients',exact:true}).click();await page.getByRole('button',{name:'Edit QA client',exact:true}).waitFor();}
  await page.getByLabel('Name',{exact:true}).fill('Keep unsaved value');await page.getByLabel('Name',{exact:true}).focus();
  await more.release(failure?failed:json({items:[{id:'delayed-client',name:'Delayed client'}],nextCursor:'stale-cursor'}));
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Keep unsaved value');
  assert.equal(await page.locator(':focus').getAttribute('name'),destination==='tasks'?'title':'name');
  assert.equal(await page.getByRole('button',{name:'Edit Delayed client',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
  assert.equal(await page.getByRole('alert').count(),0);
  assert.equal(new URL(page.url()).hash,'#'+destination);
 });
 for(const failure of [false,true])await test('#704 stale task action '+(failure?'failure':'success')+' does not refresh or report into Clients',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await ready(page,origin,'tasks');
  const action=await hold(page,'**/api/tasks/*');
  await page.getByRole('button',{name:'Reopen task',exact:true}).click();await action.entered;
  await page.getByRole('link',{name:'Clients',exact:true}).click();await page.getByRole('button',{name:'Edit QA client',exact:true}).waitFor();
  await page.getByLabel('Name',{exact:true}).fill('Keep client draft');await page.getByLabel('Name',{exact:true}).focus();
  await action.release(failure?failed:json({status:'todo'}));
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Keep client draft');
  assert.equal(await page.locator(':focus').getAttribute('name'),'name');assert.equal(await page.getByRole('alert').count(),0);
 });
 await test('#704 current pagination and current failure/retry still work',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await ready(page,origin,'tasks');
  await page.route('**/api/clients',route=>route.fulfill(json({items:[{id:'first-client',name:'First client'}],nextCursor:'first-client'})),{times:1});
  await page.getByRole('link',{name:'Clients',exact:true}).click();await page.getByRole('button',{name:'Load more',exact:true}).waitFor();
  const more=await hold(page,'**/api/clients?after=*');
  await page.getByRole('button',{name:'Load more',exact:true}).click();await more.entered;
  await more.release(json({items:[{id:'second-client',name:'Second client'}],nextCursor:null}));
  assert.equal(await page.getByRole('button',{name:'Edit First client',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Edit Second client',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
  await page.route('**/api/tasks',route=>route.fulfill(failed),{times:1});
  await page.getByRole('link',{name:'Tasks',exact:true}).click();await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('alert').textContent(),'Synthetic delayed failure');
  await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('button',{name:'Edit QA task revised',exact:true}).waitFor();await tasksRemain(page);
 });
 for(const route of ['tasks','files','overview'])await test('#706 keyboard skip preserves '+route+' route, records and main focus',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await ready(page,origin,route);
  const before=await page.locator('main').innerText(),url=page.url();
  await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').textContent(),'Skip to content');
  const box=await page.locator(':focus').boundingBox();assert.ok(box.y>=0,'skip link is visible');
  await page.keyboard.press('Enter');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(page.url(),url);assert.equal(await page.locator('main').innerText(),before);
  assert.equal(await page.locator(':focus').getAttribute('id'),'main');
 });
 await test('#705 active timer remains stoppable beyond 100 newer completed entries',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await ready(page,origin,'overview');
  const project=await DB.prepare("SELECT id FROM projects WHERE name='QA project'").first();
  const call=(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{path,body});
  const start=await call('timer/start',{projectId:project.id});assert.equal(start.status,201);
  await DB.prepare('UPDATE time_entries SET started_at=0 WHERE id=?').bind(start.data.id).run();
  await DB.batch(Array.from({length:105},(_,i)=>DB.prepare('INSERT INTO time_entries(id,organization_id,project_id,actor_id,started_at,ended_at,seconds) VALUES(?,?,?,?,?,?,?)').bind('history-'+i,'qa-org',project.id,'qa',1000+i,61000+i,60)));
  await page.getByRole('link',{name:'Time',exact:true}).click();await page.getByRole('heading',{name:'Track time',exact:true}).waitFor();
  const stop=page.getByRole('button',{name:'Stop timer',exact:true});
  assert.equal(await stop.count(),1,'running timer has a Stop button');
  await stop.click();await stop.waitFor({state:'detached'});
  assert.equal((await call('timer/'+start.data.id+'/stop',{})).status,404);
  const stopped=await DB.prepare('SELECT ended_at,seconds FROM time_entries WHERE id=?').bind(start.data.id).first();assert.ok(stopped.ended_at);assert.ok(stopped.seconds>0);
  await page.locator('select[name=projectId]').selectOption(project.id);await page.getByRole('button',{name:'Start timer',exact:true}).click();await stop.waitFor();await stop.click();await stop.waitFor({state:'detached'});
 });
}
