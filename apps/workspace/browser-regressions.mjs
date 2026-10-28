import test from 'node:test';
import assert from 'node:assert/strict';

// Requests are held explicitly, rather than racing a timeout against navigation.
export async function hold(page,pattern){
 let release,arrive,done,request;const errors=[],pageError=e=>errors.push(e.message);page.on('pageerror',pageError);
 const gate=new Promise(r=>release=r),entered=new Promise(r=>arrive=r),finished=new Promise(r=>done=r);
 await page.route(pattern,async route=>{if(request)return route.fallback();request=route.request();arrive();try{await route.fulfill(await gate);done();}catch(e){done(e);}});
 return {get entered(){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{page.off('pageerror',pageError);reject(Error('Held request did not arrive: '+pattern+' '+JSON.stringify({errors,url:page.url(),closed:page.isClosed()})));},30000);entered.then(()=>{clearTimeout(timeout);resolve();},reject);});},async release(response){release(response);const error=await finished;if(error)throw error;const received=await request.response();assert.ok(received,'held response was delivered');await received.finished();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));page.off('pageerror',pageError);}};
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
 await test('#769 compact record actions preserve accessible names and Cancel never submits the form',async t=>{
  const project=await DB.prepare("SELECT id FROM projects WHERE name='QA project'").first();
  await DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status,client_visible) VALUES('record-actions-task','qa-org',?,'Record action fixture','todo',0)").bind(project.id).run();
  const page=await browser.newPage();let writes=0;page.on('request',request=>{if(request.method()==='PATCH'&&new URL(request.url()).pathname==='/api/tasks/record-actions-task')writes++;});
  t.after(async()=>{await page.close();await DB.prepare("DELETE FROM tasks WHERE id='record-actions-task'").run();});
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1000});await ready(page,origin,'tasks');
   const opener=page.getByRole('button',{name:'Edit Record action fixture',exact:true});assert.equal(await opener.textContent(),'Edit task');
   for(const draft of ['', 'Unsaved edit']){
    await opener.click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Name',{exact:true}).fill(draft);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});
    assert.equal(await opener.evaluate(element=>element===document.activeElement),true);
    assert.equal((await DB.prepare("SELECT title FROM tasks WHERE id='record-actions-task'").first()).title,'Record action fixture');
    assert.equal(writes,0);
   }
  }
 });
 await test('#767 mobile active route stays visible on direct links, route changes and resize without moving document focus',async t=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});t.after(()=>page.close());
  const activeVisible=()=>page.evaluate(()=>{const nav=document.querySelector('nav'),active=nav.querySelector('[aria-current=page]'),n=nav.getBoundingClientRect(),a=active.getBoundingClientRect();return a.left>=n.left&&a.right<=n.right;});
  await page.goto(origin+'/#time');await page.getByRole('heading',{name:'Time',exact:true}).waitFor();await page.locator('main[aria-busy]').waitFor({state:'detached'});await page.evaluate(()=>document.fonts.ready);
  assert.equal(await activeVisible(),true);
  for(const route of ['overview','time']){
   await page.evaluate(route=>{location.hash='#'+route;},route);await page.getByRole('heading',{name:route==='time'?'Time':'Overview',exact:true}).waitFor();await page.locator('main[aria-busy]').waitFor({state:'detached'});
   assert.equal(await activeVisible(),true);
  }
  await page.setViewportSize({width:1440,height:844});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  assert.equal(await activeVisible(),true);
  const before=await page.evaluate(()=>{document.querySelector('main').focus();window.scrollTo(0,250);document.querySelector('nav').scrollLeft=0;return {y:scrollY,focus:document.activeElement.id};});
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  assert.equal(await activeVisible(),true);assert.deepEqual(await page.evaluate(()=>({y:scrollY,focus:document.activeElement.id})),before);
 });
 await test('#767 task and project labels are readable while edits retain their stored status values',async t=>{
  const project=await DB.prepare("SELECT id FROM projects WHERE name='QA project'").first();
  await DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status,client_visible) VALUES('presentation-task','qa-org',?,'Presentation status task','done',0)").bind(project.id).run();
  const page=await browser.newPage();t.after(async()=>{await page.close();await DB.prepare("DELETE FROM tasks WHERE id='presentation-task'").run();});await ready(page,origin,'tasks');
  await page.getByRole('button',{name:'Edit Presentation status task',exact:true}).click();const dialog=page.getByRole('dialog'),status=dialog.getByLabel('Status',{exact:true});
  assert.equal(await status.locator('option[value=todo]').textContent(),'To do');assert.equal(await status.locator('option[value=doing]').textContent(),'In progress');
  await status.selectOption({label:'In progress'});await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'detached'});
  const item=page.locator('article').filter({has:page.getByText('Presentation status task',{exact:true})});await item.getByText('In progress',{exact:true}).waitFor();
  assert.equal((await DB.prepare("SELECT status FROM tasks WHERE id='presentation-task'").first()).status,'doing');
  await page.getByRole('link',{name:'Projects',exact:true}).click();await page.getByRole('button',{name:'Edit QA project',exact:true}).click();
  assert.equal(await page.getByRole('dialog').getByLabel('Status',{exact:true}).locator('option:checked').textContent(),'Active');
  assert.equal(await page.getByRole('dialog').getByLabel('Status',{exact:true}).inputValue(),'active');
 });
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
