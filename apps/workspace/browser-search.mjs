import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {hold} from './browser-regressions.mjs';

export async function runSearchTests({browser,origin,DB,axe,addActor}){
 await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('search-client','qa-org','Findme client')").run();
 await DB.prepare("INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES('search-project','qa-org','search-client','Findme project',1)").run();
 for(let i=0;i<25;i++)await DB.prepare("INSERT INTO tasks(id,organization_id,project_id,title,client_visible) VALUES(?,'qa-org','search-project',?,1)").bind('search-task-'+String(i).padStart(2,'0'),'Findme task '+i).run();
 await DB.prepare("INSERT INTO notes(id,organization_id,project_id,title,text,client_visible) VALUES('search-note','qa-org','search-project','Findme document','Synthetic search content',1)").run();
 await DB.prepare("INSERT INTO note_positions(id,organization_id,project_id) VALUES('search-note','qa-org','search-project')").run();
 await addActor('search-client-actor','search-client@example.invalid','client','search-client');
 async function pageFor(t,who='staff'){const p=await browser.newPage({extraHTTPHeaders:{'X-Test-Actor':who}}),errors=[];p.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await p.close();assert.deepEqual(errors,[]);});await p.goto(origin+'/#projects');await p.locator('main[aria-busy]').waitFor({state:'detached'});return p;}
 const dialog=p=>p.getByRole('dialog',{name:'Search workspace',exact:true});
 async function search(p,q='Findme'){await p.getByRole('button',{name:'Search workspace',exact:true}).click();const d=dialog(p);await d.getByRole('searchbox').fill(q);await d.getByRole('button',{name:'Search',exact:true}).click();await d.getByRole('link',{name:'Findme client',exact:true}).waitFor();return d;}
 await test('#779 global search pages results and opens client project task and document records',async t=>{
  const p=await pageFor(t);let d=await search(p);const tasks=d.getByRole('region',{name:'Tasks search results',exact:true});assert.equal(await tasks.getByRole('link').count(),20);await tasks.getByRole('button',{name:'Load more tasks',exact:true}).click();await tasks.getByRole('link',{name:'Findme task 24',exact:true}).waitFor();assert.equal(await tasks.getByRole('link').count(),25);
  for(const [name,heading]of [['Findme client','Client details'],['Findme project','Project overview'],['Findme task 0','Task details'],['Findme document','Document details']]){
   if(!await dialog(p).count())d=await search(p);await d.getByRole('link',{name,exact:true}).click();await p.getByRole('heading',{name:heading,exact:true}).waitFor();
   if(heading!=='Project overview'){await p.reload();await p.getByRole('heading',{name:heading,exact:true}).waitFor();await p.keyboard.press('Escape');await p.locator('dialog').waitFor({state:'detached'});}
  }
 });
 await test('#779 keyboard search and responsive results preserve escape focus and client visibility',async t=>{
  const p=await pageFor(t,'search-client-actor');await p.evaluate(axe);
  for(const width of [390,768,1440]){await p.setViewportSize({width,height:1000});const opener=p.getByRole('button',{name:'Search workspace',exact:true});await opener.focus();await p.keyboard.press('Control+k');const d=dialog(p);await d.getByRole('searchbox').fill('Findme');await d.getByRole('button',{name:'Search',exact:true}).click();await d.getByRole('link',{name:'Findme document',exact:true}).waitFor();assert.equal(await d.getByRole('region',{name:'Clients search results'}).getByRole('link').count(),1);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(await p.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)),[]);
   if(process.env.WORKSPACE_TEST_OUTPUT_DIR){await mkdir(process.env.WORKSPACE_TEST_OUTPUT_DIR,{recursive:true});await p.screenshot({path:join(process.env.WORKSPACE_TEST_OUTPUT_DIR,'global-search-'+width+'.png')});}
   await p.keyboard.press('Escape');await p.locator('dialog').waitFor({state:'detached'});assert.equal(await opener.evaluate(e=>e===document.activeElement),true);
  }
 });
 await test('#779 closed and superseded search responses cannot restore stale results or steal focus',async t=>{
  const p=await pageFor(t);await p.getByRole('button',{name:'Search workspace',exact:true}).click();let d=dialog(p);const held=await hold(p,'**/api/search?*');await d.getByRole('searchbox').fill('old');await d.getByRole('button',{name:'Search',exact:true}).click();await held.entered;await p.keyboard.press('Escape');d=await search(p);await d.getByRole('searchbox').focus();await held.release({status:200,contentType:'application/json',body:JSON.stringify({groups:[{type:'clients',items:[{id:'stale',title:'Stale result'}],nextCursor:null}]})});assert.equal(await p.getByText('Stale result',{exact:true}).count(),0);assert.equal(await d.getByRole('searchbox').evaluate(e=>e===document.activeElement),true);
 });
 await test('#779 search failures can retry and blank searches clear prior results',async t=>{
  const p=await pageFor(t);await p.route('**/api/search?*',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic search failure'})}),{times:1});await p.getByRole('button',{name:'Search workspace',exact:true}).click();const d=dialog(p);await d.getByRole('searchbox').fill('Findme');await d.getByRole('button',{name:'Search',exact:true}).click();await d.getByRole('alert').waitFor();await d.getByRole('button',{name:'Search',exact:true}).click();await d.getByRole('link',{name:'Findme client',exact:true}).waitFor();await d.getByRole('searchbox').fill('');await d.getByRole('button',{name:'Search',exact:true}).click();await d.getByText('Enter a name or title to search.',{exact:true}).waitFor();assert.equal(await d.getByRole('link').count(),0);
 });
}
