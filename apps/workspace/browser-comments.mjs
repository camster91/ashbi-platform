import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {hold} from './browser-regressions.mjs';

const title='QA task revised',literal='<script>window.unwantedCommentScript=true</script> Synthetic internal note';
async function open(page,origin){await page.goto(origin+'/#tasks');await page.getByRole('button',{name:'Comments for '+title,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('region',{name:'Task comments',exact:true}).locator('[aria-busy]').waitFor({state:'detached'});await dialog.getByText('Loading comments…',{exact:true}).waitFor({state:'detached'});return dialog;}
async function post(dialog,content,shared=false){await dialog.getByLabel('Comment',{exact:true}).fill(content);if(shared)await dialog.getByLabel('Share with client',{exact:true}).check();await dialog.getByRole('button',{name:'Post comment',exact:true}).click();await dialog.getByText(content,{exact:true}).waitFor();}
export async function runCommentTests({browser,origin,DB,axe,addActor}){
 const task=await DB.prepare('SELECT * FROM tasks WHERE title=?').bind(title).first(),project=await DB.prepare('SELECT * FROM projects WHERE id=?').bind(task.project_id).first();
 await addActor('qa-second','qa-second@example.invalid','staff',null);await addActor('qa-client','qa-client@example.invalid','client',project.client_id);
 await test('#691 staff comments persist as literal text with internal/share choices and keyboard focus',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await page.goto(origin+'/#tasks');const opener=page.getByRole('button',{name:'Comments for '+title,exact:true});await opener.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await dialog.getByText('No comments yet.',{exact:true}).waitFor();await post(dialog,literal);assert.equal(await page.evaluate(()=>window.unwantedCommentScript),undefined);
  await post(dialog,'Synthetic shared checkpoint',true);assert.equal(await dialog.getByLabel('Share with client',{exact:true}).isChecked(),false);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Comments for QA task revised');assert.equal(await page.getByRole('dialog').count(),0);
  const reloaded=await open(page,origin);assert.equal(await reloaded.getByText(literal,{exact:true}).count(),1);assert.equal(await reloaded.getByText('Synthetic shared checkpoint',{exact:true}).count(),1);
  const records=(await DB.prepare('SELECT * FROM task_comments WHERE task_id=? ORDER BY created_at,id').bind(task.id).all()).results;assert.equal(records.length,2);assert.equal(records.find(r=>r.content===literal).client_visible,0);assert.equal(records.find(r=>r.content==='Synthetic shared checkpoint').client_visible,1);
 });
 await test('#691 lost post success retains the draft and retries the same key without a duplicate',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());const dialog=await open(page,origin),keys=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/comments'))keys.push(request.postDataJSON().requestId);});
  let intercepted=false;await page.route('**/api/tasks/*/comments',async route=>{if(route.request().method()!=='POST'||intercepted)return route.fallback();intercepted=true;const actual=await route.fetch();assert.equal(actual.status(),201);await route.fulfill({status:503,json:{error:'Synthetic lost success response'}});});
  await dialog.getByLabel('Comment',{exact:true}).fill('Retry exactly once');await dialog.getByRole('button',{name:'Post comment',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByLabel('Comment',{exact:true}).inputValue(),'Retry exactly once');
  await dialog.getByRole('button',{name:'Post comment',exact:true}).click();await dialog.getByText('Retry exactly once',{exact:true}).waitFor();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM task_comments WHERE task_id=? AND content=?').bind(task.id,'Retry exactly once').first()).n,1);assert.equal(await dialog.getByLabel('Comment',{exact:true}).inputValue(),'');assert.equal(await dialog.getByRole('alert').count(),0);
 });
 await test('#691 a second signed staff identity can reply to the same task',async t=>{
  const page=await browser.newPage({extraHTTPHeaders:{'X-Test-Actor':'qa-second'}});t.after(()=>page.close());const dialog=await open(page,origin);await post(dialog,'Second staff reply');
  assert.equal((await DB.prepare('SELECT actor_id FROM task_comments WHERE content=?').bind('Second staff reply').first()).actor_id,'qa-second');
 });
 await test('#691 signed client sees only shared comments and replies to its own permitted task',async t=>{
  await DB.prepare('UPDATE projects SET client_visible=1 WHERE id=?').bind(project.id).run();await DB.prepare('UPDATE tasks SET client_visible=1 WHERE id=?').bind(task.id).run();
  const page=await browser.newPage({extraHTTPHeaders:{'X-Test-Actor':'qa-client'}});t.after(()=>page.close());const dialog=await open(page,origin);
  assert.equal(await page.getByRole('button',{name:'Add task',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Edit '+title,exact:true}).count(),0);
  assert.equal(await dialog.getByText(literal,{exact:true}).count(),0);assert.equal(await dialog.getByText('Second staff reply',{exact:true}).count(),0);assert.equal(await dialog.getByText('Synthetic shared checkpoint',{exact:true}).count(),1);assert.equal(await dialog.getByLabel('Share with client',{exact:true}).count(),0);
  await post(dialog,'Client reply');const row=await DB.prepare('SELECT actor_id,client_visible FROM task_comments WHERE content=?').bind('Client reply').first();assert.equal(row.actor_id,'qa-client');assert.equal(row.client_visible,1);
  const denied=await page.evaluate(async()=>({foreign:(await fetch('/api/tasks/board-other/comments')).status,staff:(await fetch('/api/staff')).status}));assert.deepEqual(denied,{foreign:404,staff:403});
 });
 await test('#691 older comments paginate without losing the current reply draft',async t=>{
  await DB.batch(Array.from({length:65},(_,i)=>DB.prepare('INSERT INTO task_comments(id,organization_id,task_id,actor_id,request_id,content,client_visible,created_at) VALUES(?,?,?,?,?,?,?,?)').bind('thread-'+String(i).padStart(3,'0'),'qa-org',task.id,'qa',crypto.randomUUID(),'Older thread '+i,0,1)));
  const total=(await DB.prepare('SELECT COUNT(*) AS n FROM task_comments WHERE task_id=?').bind(task.id).first()).n;
  const page=await browser.newPage();t.after(()=>page.close());const dialog=await open(page,origin);assert.equal(await dialog.locator('article').count(),50);await dialog.getByLabel('Comment',{exact:true}).fill('Keep reply draft');
  await dialog.getByRole('button',{name:'Load older comments',exact:true}).click();await dialog.getByRole('button',{name:'Load older comments',exact:true}).waitFor({state:'detached'});assert.equal(await dialog.locator('article').count(),total);assert.equal(await dialog.getByLabel('Comment',{exact:true}).inputValue(),'Keep reply draft');
 });
 await test('#691 a current thread load failure can retry while preserving the reply draft',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await page.goto(origin+'/#tasks');
  await page.route('**/api/tasks/*/comments',route=>route.fulfill({status:503,json:{error:'Synthetic thread unavailable'}}),{times:1});
  await page.getByRole('button',{name:'Comments for '+title,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByRole('alert').textContent(),'Synthetic thread unavailable');await dialog.getByLabel('Comment',{exact:true}).fill('Keep current retry draft');
  await dialog.getByRole('button',{name:'Retry comments',exact:true}).click();await dialog.getByText('Newest comments first.',{exact:true}).waitFor();assert.equal(await dialog.getByRole('alert').count(),0);assert.equal(await dialog.getByLabel('Comment',{exact:true}).inputValue(),'Keep current retry draft');
 });
 for(const failure of [false,true])await test('#704 closed older-comment page '+(failure?'failure':'success')+' cannot affect a reopened thread',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());let dialog=await open(page,origin);const delayed=await hold(page,'**/api/tasks/*/comments?after=*');
  await dialog.getByRole('button',{name:'Load older comments',exact:true}).click();await delayed.entered;await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Comments for '+title,exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByText('Newest comments first.',{exact:true}).waitFor();await dialog.getByLabel('Comment',{exact:true}).fill('New paging draft');
  await delayed.release(failure?{status:503,json:{error:'Stale older-page error'}}:{json:{items:[{id:'stale-older',actor_id:'qa',content:'Stale older comment',created_at:0,client_visible:0}],nextCursor:null}});
  assert.equal(await dialog.locator('article').count(),50);assert.equal(await dialog.getByText('Stale older comment',{exact:true}).count(),0);assert.equal(await dialog.getByLabel('Comment',{exact:true}).inputValue(),'New paging draft');assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.locator(':focus').getAttribute('name'),'content');
 });
 for(const failure of [false,true])await test('#704 closed comment request '+(failure?'failure':'success')+' cannot affect a reopened dialog',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await page.goto(origin+'/#tasks');const delayed=await hold(page,'**/api/tasks/*/comments');
  await page.getByRole('button',{name:'Comments for '+title,exact:true}).click();await delayed.entered;await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Comments for '+title,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByText('Newest comments first.',{exact:true}).waitFor();await dialog.getByLabel('Comment',{exact:true}).fill('New dialog draft');
  await delayed.release(failure?{status:503,json:{error:'Stale comment error'}}:{json:{items:[{id:'stale',actor_id:'qa',content:'Stale comment',created_at:0,client_visible:0}],nextCursor:null}});
  assert.equal(await dialog.getByLabel('Comment',{exact:true}).inputValue(),'New dialog draft');assert.equal(await page.getByRole('alert').count(),0);assert.equal(await dialog.getByText('Stale comment',{exact:true}).count(),0);assert.equal(await page.locator(':focus').getAttribute('name'),'content');
 });
 for(const failure of [false,true])await test('#704 closed comment post '+(failure?'failure':'success')+' cannot refresh Files or move focus',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());const dialog=await open(page,origin),delayed=await hold(page,'**/api/tasks/*/comments');
  await dialog.getByLabel('Comment',{exact:true}).fill('Delayed post');await dialog.getByRole('button',{name:'Post comment',exact:true}).click();await delayed.entered;await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
  await page.getByRole('link',{name:'Files',exact:true}).click();await page.getByRole('heading',{name:'Upload private file',exact:true}).waitFor();await page.getByRole('link',{name:'Tasks',exact:true}).focus();
  await delayed.release(failure?{status:503,json:{error:'Stale post error'}}:{json:{id:'synthetic-post'}});
  assert.equal(new URL(page.url()).hash,'#files');assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.locator(':focus').textContent(),'Tasks');assert.equal(await page.getByRole('heading',{name:'Files',exact:true}).count(),1);
 });
 await test('#691 comment modal fits phone/tablet/desktop and passes axe with keyboard dismissal',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());const dialog=await open(page,origin);await page.evaluate(axe);
  for(const width of [390,768,1440]){
   const height=width===390?844:1000;await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth),true);const submit=await dialog.getByRole('button',{name:'Post comment',exact:true}).boundingBox();assert.ok(submit.y>=0&&submit.y+submit.height<=height,'Post comment remains visible in the viewport');
   const issues=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>v.id);});assert.deepEqual(issues,[]);
   if(process.env.WORKSPACE_TEST_OUTPUT_DIR)await page.screenshot({path:join(process.env.WORKSPACE_TEST_OUTPUT_DIR,'task-comments-'+width+'.png')});
  }
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Comments for QA task revised');assert.equal(await page.getByRole('dialog').count(),0);
 });
}
