import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

const reviewTitle='QA board review: '+('a long project handoff title to wrap on small screens ').repeat(3).trim();
async function tasks(page,origin){await page.goto(origin+'/#tasks');await page.getByRole('button',{name:'Edit QA task revised',exact:true}).waitFor();}
export async function runTaskBoardTests({browser,origin,DB,axe}){
 const project=await DB.prepare("SELECT id FROM projects WHERE name='QA project'").first();
 await DB.batch([
  DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('board-client','qa-org','QA board client')"),
  DB.prepare("INSERT INTO projects(id,organization_id,client_id,name) VALUES('board-project','qa-org','board-client','QA second project')"),
  DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status,assignee_id) VALUES('board-review','qa-org',?,?,'doing','qa')").bind(project.id,reviewTitle),
  DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status) VALUES('board-other','qa-org','board-project','QA other project','todo')"),
 ]);
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
  await page.getByLabel('Project filter',{exact:true}).selectOption(project.id);
  assert.equal(await board.getByText('QA other project',{exact:true}).count(),0);
  await page.getByLabel('Status filter',{exact:true}).selectOption('doing');
  await page.getByLabel('Assignee filter',{exact:true}).selectOption('qa');
  assert.equal(await board.locator('article').count(),1);
  assert.equal(await board.getByText(reviewTitle,{exact:true}).count(),1);
  await page.getByLabel('Project filter',{exact:true}).selectOption('board-project');
  assert.equal(await board.locator('article').count(),0);
  await page.getByLabel('Project filter',{exact:true}).selectOption('');await page.getByLabel('Status filter',{exact:true}).selectOption('');await page.getByLabel('Assignee filter',{exact:true}).selectOption('');
  assert.equal(await board.locator('article').count(),3);
  await page.getByRole('button',{name:'List',exact:true}).click();assert.equal(await page.getByRole('region',{name:'Tasks list',exact:true}).locator('article').count(),3);
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Keep unsaved task');
 });
 await test('#691 filters describe bounded history and Board survives Load more',async t=>{
  const page=await browser.newPage();t.after(()=>page.close());
  await page.route('**/api/tasks',route=>route.fulfill({json:{items:Array.from({length:50},(_,i)=>({id:'page-'+i,title:'Page task '+i,status:'todo',project_id:project.id})),nextCursor:'page-49'}}));
  await page.route('**/api/tasks?after=*',route=>route.fulfill({json:{items:[{id:'last',title:'Last page task',status:'doing',project_id:project.id}],nextCursor:null}}));
  await page.goto(origin+'/#tasks');await page.getByRole('button',{name:'Load more',exact:true}).waitFor();
  await page.getByRole('button',{name:'Board',exact:true}).click();await page.getByLabel('Status filter',{exact:true}).selectOption('doing');
  assert.equal(await page.getByRole('status').textContent(),'0 of 50 loaded tasks. More tasks are available; load more to include them.');
  await page.getByRole('button',{name:'Load more',exact:true}).click();await page.getByText('Last page task',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Board',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByLabel('Status filter',{exact:true}).inputValue(),'doing');
  assert.equal(await page.getByRole('status').textContent(),'1 of 51 loaded tasks.');assert.equal(await page.getByRole('button',{name:'Load more',exact:true}).count(),0);
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
  await page.route('**/api/tasks',route=>route.fulfill({json:{items:Object.keys(states).map(status=>({id:'import-'+status,title:'Imported '+status,status,project_id:project.id,revision:0,client_visible:0})),nextCursor:null}}));
  await page.goto(origin+'/#tasks');await page.getByText('Imported waiting',{exact:true}).waitFor();await page.getByRole('button',{name:'Board',exact:true}).click();
  for(const [status,label]of Object.entries(states)){
   await page.getByLabel('Status filter',{exact:true}).selectOption('');
   const column=page.getByRole('region',{name:label,exact:true});assert.equal(await column.getByText('Imported '+status,{exact:true}).count(),1);
   await page.getByLabel('Status filter',{exact:true}).selectOption(status);assert.equal(await page.getByRole('region',{name:'Tasks board',exact:true}).locator('article').count(),1);
   assert.equal(await column.getByRole('button',{name:'Complete task',exact:true}).count(),['retired','archived'].includes(status)?0:1);
  }
  await page.getByRole('link',{name:'Skip to content',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(new URL(page.url()).hash,'#tasks');assert.equal(await page.locator(':focus').getAttribute('id'),'main');
 });
}
