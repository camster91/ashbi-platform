import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {hold} from './browser-regressions.mjs';

export async function runProjectWorkspaceTests({browser,origin,DB,axe,addActor}) {
 const project='workspace-project-a',other='workspace-project-b',client='workspace-client';
 await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES(?,'qa-org','Workspace client')").bind(client).run();
 for(const [id,name,shared] of [[project,'Website refresh',1],[other,'Other project',0]])await DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES(?,'qa-org',?,?,?)").bind(id,client,name,shared).run();
 for(const [id,p,title] of [['workspace-task-a',project,'Review homepage direction'],['workspace-task-b',other,'Other project task']])await DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,client_visible) VALUES(?,'qa-org',?,?,1)").bind(id,p,title).run();
 await addActor('workspace-owner','workspace-owner@example.invalid','staff',null);
 await addActor('workspace-client-actor','workspace-client@example.invalid','client',client);
 await DB.prepare("INSERT INTO actor_finance_access VALUES('workspace-owner','qa-org')").run();
 const path=(section='',p=project)=>origin+'/#projects/'+p+(section?'/'+section:'');
 async function open(t,section='',identity='workspace-owner') {
  const page=await browser.newPage({extraHTTPHeaders:{'X-Test-Actor':identity}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});
  await page.goto(path(section));await page.getByRole('heading',{name:'Website refresh',exact:true,level:1}).waitFor();await page.locator('main[aria-busy]').waitFor({state:'detached'});
  return page;
 }
 await test('#771 project navigation, task creation, detail links and history retain project context',async t=>{
  const page=await open(t),tabs=page.getByRole('navigation',{name:'Project sections'});
  await tabs.getByRole('link',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Edit Review homepage direction',exact:true}).waitFor();
  assert.equal(await page.getByText('Other project task',{exact:true}).count(),0);
  assert.deepEqual(await page.getByLabel('Project filter',{exact:true}).locator('option').evaluateAll(xs=>xs.map(x=>x.value)),[project]);
  await page.getByRole('button',{name:'Add task',exact:true}).click();const form=page.locator('[data-task-create]');assert.equal(await form.getByLabel('Project',{exact:true}).inputValue(),project);
  await form.getByLabel('Name',{exact:true}).fill('New scoped task');await form.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('button',{name:'Edit New scoped task',exact:true}).waitFor();
  assert.equal((await DB.prepare("SELECT project_id FROM tasks WHERE title='New scoped task'").first()).project_id,project);
  await page.getByRole('button',{name:'Clear task filters',exact:true}).click();await page.getByRole('button',{name:'Edit New scoped task',exact:true}).waitFor();assert.equal(await page.getByText('Other project task',{exact:true}).count(),0);
  await page.getByRole('link',{name:'Open task details for Review homepage direction',exact:true}).click();await page.getByRole('dialog',{name:'Task details',exact:true}).waitFor();assert.equal(new URL(page.url()).hash,'#projects/'+project+'/tasks/workspace-task-a');
  await page.reload();await page.getByRole('dialog',{name:'Task details',exact:true}).waitFor();await page.getByRole('button',{name:'Close task',exact:true}).click();
  await tabs.getByRole('link',{name:'Overview',exact:true}).click();await page.getByRole('heading',{name:'Project overview',exact:true}).waitFor();await page.goBack();await page.getByRole('dialog',{name:'Task details',exact:true}).waitFor();
 });
 await test('#771 documents, uploads and manual time use the selected project',async t=>{
  const page=await open(t,'notes');await page.getByRole('button',{name:'Add document',exact:true}).click();const form=page.locator('[data-document-create]');
  assert.equal(await form.getByLabel('Project',{exact:true}).inputValue(),project);
  await form.getByLabel('Name',{exact:true}).fill('Scoped brief');await form.getByLabel('Content',{exact:true}).fill('Synthetic project brief');await form.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('button',{name:'Edit Scoped brief',exact:true}).waitFor();
  assert.equal((await DB.prepare("SELECT project_id FROM notes WHERE title='Scoped brief'").first()).project_id,project);
  await page.getByRole('navigation',{name:'Project sections'}).getByRole('link',{name:'Files',exact:true}).click();await page.getByRole('heading',{name:'Upload private file',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Project',{exact:true}).inputValue(),project);
  await page.getByLabel('File (maximum 5 MiB)',{exact:true}).setInputFiles({name:'project-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic project file')});await page.getByRole('button',{name:'Upload file',exact:true}).click();await page.getByRole('link',{name:'Download project-fixture.txt',exact:true}).waitFor();
  assert.equal((await DB.prepare("SELECT project_id FROM files WHERE name='project-fixture.txt'").first()).project_id,project);
  await page.getByRole('navigation',{name:'Project sections'}).getByRole('link',{name:'Time',exact:true}).click();await page.getByRole('heading',{name:'Track time',exact:true}).waitFor();
  const time=page.locator('[data-time-form]');assert.equal(await time.getByLabel('Project',{exact:true}).inputValue(),project);await time.getByLabel('Minutes for manual entry',{exact:true}).fill('5');await time.getByLabel('Work description',{exact:true}).fill('Scoped time');await time.getByRole('button',{name:'Save manual time',exact:true}).click();await page.getByText('Scoped time',{exact:true}).waitFor();
  assert.equal((await DB.prepare("SELECT project_id FROM time_details WHERE description='Scoped time'").first()).project_id,project);
 });
 await test('#771 billing defaults and draft queries stay scoped without changing provider behavior',async t=>{
  const page=await open(t,'billing');await page.getByText('0 invoice drafts loaded.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Invoice client',{exact:true}).inputValue(),client);assert.equal(await page.getByLabel('Invoice project',{exact:true}).inputValue(),project);
  const response=page.waitForResponse(r=>r.url().includes('/api/invoices?')&&r.request().method()==='GET');await page.getByRole('button',{name:'Apply invoice filters',exact:true}).click();const url=new URL((await response).url());assert.equal(url.searchParams.get('projectId'),project);assert.equal(url.searchParams.get('clientId'),client);
  await page.getByLabel('Invoice title',{exact:true}).fill('Project invoice preview');await page.getByLabel('Invoice currency',{exact:true}).selectOption('CAD');await page.getByLabel('Tax type',{exact:true}).selectOption('NONE');await page.getByLabel('Final due date',{exact:true}).fill('2026-12-01');await page.getByRole('button',{name:'Add fixed charge',exact:true}).click();await page.getByLabel('Charge description 1',{exact:true}).fill('Design');await page.getByLabel('Charge unit price 1',{exact:true}).fill('100');
  const preview=page.waitForRequest(r=>r.url().endsWith('/api/invoices/preview'));await page.getByRole('button',{name:'Review invoice',exact:true}).click();const body=(await preview).postDataJSON();assert.equal(body.projectId,project);assert.equal(body.clientId,client);await page.getByText('Full total: CAD 100.00',{exact:true}).waitFor();
 });
 await test('#771 client project visibility and restricted direct links fail closed',async t=>{
  const page=await open(t,'tasks','workspace-client-actor'),tabs=page.getByRole('navigation',{name:'Project sections'});
  assert.equal(await tabs.getByRole('link',{name:'Time',exact:true}).count(),0);assert.equal(await tabs.getByRole('link',{name:'Billing',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/^Edit /}).count(),0);
  await page.goto(path('billing'));await page.getByRole('heading',{name:'Project access unavailable',exact:true}).waitFor();assert.equal(await page.locator('[data-invoice-form]').count(),0);await page.getByRole('link',{name:'Open project overview',exact:true}).click();await page.getByRole('heading',{name:'Project overview',exact:true}).waitFor();
  await page.goto(path('tasks',other));await page.getByRole('heading',{name:'Unable to open workspace',exact:true}).waitFor();assert.equal(await page.getByText('Other project task',{exact:true}).count(),0);
 });
 await test('#771 stale project responses cannot replace the next project or move focus',async t=>{
  const page=await open(t,'tasks');const held=await hold(page,'**/api/projects/'+other);await page.evaluate(hash=>{location.hash=hash;},'#projects/'+other+'/tasks');await held.entered;
  await page.evaluate(hash=>{location.hash=hash;},'#projects/'+project+'/tasks');await page.getByRole('button',{name:'Edit Review homepage direction',exact:true}).waitFor();await page.getByLabel('Search tasks',{exact:true}).focus();
  const data=await DB.prepare('SELECT * FROM projects WHERE id=?').bind(other).first();await held.release({status:200,contentType:'application/json',body:JSON.stringify(data)});
  assert.equal(await page.getByRole('heading',{level:1}).textContent(),'Website refresh');assert.equal(await page.getByLabel('Search tasks',{exact:true}).evaluate(e=>e===document.activeElement),true);assert.equal(await page.getByText('Other project task',{exact:true}).count(),0);
 });
 await test('#771 project sections support phone, tablet, desktop and keyboard navigation',async t=>{
  const page=await open(t);await page.evaluate(axe);
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1000});
   for(const section of ['Overview','Tasks','Documents','Files','Time','Billing']){
    const link=page.getByRole('navigation',{name:'Project sections'}).getByRole('link',{name:section,exact:true});await link.focus();await page.keyboard.press('Enter');await page.locator('main[aria-busy]').waitFor({state:'detached'});await page.getByRole('navigation',{name:'Project sections'}).locator('[aria-current=page]').filter({hasText:section}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const issues=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.html)}));});assert.deepEqual(issues,[]);
    if(process.env.WORKSPACE_TEST_OUTPUT_DIR){await mkdir(process.env.WORKSPACE_TEST_OUTPUT_DIR,{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(process.env.WORKSPACE_TEST_OUTPUT_DIR,'project-'+section.toLowerCase()+'-'+width+'.png')});}
   }
  }
 });
}
