import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {runProjectArchiveTests} from './browser-project-archive.mjs';
import {hold} from './browser-regressions.mjs';

const reviewTitle='QA board review: '+('a long project handoff title to wrap on small screens ').repeat(3).trim();
async function tasks(page,origin){await page.goto(origin+'/#tasks');await page.getByLabel('Status filter',{exact:true}).waitFor();await page.locator('main[aria-busy]').waitFor({state:'detached'});}
export async function runTaskBoardTests({browser,origin,DB,axe}){
 await runProjectArchiveTests({browser,origin,DB});
 const project=await DB.prepare("SELECT id FROM projects WHERE name='QA project'").first();
 await DB.batch([
  DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('board-client','qa-org','QA board client')"),
  DB.prepare("INSERT INTO projects(id,organization_id,client_id,name) VALUES('board-project','qa-org','board-client','QA second project')"),
  DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status,assignee_id) VALUES('board-review','qa-org',?,?,'doing','qa')").bind(project.id,reviewTitle),
  DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status) VALUES('board-other','qa-org','board-project','QA other project','todo')"),
 ]);
 await test('task filters find matching work beyond the first fifty records',async t=>{
  const page=await browser.newPage();t.after(async()=>{await page.close();await DB.prepare("DELETE FROM tasks WHERE id LIKE 'filter-proof-%'").run();});
  await DB.batch(Array.from({length:55},(_,i)=>DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status) VALUES(?,'qa-org',?,'Earlier distractor','todo')").bind('filter-proof-'+String(i).padStart(3,'0'),project.id)).concat([DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status) VALUES('filter-proof-z','qa-org',?,'Needle late task','waiting')").bind(project.id)]));
  await tasks(page,origin);await page.getByLabel('Name',{exact:true}).fill('Keep search draft');
  await page.getByLabel('Status filter',{exact:true}).selectOption('waiting');await page.locator('main[aria-busy]').waitFor({state:'detached'});
  await page.locator('main[aria-busy]').waitFor({state:'detached'});
  assert.equal(await page.getByRole('button',{name:'Edit Needle late task',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Keep search draft');
  await page.getByLabel('Search tasks',{exact:true}).fill('Needle');await page.getByRole('button',{name:'Search tasks',exact:true}).click();
  await page.getByRole('button',{name:'Edit Needle late task',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Search tasks',{exact:true}).inputValue(),'Needle');
  await page.getByLabel('Assignee filter',{exact:true}).selectOption('unassigned');await page.locator('main[aria-busy]').waitFor({state:'detached'});await page.getByRole('button',{name:'Edit Needle late task',exact:true}).waitFor();
  await page.getByRole('button',{name:'Clear task filters',exact:true}).click();await page.getByLabel('Status filter',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Status filter',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Search tasks',{exact:true}).inputValue(),'');
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Keep search draft');
 });
 for(const pagination of [false,true])for(const failure of [false,true])await test('superseded task '+(pagination?'pagination':'filter')+' '+(failure?'failure':'success')+' preserves the current query, draft and focus',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await tasks(page,origin);
  let pending;
  if(pagination){
   await page.route('**/api/tasks?status=waiting',route=>route.fulfill({json:{items:[{id:'waiting-first',title:'Earlier waiting result',status:'waiting'}],nextCursor:'waiting-first'}}));
   await page.getByLabel('Status filter',{exact:true}).selectOption('waiting');await page.locator('main[aria-busy]').waitFor({state:'detached'});await page.getByRole('button',{name:'Load more',exact:true}).waitFor();
   pending=await hold(page,'**/api/tasks?status=waiting&after=waiting-first');await page.getByRole('button',{name:'Load more',exact:true}).click();
  }else{
   pending=await hold(page,'**/api/tasks?status=waiting');await page.getByLabel('Status filter',{exact:true}).selectOption('waiting');
  }
  await pending.entered;
  // The old request remains outstanding while a new visit obtains a different result.
  if(!pagination){await page.getByRole('link',{name:'Files',exact:true}).click();await page.getByRole('heading',{name:'Upload private file',exact:true}).waitFor();await page.getByRole('link',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Edit QA task revised',exact:true}).waitFor();}
  await page.getByLabel('Status filter',{exact:true}).selectOption('done');await page.locator('main[aria-busy]').waitFor({state:'detached'});await page.getByRole('button',{name:'Edit QA task revised',exact:true}).waitFor();
  await page.getByLabel('Name',{exact:true}).fill('Current unsaved task');await page.getByLabel('Name',{exact:true}).focus();
  await pending.release(failure?{status:503,contentType:'application/json',body:JSON.stringify({error:'Old filter failed'})}:{json:{items:[{id:'stale-filter',title:'Stale filter result',status:'waiting'}],nextCursor:'stale-more'}});
  assert.equal(await page.getByRole('button',{name:'Edit Stale filter result',exact:true}).count(),0);assert.equal(await page.getByRole('alert').count(),0);
  assert.equal(await page.getByLabel('Status filter',{exact:true}).inputValue(),'done');assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Current unsaved task');
  assert.equal(await page.locator(':focus').getAttribute('name'),'title');assert.equal(await page.locator('main').getAttribute('aria-busy'),null);
 });
 await test('current task search failure retries the same filter and retains the create draft',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await tasks(page,origin);await page.getByLabel('Name',{exact:true}).fill('Retry draft');
  await page.route('**/api/tasks?q=retry-proof',route=>route.fulfill({status:503,json:{error:'Search unavailable'}}),{times:1});
  await page.getByLabel('Search tasks',{exact:true}).fill('retry-proof');await page.getByRole('button',{name:'Search tasks',exact:true}).click();await page.getByRole('alert').waitFor();
  const retry=page.waitForRequest('**/api/tasks?q=retry-proof');await page.getByRole('button',{name:'Try again',exact:true}).click();await retry;await page.getByLabel('Search tasks',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Search tasks',{exact:true}).inputValue(),'retry-proof');assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Retry draft');assert.equal(await page.getByRole('alert').count(),0);
 });
 await test('#691 List/Board and filters use the same records and retain the create draft',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await tasks(page,origin);
  assert.equal(await page.getByRole('button',{name:'List',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByLabel('Name',{exact:true}).fill('Keep unsaved task');
  await page.getByRole('button',{name:'Board',exact:true}).click();
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Keep unsaved task');
  const board=page.getByRole('region',{name:'Tasks board',exact:true});
  assert.equal(await board.getByRole('region',{name:'To do',exact:true}).getByText('QA other project',{exact:true}).count(),1);
  assert.equal(await board.getByRole('region',{name:'In progress',exact:true}).getByText(reviewTitle,{exact:true}).count(),1);
  assert.equal(await board.getByRole('region',{name:'Done',exact:true}).getByText('QA task revised',{exact:true}).count(),1);
  await page.getByLabel('Project filter',{exact:true}).selectOption(project.id);await page.locator('main[aria-busy]').waitFor({state:'detached'});
  assert.equal(await board.getByText('QA other project',{exact:true}).count(),0);
  await page.getByLabel('Status filter',{exact:true}).selectOption('doing');await page.locator('main[aria-busy]').waitFor({state:'detached'});
  await page.getByLabel('Assignee filter',{exact:true}).selectOption('qa');await page.locator('main[aria-busy]').waitFor({state:'detached'});
  assert.equal(await board.locator('article').count(),1);
  assert.equal(await board.getByText(reviewTitle,{exact:true}).count(),1);
  await page.getByLabel('Project filter',{exact:true}).selectOption('board-project');await page.locator('main[aria-busy]').waitFor({state:'detached'});
  assert.equal(await board.locator('article').count(),0);
  await page.getByLabel('Project filter',{exact:true}).selectOption('');await page.locator('main[aria-busy]').waitFor({state:'detached'});await page.getByLabel('Status filter',{exact:true}).selectOption('');await page.locator('main[aria-busy]').waitFor({state:'detached'});await page.getByLabel('Assignee filter',{exact:true}).selectOption('');await page.locator('main[aria-busy]').waitFor({state:'detached'});
  assert.equal(await board.locator('article').count(),3);
  await page.getByRole('button',{name:'List',exact:true}).click();assert.equal(await page.getByRole('region',{name:'Tasks list',exact:true}).locator('article').count(),3);
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Keep unsaved task');
 });
 await test('#691 filtered pages retain their query and Board survives Load more',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());
  await page.route('**/api/tasks',route=>route.fulfill({json:{items:Array.from({length:50},(_,i)=>({id:'page-'+i,title:'Page task '+i,status:'todo',project_id:project.id})),nextCursor:'page-49'}}));
  await page.route('**/api/tasks?status=doing',route=>route.fulfill({json:{items:Array.from({length:50},(_,i)=>({id:'match-'+i,title:'Matching task '+i,status:'doing',project_id:project.id})),nextCursor:'match-49'}}));
  await page.route('**/api/tasks?status=doing&after=*',route=>route.fulfill({json:{items:[{id:'last',title:'Last page task',status:'doing',project_id:project.id}],nextCursor:null}}));
  await page.goto(origin+'/#tasks');await page.getByRole('button',{name:'Load more',exact:true}).waitFor();
  await page.getByRole('button',{name:'Board',exact:true}).click();await page.getByLabel('Status filter',{exact:true}).selectOption('doing');await page.locator('main[aria-busy]').waitFor({state:'detached'});
  await page.getByText('Matching task 0',{exact:true}).waitFor();
  assert.equal(await page.getByRole('status').textContent(),'50 matching tasks loaded. More matches are available.');
  await page.getByRole('button',{name:'Load more',exact:true}).click();await page.getByText('Last page task',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Board',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByLabel('Status filter',{exact:true}).inputValue(),'doing');
  assert.equal(await page.getByRole('status').textContent(),'51 matching tasks loaded.');assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
 });
 await test('#691 keyboard edit moves a task using the existing status/revision contract and persists',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await tasks(page,origin);await page.getByRole('button',{name:'Board',exact:true}).click();
  await page.getByRole('button',{name:'Edit '+reviewTitle,exact:true}).focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Status',{exact:true}).selectOption('done');await dialog.getByRole('button',{name:'Save',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor({state:'detached'});await page.getByRole('region',{name:'Done',exact:true}).getByText(reviewTitle,{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Board',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal((await DB.prepare("SELECT status FROM tasks WHERE id='board-review'").first()).status,'done');
  await page.reload();await page.getByRole('button',{name:'Edit '+reviewTitle,exact:true}).waitFor();
  assert.equal(await page.locator('article').filter({has:page.getByText(reviewTitle,{exact:true})}).getByText('done',{exact:true}).count(),1);
 });
 await test('#691 a concurrent task edit retains the local draft and refuses to overwrite',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await tasks(page,origin);await page.getByRole('button',{name:'Board',exact:true}).click();
  await page.getByRole('button',{name:'Edit '+reviewTitle,exact:true}).click();
  await DB.prepare("UPDATE tasks SET status='todo',revision=revision+1 WHERE id='board-review'").run();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Status',{exact:true}).selectOption('doing');await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByRole('alert').textContent(),'Record changed; reload and try again');assert.equal(await dialog.getByLabel('Status',{exact:true}).inputValue(),'doing');
  assert.equal((await DB.prepare("SELECT status FROM tasks WHERE id='board-review'").first()).status,'todo');
  await page.keyboard.press('Escape');await page.reload();await page.getByRole('button',{name:'Edit '+reviewTitle,exact:true}).waitFor();
  assert.equal(await page.locator('article').filter({has:page.getByText(reviewTitle,{exact:true})}).getByText('todo',{exact:true}).count(),1);
 });
 await test('#691 Board is usable at phone/tablet/desktop widths with axe A/AA checks',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());await tasks(page,origin);await page.getByRole('button',{name:'Board',exact:true}).click();await page.evaluate(axe);
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>v.id);});assert.deepEqual(violations,[]);
   if(process.env.WORKSPACE_TEST_OUTPUT_DIR){await mkdir(process.env.WORKSPACE_TEST_OUTPUT_DIR,{recursive:true});await page.screenshot({path:join(process.env.WORKSPACE_TEST_OUTPUT_DIR,'task-board-'+width+'.png'),fullPage:true});}
   console.log(JSON.stringify({taskBoardWidth:width,overflow:false,axeViolations:0}));
  }
 });
 await test('imported task states retain their own board columns and terminal tasks have no completion shortcut',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());
  const states={review:'Review',waiting:'Waiting',later:'Later',retired:'Retired',archived:'Archived'};
  await page.route('**/api/tasks*',route=>{const filter=new URL(route.request().url()).searchParams.get('status');return route.fulfill({json:{items:Object.keys(states).filter(status=>!filter||status===filter).map(status=>({id:'import-'+status,title:'Imported '+status,status,project_id:project.id,revision:0,client_visible:0})),nextCursor:null}});});
  await page.goto(origin+'/#tasks');await page.getByText('Imported waiting',{exact:true}).waitFor();await page.getByRole('button',{name:'Board',exact:true}).click();
  for(const [status,label]of Object.entries(states)){
   await page.getByLabel('Status filter',{exact:true}).selectOption('');await page.locator('main[aria-busy]').waitFor({state:'detached'});
   const column=page.getByRole('region',{name:label,exact:true});assert.equal(await column.getByText('Imported '+status,{exact:true}).count(),1);
   await page.getByLabel('Status filter',{exact:true}).selectOption(status);await page.locator('main[aria-busy]').waitFor({state:'detached'});assert.equal(await page.getByRole('region',{name:'Tasks board',exact:true}).locator('article').count(),1);
   assert.equal(await column.getByRole('button',{name:'Complete task',exact:true}).count(),['retired','archived'].includes(status)?0:1);
  }
  await page.getByRole('link',{name:'Skip to content',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(new URL(page.url()).hash,'#tasks');assert.equal(await page.locator(':focus').getAttribute('id'),'main');
 });
}
