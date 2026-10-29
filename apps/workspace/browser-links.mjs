import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {hold} from './browser-regressions.mjs';

const json=data=>({status:200,contentType:'application/json',body:JSON.stringify(data)});
const unavailable={status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic linked-record failure'})};
const denied={status:403,contentType:'application/json',body:JSON.stringify({error:'Forbidden'})};
const labels={tasks:'Tasks',reviews:'Proposal reviews',invoices:'Invoices'};

export async function runRecordLinkTests({browser,origin,DB,addActor,stripe,axe}){
 stripe.enabled=true;
 const clientId=crypto.randomUUID(),otherClientId=crypto.randomUUID(),projectId=crypto.randomUUID();
 await DB.prepare('INSERT INTO clients(id,organization_id,name) VALUES(?,?,?),(?,?,?)').bind(clientId,'qa-org','Linked client',otherClientId,'qa-org','Other linked client').run();
 await DB.prepare('INSERT INTO projects(id,organization_id,client_id,name,client_visible) VALUES(?,?,?,?,1)').bind(projectId,'qa-org',clientId,'Linked project').run();
 for(const [id,role,client]of [['link-fin','staff',null],['link-client','client',clientId],['link-other','client',otherClientId],['link-foreign','staff',null]])await addActor(id,id+'@example.invalid',role,client);
 await DB.prepare("INSERT INTO actor_finance_access VALUES('link-fin','qa-org')").run();
 await DB.prepare("UPDATE actors SET organization_id='link-foreign-org' WHERE id='link-foreign'").run();
 await DB.batch(Array.from({length:52},(_,n)=>DB.prepare('INSERT INTO tasks(id,organization_id,project_id,title,client_visible) VALUES(?,?,?,?,1)').bind('a-link-pad-'+String(n).padStart(2,'0'),'qa-org',projectId,'Linked pagination pad '+n)));
 const tasks=[{id:'z-linked-task-a',title:'Linked <b>task A</b>'},{id:'z-linked-task-b',title:'Linked task B'},{id:'z-linked-task-private',title:'Private linked task'}];
 for(const task of tasks)await DB.prepare('INSERT INTO tasks(id,organization_id,project_id,title,client_visible,assignee_id,due_on) VALUES(?,?,?,?,?,?,?)').bind(task.id,'qa-org',projectId,task.title,task===tasks[2]?0:1,'link-fin','2026-12-01').run();
 const setup=await browser.newPage({extraHTTPHeaders:{'X-Test-Actor':'link-fin'}});
 await setup.goto(origin);await setup.locator('main[aria-busy]').waitFor({state:'detached'});
 async function call(page,path,body,method=body?'POST':'GET'){
  return page.evaluate(async({path,body,method})=>{const r=await fetch('/api/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};},{path,body,method});
 }
 async function checked(page,path,body,status=200,method){const r=await call(page,path,body,method);assert.equal(r.status,status,JSON.stringify(r));return r.data;}
 const future=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
 const reviews=[];
 for(const title of ['Linked proposal A','Linked proposal B']){
  const p=await checked(setup,'commercial/proposals',{requestId:crypto.randomUUID(),title,clientId,projectId,content:{scope:'Literal linked scope',schedule:'Dates to agree',terms:'Synthetic review terms',currency:'CAD',charges:[{description:'Design',quantity:1,unitMinor:10000}],discountMinor:0,tax:{type:'HST',rateBps:1300}}},201);
  const share={requestId:crypto.randomUUID(),proposalId:p.id,proposalRevision:p.revision,proposalHash:p.contentHash,expiresAt:new Date(Math.floor((Date.now()+3600000)/1000)*1000).toISOString().replace('.000Z','Z'),reason:'Synthetic linked review'},r=await checked(setup,'proposal-reviews',share,201);reviews.push({...r,title,requestId:share.requestId});
 }
 const customerId='cus_linkedrecords';stripe.customers.set(customerId,{id:customerId,object:'customer',livemode:false,name:'Linked payer',email:'linked-payer@example.invalid',currency:null});
 const binding=await checked(setup,'stripe/customers/preview',{clientId,customerId});
 await checked(setup,'stripe/customers',{clientId,customerId,clientRevision:0,requestId:crypto.randomUUID(),fingerprint:binding.fingerprint,reason:'Synthetic linked binding'},201);
 const invoices=[];
 for(const title of ['Linked invoice A','Linked invoice B']){
  const body={clientId,projectId,title,currency:'CAD',tax:{type:'HST',rateBps:1300},dueOn:future(30),times:[],charges:[{description:'Linked work',quantity:1,unitMinor:10000}]},preview=await checked(setup,'invoices/preview',body),row=await checked(setup,'invoices',{...body,requestId:crypto.randomUUID(),fingerprint:preview.fingerprint},201),plan=await checked(setup,'invoices/'+row.id+'/stripe-preview',{}),operation=await checked(setup,'invoices/'+row.id+'/stripe',{requestId:crypto.randomUUID(),revision:row.revision,fingerprint:plan.fingerprint,reason:'Synthetic linked draft'},201),native=stripe.invoices.get(operation.stripeInvoiceId);
  Object.assign(native,{status:'open',status_transitions:{finalized_at:1700000000,paid_at:null,voided_at:null,marked_uncollectible_at:null},hosted_invoice_url:'https://invoice.stripe.com/i/'+native.id,invoice_pdf:null});
  const image=await checked(setup,'invoices/'+row.id+'/billing/reconcile',{});invoices.push({id:row.id,title,image});
 }
 await setup.close();
 const records={tasks,reviews,invoices},path=(kind,id)=>'#'+kind+'/'+id;
 async function pageFor(t,who='link-fin'){
  const page=await browser.newPage({extraHTTPHeaders:{'X-Test-Actor':who}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});return page;
 }
 async function go(page,kind,id){await page.goto(origin+'/'+path(kind,id));await page.locator('main[aria-busy]').waitFor({state:'detached'});assert.equal(await page.locator('h1').textContent(),labels[kind]);}
 async function linked(page,kind,record){
  await go(page,kind,record.id);
  const d=page.getByRole('dialog',{name:kind==='tasks'?'Task details':kind==='reviews'?'Proposal review':'Invoice status',exact:true});
  await d.getByText(record.title,{exact:true}).waitFor();return d;
 }
 const close=(dialog,kind)=>dialog.getByRole('button',{name:kind==='tasks'?'Close task':kind==='reviews'?'Close':'Close invoice status',exact:true});
 async function assertNoWrites(page,action){const writes=[];const listener=r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&!['GET','HEAD'].includes(r.method()))writes.push(r.url());};page.on('request',listener);await action();page.off('request',listener);assert.deepEqual(writes,[]);}

 await test('a linked task outside the first page opens its current canonical record and survives reload',async t=>{
  const page=await pageFor(t),d=await linked(page,'tasks',tasks[0]);assert.equal(await page.locator('section[aria-label="Tasks list"] strong').filter({hasText:tasks[0].title}).count(),0);
  await d.getByText('Assigned to link-fin',{exact:true}).waitFor();await d.getByText('Due 2026-12-01',{exact:true}).waitFor();assert.equal(await d.locator('b').count(),0);
  await page.reload();await page.getByRole('dialog',{name:'Task details',exact:true}).getByText(tasks[0].title,{exact:true}).waitFor();assert.equal(new URL(page.url()).hash,path('tasks',tasks[0].id));
 });
 for(const who of ['link-fin','link-client'])await test('closing a linked task returns focus to its current reopen control for '+who,async t=>{
  const page=await pageFor(t,who),d=await linked(page,'tasks',tasks[0]);await close(d,'tasks').click();await page.locator('dialog').waitFor({state:'detached'});assert.equal(await page.getByRole('button',{name:'Open linked task',exact:true}).evaluate(el=>document.activeElement===el),true);
 });
 await test('task links reuse the existing editor and revision checks',async t=>{
  const page=await pageFor(t),p=await linked(page,'tasks',tasks[1]);await p.getByRole('button',{name:'Edit '+tasks[1].title,exact:true}).click();
  const edit=page.getByRole('dialog',{name:'Edit task',exact:true});await edit.getByLabel('Name',{exact:true}).fill('Linked task B revised');await edit.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('dialog',{name:'Task details',exact:true}).getByText('Linked task B revised',{exact:true}).waitFor();const current=await checked(page,'tasks/'+tasks[1].id);assert.equal(current.revision,1);tasks[1].title=current.title;
 });
 await test('client task links expose shared details and comments without staff task controls',async t=>{
  const page=await pageFor(t,'link-client');await assertNoWrites(page,async()=>{const d=await linked(page,'tasks',tasks[0]);assert.equal(await d.getByRole('button',{name:/Edit |Complete task|Reopen task/}).count(),0);assert.equal(await d.getByRole('button',{name:'Comments for '+tasks[0].title,exact:true}).count(),1);});
 });
 await test('a client can reply through linked task comments and return to the same task',async t=>{
  const page=await pageFor(t,'link-client'),d=await linked(page,'tasks',tasks[0]),opener=d.getByRole('button',{name:'Comments for '+tasks[0].title,exact:true});await opener.click();
  const comments=page.getByRole('dialog',{name:'Comments for '+tasks[0].title,exact:true});await comments.getByLabel('Comment',{exact:true}).fill('Reply from the linked task');await comments.getByRole('button',{name:'Post comment',exact:true}).click();await comments.getByText('Reply from the linked task',{exact:true}).waitFor();await comments.getByRole('button',{name:'Close comments',exact:true}).click();await page.locator('dialog.comment-dialog').waitFor({state:'detached'});assert.equal(await opener.evaluate(el=>document.activeElement===el),true);assert.equal(new URL(page.url()).hash,path('tasks',tasks[0].id));
 });
 for(const [who,record]of [['link-client',tasks[2]],['link-other',tasks[0]],['link-foreign',tasks[0]]])await test('linked task denial clears selected content for '+who+' '+record.id,async t=>{
  const page=await pageFor(t,who);await go(page,'tasks',record.id);await page.getByText('This task is unavailable. Reload Tasks to check your access.',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByText(record.title,{exact:true}).count(),0);
 });
 await test('revoking a linked task project clears cached task content and mutation controls',async t=>{
  const page=await pageFor(t,'link-client'),d=await linked(page,'tasks',tasks[0]);await DB.prepare('UPDATE projects SET client_visible=0 WHERE id=?').bind(projectId).run();try{await d.getByRole('button',{name:'Reload task',exact:true}).click();await page.getByText('This task is unavailable. Reload Tasks to check your access.',{exact:true}).waitFor();assert.equal(await page.getByText(tasks[0].title,{exact:true}).count(),0);assert.equal(await page.getByRole('dialog').count(),0);}finally{await DB.prepare('UPDATE projects SET client_visible=1 WHERE id=?').bind(projectId).run();}
 });
 await test('deactivating the current linked task actor clears cached tasks and controls',async t=>{
  const page=await pageFor(t,'link-client'),d=await linked(page,'tasks',tasks[0]);await DB.prepare("UPDATE actors SET active=0 WHERE id='link-client'").run();try{await d.getByRole('button',{name:'Reload task',exact:true}).click();await page.getByText('Record access changed. Reload the page to check your access.',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByText(tasks[0].title,{exact:true}).count(),0);}finally{await DB.prepare("UPDATE actors SET active=1 WHERE id='link-client'").run();}
 });
 await test('a failed linked task read retains an enabled retry and restores keyboard focus after recovery',async t=>{
  const page=await pageFor(t),d=await linked(page,'tasks',tasks[0]),held=await hold(page,'**/api/tasks/'+tasks[0].id);await d.getByRole('button',{name:'Reload task',exact:true}).click();await held.entered;await held.release(unavailable);await d.getByRole('alert').waitFor();assert.equal(await d.getByText(tasks[0].title,{exact:true}).count(),0);await page.unroute('**/api/tasks/'+tasks[0].id);
  const retry=d.getByRole('button',{name:'Reload task',exact:true});await retry.focus();await page.keyboard.press('Enter');await d.getByText(tasks[0].title,{exact:true}).waitFor();await d.locator('[aria-busy]').waitFor({state:'detached'});assert.equal(await retry.evaluate(el=>document.activeElement===el&&!el.disabled),true);
 });
 for(const kind of ['reviews','invoices'])for(const who of ['link-fin','link-client'])await test('a '+who+' opens the exact '+kind+' source from its record link without a write',async t=>{
  const page=await pageFor(t,who);await assertNoWrites(page,async()=>{const d=await linked(page,kind,records[kind][0]);assert.equal(new URL(page.url()).hash,path(kind,records[kind][0].id));await close(d,kind).click();assert.equal(await page.getByRole('dialog').count(),0);});
 });
 await test('an invoice record link does not depend on the first history page',async t=>{
  const page=await pageFor(t,'link-client');await page.goto(origin);const first=await checked(page,'portal/invoices?limit=1'),target=invoices.find(i=>i.id!==first.items[0].invoiceId);assert.ok(target);
  await page.route('**/api/portal/invoices?*',async route=>{const u=new URL(route.request().url());u.searchParams.set('limit','1');await route.fulfill({response:await route.fetch({url:u.href})});});const d=await linked(page,'invoices',target);assert.equal(await page.locator('[data-billing-invoice="'+target.id+'"]').count(),0);await d.getByText('Remaining: CAD 113.00',{exact:true}).waitFor();
 });
 await test('reopening the selected invoice link rechecks current access and clears revoked prices',async t=>{
  const page=await pageFor(t,'link-client'),d=await linked(page,'invoices',invoices[0]);await close(d,'invoices').click();await page.locator('dialog').waitFor({state:'detached'});await DB.prepare('UPDATE projects SET client_visible=0 WHERE id=?').bind(projectId).run();try{await page.locator('a[href="'+path('invoices',invoices[0].id)+'"]').click();await page.getByText('Invoice access changed. Refresh invoices to check current access.',{exact:true}).waitFor();assert.equal(await page.locator('[data-billing-invoice],[data-billing-image],[data-currency]').count(),0);assert.equal(new URL(page.url()).hash,path('invoices',invoices[0].id));}finally{await DB.prepare('UPDATE projects SET client_visible=1 WHERE id=?').bind(projectId).run();}
 });
 await test('a modified click on the selected source link retains normal new-tab navigation',async t=>{
  const page=await pageFor(t,'link-client'),d=await linked(page,'invoices',invoices[0]);await close(d,'invoices').click();await page.locator('dialog').waitFor({state:'detached'});const opened=page.context().waitForEvent('page');await page.locator('a[href="'+path('invoices',invoices[0].id)+'"]').click({modifiers:['ControlOrMeta']});const popup=await opened;t.after(()=>popup.close());await popup.getByRole('dialog',{name:'Invoice status',exact:true}).getByText(invoices[0].title,{exact:true}).waitFor();assert.equal(new URL(popup.url()).hash,path('invoices',invoices[0].id));assert.equal(await page.getByRole('dialog').count(),0);
 });
 await test('a review record link remains usable when its independent history list fails',async t=>{
  const page=await pageFor(t,'link-client');await page.route('**/api/portal/proposals',route=>route.fulfill(unavailable));const d=await linked(page,'reviews',reviews[0]);await d.getByLabel('Your response',{exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),1);
 });
 await test('a revoked linked review clears cached review lists and content',async t=>{
  const page=await pageFor(t,'link-client'),d=await linked(page,'reviews',reviews[0]);await DB.prepare('UPDATE projects SET client_visible=0 WHERE id=?').bind(projectId).run();try{await d.getByRole('button',{name:'Reload review',exact:true}).click();await page.getByText('This review is unavailable. Reload Proposal reviews to check your access.',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByText(reviews[0].title,{exact:true}).count(),0);}finally{await DB.prepare('UPDATE projects SET client_visible=1 WHERE id=?').bind(projectId).run();}
 });
 await test('a saved review recovery receipt cannot replace the URL-selected review',async t=>{
  const page=await pageFor(t);await page.goto(origin);await page.evaluate(key=>localStorage.setItem('ashbi.review.pending.link-fin.staff.'+key,key),reviews[0].requestId);const receipt=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/proposal-reviews/requests/'+reviews[0].requestId),d=await linked(page,'reviews',reviews[1]);await (await receipt).finished();await page.waitForFunction(()=>!Object.keys(localStorage).some(k=>k.startsWith('ashbi.review.pending.link-fin.staff.')));assert.equal(await d.getByText(reviews[1].title,{exact:true}).count(),1);assert.equal(await d.getByText(reviews[0].title,{exact:true}).count(),0);assert.equal(new URL(page.url()).hash,path('reviews',reviews[1].id));
 });
 for(const kind of ['reviews','invoices'])await test('another client cannot read a linked '+kind+' record',async t=>{
  const page=await pageFor(t,'link-other');await go(page,kind,records[kind][0].id);if(kind==='invoices')await page.getByText('Invoice access changed. Refresh invoices to check current access.',{exact:true}).waitFor();else await page.getByText('This review is unavailable. Reload Proposal reviews to check your access.',{exact:true}).waitFor();assert.equal(await page.getByText(records[kind][0].title,{exact:true}).count(),0);
 });
 for(const kind of ['reviews','invoices'])await test('ordinary staff cannot load linked '+kind+' financial records',async t=>{
  const page=await pageFor(t,'staff'),paths=[];page.on('request',r=>{if(/^\/api\/(proposal-reviews|portal\/proposals|billing|invoices|stripe)/.test(new URL(r.url()).pathname))paths.push(r.url());});await go(page,kind,records[kind][0].id);await page.getByText('Financial access is required.',{exact:true}).waitFor();assert.deepEqual(paths,[]);
 });
 for(const kind of ['tasks','reviews','invoices'])await test('existing '+kind+' rows expose a normal authorized source link',async t=>{
  const page=await pageFor(t,'link-client');await page.goto(origin+'/#'+kind);await page.locator('main[aria-busy]').waitFor({state:'detached'});if(kind==='reviews')await page.locator('[data-review-list][aria-busy]').waitFor({state:'detached'});if(kind==='invoices')await page.locator('[data-billing-list][aria-busy]').waitFor({state:'detached'});const links=page.locator('a[href^="#'+kind+'/"]');assert.ok(await links.count()>0,'Expected an authorized source record link');const href=await links.first().getAttribute('href');assert.match(href,new RegExp('^#'+kind+'/[a-zA-Z0-9-]{1,100}$'));await links.first().click();assert.equal(new URL(page.url()).hash,href);await page.getByRole('dialog').first().waitFor();
 });
 for(const suffix of ['..','%2Fforeign','id/extra','id?other=value'])await test('malformed record suffix '+suffix+' stays on Tasks without a record request',async t=>{
  const page=await pageFor(t),paths=[];page.on('request',r=>{if(/^\/api\/tasks\//.test(new URL(r.url()).pathname))paths.push(r.url());});await go(page,'tasks',suffix);await page.getByText('This record link is invalid. Open the page to continue.',{exact:true}).waitFor();assert.deepEqual(paths,[]);assert.equal(await page.getByRole('dialog').count(),0);
 });
 for(const failure of [false,true])await test('a changed task record URL fences the prior loader '+(failure?'failure':'success')+' before a hash event runs',async t=>{
  const page=await pageFor(t),d=await linked(page,'tasks',tasks[0]);await close(d,'tasks').click();await page.getByRole('link',{name:'Tasks',exact:true}).click();await page.locator('main[aria-busy]').waitFor({state:'detached'});const image=await checked(page,'tasks'),held=await hold(page,'**/api/tasks');await page.evaluate(hash=>{location.hash=hash;},path('tasks',tasks[0].id));await held.entered;await page.evaluate(hash=>history.replaceState(null,'',hash),path('tasks',tasks[1].id));await held.release(failure?unavailable:json(image));assert.equal(await page.locator('main').getAttribute('aria-busy'),'true');assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.getByRole('dialog').count(),0);await page.evaluate(()=>dispatchEvent(new HashChangeEvent('hashchange')));await page.getByRole('dialog',{name:'Task details',exact:true}).getByText(tasks[1].title,{exact:true}).waitFor();
 });
 for(const failure of [false,true])await test('a stale task pagination '+(failure?'failure':'success')+' cannot append or move focus after the record URL changes',async t=>{
  const page=await pageFor(t),d=await linked(page,'tasks',tasks[0]);await close(d,'tasks').click();const first=await checked(page,'tasks'),next=await checked(page,'tasks?after='+first.nextCursor),held=await hold(page,'**/api/tasks?after=*');await page.getByRole('button',{name:'Load more',exact:true}).click();await held.entered;await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Name',{exact:true}).focus();await page.evaluate(hash=>history.replaceState(null,'',hash),path('tasks',tasks[1].id));await held.release(failure?unavailable:json(next));assert.equal(await page.locator('section[aria-label="Tasks list"] strong').filter({hasText:tasks[0].title}).count(),0);assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.locator(':focus').getAttribute('name'),'title');await page.evaluate(()=>dispatchEvent(new HashChangeEvent('hashchange')));await page.getByRole('dialog',{name:'Task details',exact:true}).getByText(tasks[1].title,{exact:true}).waitFor();
 });
 for(const kind of ['tasks','reviews','invoices'])for(const failure of [false,true])await test('late '+kind+' record '+(failure?'denial':'success')+' cannot replace a newer record or focus',async t=>{
  const page=await pageFor(t),first=records[kind][0],second=records[kind][1],d=await linked(page,kind,first),detailPath=kind==='tasks'?'tasks/'+first.id:kind==='reviews'?'proposal-reviews/'+first.id:'invoices/'+first.id+'/billing',image=await checked(page,detailPath),held=await hold(page,'**/api/'+detailPath),reload=kind==='tasks'?'Reload task':kind==='reviews'?'Reload review':'Reload observed invoice';await d.getByRole('button',{name:reload,exact:true}).click();await held.entered;await page.evaluate(hash=>{location.hash=hash;},path(kind,second.id));await page.getByRole('dialog').filter({has:page.getByText(second.title,{exact:true})}).waitFor();const fresh=page.getByRole('dialog').filter({has:page.getByText(second.title,{exact:true})}),button=close(fresh,kind);await button.focus();await held.release(failure?denied:json(image));assert.equal(await fresh.getByText(second.title,{exact:true}).count(),1);assert.equal(await button.evaluate(el=>document.activeElement===el),true);assert.equal(await page.getByRole('alert').count(),0);
 });
 await test('linked task, review and invoice pages retain keyboard skip, responsive layout and axe for both roles',async t=>{
  for(const who of ['link-fin','link-client']){const page=await pageFor(t,who);for(const [kind,width]of [['tasks',390],['reviews',768],['invoices',1440]]){await page.setViewportSize({width,height:1000});const d=await linked(page,kind,records[kind][0]);await page.evaluate(axe);assert.deepEqual(await page.evaluate(async()=>(await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)),[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:fileURLToPath(new URL('../../../outputs/record-link-'+who+'-'+kind+'-'+width+'.png',import.meta.url)),fullPage:false});await close(d,kind).click();await page.locator('dialog').waitFor({state:'detached'});await page.locator('main').focus();for(let n=0;n<25&&await page.evaluate(()=>document.activeElement?.textContent!=='Skip to content');n++)await page.keyboard.press('Shift+Tab');assert.equal(await page.locator(':focus').textContent(),'Skip to content');await page.keyboard.press('Enter');assert.equal(new URL(page.url()).hash,path(kind,records[kind][0].id));assert.equal(await page.locator(':focus').getAttribute('id'),'main');assert.equal(await page.getByRole('dialog').count(),0);}}
 });
}
