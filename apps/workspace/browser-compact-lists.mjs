import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

export async function runCompactListTests({browser,origin,DB,axe}) {
 const client='compact-client',project='compact-project',task='compact-task';
 const name='A deliberately long project name for accessible responsive list verification';
 await DB.prepare("INSERT INTO clients(id,organization_id,name,email) VALUES(?,'qa-org','Compact client','compact@example.invalid')").bind(client).run();
 await DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES(?,'qa-org',?,?,1)").bind(project,client,name).run();
 await DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,due_on,assignee_id) VALUES(?,'qa-org',?,'Compact task','2026-12-01','qa')").bind(task,project).run();
 for(const [route,label] of [['clients','Compact client'],['projects',name],['tasks','Compact task']])await test('#773 '+route+' lists align on desktop and preserve mobile actions',async t=>{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});
  await page.goto(origin+'/#'+route);const row=page.locator('.compact-record').filter({has:page.getByText(label,{exact:true}).first()});await row.waitFor();await page.evaluate(axe);
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(width===1440){const boxes=await row.locator(':scope > div').evaluateAll(xs=>xs.map(x=>({left:x.getBoundingClientRect().left,top:x.getBoundingClientRect().top})));assert.ok(boxes.every((x,i)=>i===0||x.left>boxes[i-1].left));}
   assert.deepEqual(await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)),[]);
   await row.scrollIntoViewIfNeeded();
   if(process.env.WORKSPACE_TEST_OUTPUT_DIR){await mkdir(process.env.WORKSPACE_TEST_OUTPUT_DIR,{recursive:true});await page.screenshot({path:join(process.env.WORKSPACE_TEST_OUTPUT_DIR,'compact-'+route+'-'+width+'.png')});}
  }
  const edit=row.getByRole('button',{name:'Edit '+label,exact:true});await edit.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await dialog.waitFor();await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});assert.equal(await edit.evaluate(e=>e===document.activeElement),true);
  if(route==='tasks'){await page.getByRole('button',{name:'Board',exact:true}).click();assert.equal(await page.locator('.task-board .compact-record').count(),0);await page.getByRole('button',{name:'List',exact:true}).click();await row.waitFor();}
  if(route==='projects'){await row.getByRole('link',{name:'Open project '+name,exact:true}).click();await page.getByRole('heading',{name:'Project overview',exact:true}).waitFor();assert.equal(await page.locator('.compact-record').count(),0);}
 });
}
