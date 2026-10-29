import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

export async function runNavigationGroupTests({browser,origin,DB,axe,addActor}) {
 await DB.prepare("INSERT INTO clients(id,organization_id,name) VALUES('nav-client','qa-org','Navigation client')").run();
 for(const [id,role,client] of [['nav-finance','staff',null],['nav-staff','staff',null],['nav-portal','client','nav-client']])await addActor(id,id+'@example.invalid',role,client);
 await DB.prepare("INSERT INTO actor_finance_access VALUES('nav-finance','qa-org')").run();
 for(const identity of ['nav-finance','nav-staff','nav-portal'])await test('#777 named navigation groups preserve '+identity+' access and active links',async t=>{
  const page=await browser.newPage({extraHTTPHeaders:{'X-Test-Actor':identity}}),errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});
  await page.goto(origin+'/#projects');await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();await page.locator('main[aria-busy]').waitFor({state:'detached'});await page.evaluate(axe);
  const nav=page.getByRole('navigation',{name:'Workspace',exact:true});
  assert.equal(await nav.getByRole('group',{name:'Work',exact:true}).count(),1);assert.equal(await nav.getByRole('group',{name:'Clients & billing',exact:true}).count(),1);assert.equal(await nav.getByRole('group',{name:'Documents',exact:true}).count(),1);
  assert.equal(await nav.getByRole('group',{name:'Administration',exact:true}).count(),identity==='nav-finance'?1:0);
  assert.equal(await nav.getByRole('link',{name:'Time',exact:true}).count(),identity==='nav-portal'?0:1);assert.equal(await nav.getByRole('link',{name:'Invoices',exact:true}).count(),identity==='nav-staff'?0:1);
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1000});if(width<768)await page.getByRole('button',{name:'Open navigation',exact:true}).click();const files=nav.getByRole('link',{name:'Files',exact:true});await files.focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Files',exact:true}).waitFor();await page.locator('main[aria-busy]').waitFor({state:'detached'});
   assert.equal(await page.locator('#workspace-navigation a[href="#files"]').getAttribute('aria-current'),'page');assert.equal(await page.locator('#workspace-navigation [aria-current=page]').count(),1);if(width<768){assert.equal(await nav.isVisible(),false);assert.equal(await page.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded'),'false');}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual(await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)),[]);
   if(process.env.WORKSPACE_TEST_OUTPUT_DIR){await mkdir(process.env.WORKSPACE_TEST_OUTPUT_DIR,{recursive:true});await page.screenshot({path:join(process.env.WORKSPACE_TEST_OUTPUT_DIR,identity+'-'+width+'.png')});}
  }
 });
}
