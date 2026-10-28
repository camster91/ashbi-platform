import {runNavigationGroupTests} from './browser-navigation-groups.mjs';
import {runCompactListTests} from './browser-compact-lists.mjs';
import {runProjectWorkspaceTests} from './browser-project-workspace.mjs';
import {browserGroups,selectBrowserSuites} from './browser-groups.mjs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {Miniflare} from 'miniflare';
import {generateKeyPair,SignJWT} from 'jose';
import {createWorker} from './dist/worker.js';
import {runRegressions} from './browser-regressions.mjs';
import {runTaskBoardTests} from './browser-task-board.mjs';
import {runCommentTests} from './browser-comments.mjs';
import {runDocumentTests} from './browser-documents.mjs';
import {runDocumentTreeTests} from './browser-document-tree.mjs';
import {runTimerTests} from './browser-timer.mjs';
import {runTimeReviewTests} from './browser-time-review.mjs';
import {runFinanceTests} from './browser-finance.mjs';
import {runCommercialTests} from './browser-commercial.mjs';
import {runProposalReviewTests} from './browser-proposal-reviews.mjs';
import {runStripeTests} from './browser-stripe.mjs';
import {stripeDeliveryProvider} from './stripe-delivery-provider.mjs';
import {runInvoiceTests,billingSigningSecret} from './browser-invoices.mjs';
import {runRecordLinkTests} from './browser-links.mjs';
import {runOverviewPartTests} from './browser-overview-parts.mjs';
import {runWorkspaceJourneyTests} from './browser-workspace-journey.mjs';
import {runDashboardTests} from './browser-dashboard.mjs';
import {runContractTests,contractSigningFixture} from './browser-contracts.mjs';
import {runContractPdfTests} from './browser-contract-pdf-tests.mjs';
import {runStripeIssuanceTests} from './browser-stripe-issuance.mjs';
import {runStripeDeliveryTests} from './browser-stripe-delivery.mjs';
const selectedSuites=new Set(selectBrowserSuites(process.env.WORKSPACE_BROWSER_GROUP)),executedSuites=[];
// Match CI's fresh fixture boundary without overlapping local browser processes.
if(process.env.WORKSPACE_BROWSER_GROUP===undefined||process.env.WORKSPACE_BROWSER_GROUP==='all'){
 const results=[];
 for(const group of Object.keys(browserGroups)){
  const code=await new Promise(resolve=>{
   const child=spawn(process.execPath,[...process.execArgv,fileURLToPath(import.meta.url)],{stdio:'inherit',timeout:600000,env:{...process.env,WORKSPACE_BROWSER_GROUP:group}});
   child.once('error',error=>{console.error('Browser group could not start:',group,error.code);resolve(1);});
   child.once('close',(code,signal)=>{if(signal)console.error('Browser group terminated:',group,signal);resolve(code??1);});
  });
  results.push({group,code});console.log('Browser group result:',JSON.stringify({group,code}));
 }
 process.exit(results.every(result=>result.code===0)?0:1);
}
const base=fileURLToPath(new URL('.',import.meta.url));
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'qa'},r2Buckets:['FILES'],cf:false});
const DB=await mf.getD1Database('DB'),FILES=await mf.getR2Bucket('FILES');
for(const name of (await readdir(base+'/migrations')).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(base+'/migrations/'+name,'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));}
await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,NULL,1)').bind('qa','qa@example.invalid','qa-org','staff').run();
const {publicKey,privateKey}=await generateKeyPair('RS256');
const issuer='https://identity.cloudflareaccess.com';
// Synthetic fixture lifetime covers the expanded Windows suite; production auth limits are unchanged.
const token=await new SignJWT({email:'qa@example.invalid'}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('qa').setSubject('qa').setIssuedAt().setExpirationTime('30m').sign(privateKey);
const contractSigning=contractSigningFixture();
const stripe=stripeDeliveryProvider('qa-org');stripe.enabled=false;const worker=createWorker(publicKey,{stripeFetch:stripe.fetch});let origin;const fixtureActors=new Map([['staff',token]]);
async function addActor(id,email,role,clientId){await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,email,'qa-org',role,clientId).run();fixtureActors.set(id,await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('qa').setSubject(id).setIssuedAt().setExpirationTime('30m').sign(privateKey));}
const server=createServer(async(req,res)=>{try{let chunks=[];for await(const c of req)chunks.push(c);const headers=new Headers(req.headers);const assertion=fixtureActors.get(headers.get('x-test-actor')||'staff');if(!assertion){res.writeHead(403);res.end();return;}headers.delete('x-test-actor');headers.set('cf-access-jwt-assertion',assertion);const body=Buffer.concat(chunks);const response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers,...(body.length?{body}: {})}),{DB,FILES,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'qa',...stripe.bindings,...(contractSigning.enabled?{CONTRACT_SIGNING_POLICY:contractSigning.policy,CONTRACT_EVIDENCE_KEYS:contractSigning.keys,CONTRACT_EVIDENCE_KEY_ID:contractSigning.keyId}:{}),...(stripe.enabled?{STRIPE_WEBHOOK_SECRET:billingSigningSecret}:{})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.WORKSPACE_TEST_CHROMIUM?{executablePath:process.env.WORKSPACE_TEST_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}:{})});
try{
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(origin);await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
await page.evaluate(()=>document.fonts.ready);
assert.equal(await page.evaluate(()=>[...document.fonts].some(font=>font.family==='Plus Jakarta Sans'&&font.status==='loaded')),true,'Self-hosted UI font loads under the real response CSP');
await page.getByRole('link',{name:'Clients',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('QA client');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('QA client',{exact:true}).waitFor();
await page.getByRole('link',{name:'Projects',exact:true}).click();await page.locator('select[name=clientId]').waitFor();await page.getByLabel('Name',{exact:true}).fill('QA project');await page.locator('select[name=clientId]').selectOption({label:'QA client'});await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('QA project',{exact:true}).waitFor();
await page.getByRole('link',{name:'Tasks',exact:true}).click();await page.locator('select[name=projectId]').waitFor();await page.getByLabel('Name',{exact:true}).fill('QA task');await page.locator('select[name=projectId]').selectOption({label:'QA project'});await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('QA task',{exact:true}).waitFor();await page.getByRole('button',{name:'Edit QA task',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Name',{exact:true}).fill('QA task revised');await dialog.locator('select[name=assigneeId]').selectOption('qa');await dialog.getByLabel('Due date',{exact:true}).fill('2026-11-12');await dialog.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('QA task revised',{exact:true}).waitFor();await page.getByText('Due 2026-11-12',{exact:true}).waitFor();await page.getByRole('button',{name:'Complete task',exact:true}).click();await page.getByRole('button',{name:'Reopen task',exact:true}).waitFor();
await page.reload();await page.getByRole('button',{name:'Reopen task',exact:true}).waitFor();
await page.getByRole('link',{name:'Documents',exact:true}).click();await page.getByLabel('Content',{exact:true}).waitFor();await page.getByLabel('Name',{exact:true}).fill('QA brief');await page.locator('select[name=projectId]').selectOption({label:'QA project'});await page.getByLabel('Content',{exact:true}).fill('Synthetic test content');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Synthetic test content',{exact:true}).waitFor();
await page.getByRole('link',{name:'Time',exact:true}).click();await page.getByRole('heading',{name:'Track time',exact:true}).waitFor();await page.locator('select[name=projectId]').selectOption({label:'QA project'});await page.getByRole('button',{name:'Start timer',exact:true}).click();await page.getByRole('button',{name:'Stop timer',exact:true}).waitFor();await page.getByRole('button',{name:'Stop timer',exact:true}).click();await page.getByText('0 minutes',{exact:true}).waitFor();
await page.getByRole('link',{name:'Files',exact:true}).click();await page.getByRole('heading',{name:'Upload private file',exact:true}).waitFor();await page.locator('select[name=projectId]').selectOption({label:'QA project'});await page.getByLabel('File (maximum 5 MiB)',{exact:true}).setInputFiles({name:'synthetic-original.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic original bytes')});await page.getByRole('button',{name:'Upload file',exact:true}).click();const downloadLink=page.getByRole('link',{name:'Download synthetic-original.txt',exact:true});await downloadLink.waitFor();const [download]=await Promise.all([page.waitForEvent('download'),downloadLink.click()]);assert.equal(download.suggestedFilename(),'synthetic-original.txt');let downloaded=[];for await(const c of await download.createReadStream())downloaded.push(c);assert.equal(Buffer.concat(downloaded).toString(),'Synthetic original bytes');await page.getByRole('button',{name:'Remove synthetic-original.txt',exact:true}).click();await page.getByRole('button',{name:'Restore synthetic-original.txt',exact:true}).waitFor();assert.equal(await downloadLink.count(),0);await page.getByRole('button',{name:'Restore synthetic-original.txt',exact:true}).click();await downloadLink.waitFor();await page.reload();await downloadLink.waitFor();
const axe=await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8');
for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});await page.getByRole('link',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Reopen task',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(axe);const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>v.id);});assert.deepEqual(violations,[]);console.log(JSON.stringify({width,overflow:false,axeViolations:0}));}
for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});await page.getByRole('link',{name:'Files',exact:true}).click();await page.getByRole('heading',{name:'Upload private file',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const issues=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>v.id);});assert.deepEqual(issues,[]);}
await page.getByRole('link',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Edit QA task revised',exact:true}).waitFor();
await page.getByRole('button',{name:'Edit QA task revised',exact:true}).click();assert.equal(await page.getByRole('dialog').isVisible(),true);const modalIssues=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>v.id);});assert.deepEqual(modalIssues,[]);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Edit QA task revised');assert.equal(await page.getByRole('dialog').count(),0);
await page.goto(origin);await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').textContent(),'Skip to content');await page.keyboard.press('Enter');assert.equal(await page.locator(':focus').getAttribute('id'),'main');
assert.deepEqual(errors,[]);console.log('Browser workflow, reload, timer, keyboard, responsive and axe checks: PASS');
if(selectedSuites.has('runRegressions')){await runRegressions({browser,origin,DB});executedSuites.push('runRegressions');}
if(selectedSuites.has('runTaskBoardTests')){await runTaskBoardTests({browser,origin,DB,axe});executedSuites.push('runTaskBoardTests');}
if(selectedSuites.has('runCommentTests')){await runCommentTests({browser,origin,DB,axe,addActor});executedSuites.push('runCommentTests');}
if(selectedSuites.has('runDocumentTests')){await runDocumentTests({browser,origin,DB,axe});executedSuites.push('runDocumentTests');}
if(selectedSuites.has('runDocumentTreeTests')){await runDocumentTreeTests({browser,origin,DB,axe});executedSuites.push('runDocumentTreeTests');}
if(selectedSuites.has('runTimerTests')){await runTimerTests({browser,origin,DB,axe,addActor});executedSuites.push('runTimerTests');}
if(selectedSuites.has('runTimeReviewTests')){await runTimeReviewTests({browser,origin,DB,axe,addActor});executedSuites.push('runTimeReviewTests');}
if(selectedSuites.has('runFinanceTests')){await runFinanceTests({browser,origin,DB,axe,addActor});executedSuites.push('runFinanceTests');}
if(selectedSuites.has('runProjectWorkspaceTests')){await runProjectWorkspaceTests({browser,origin,DB,axe,addActor});executedSuites.push('runProjectWorkspaceTests');}
if(selectedSuites.has('runCompactListTests')){await runCompactListTests({browser,origin,DB,axe});executedSuites.push('runCompactListTests');}
if(selectedSuites.has('runNavigationGroupTests')){await runNavigationGroupTests({browser,origin,DB,axe,addActor});executedSuites.push('runNavigationGroupTests');}
if(selectedSuites.has('runCommercialTests')){await runCommercialTests({browser,origin,DB,axe,addActor});executedSuites.push('runCommercialTests');}
if(selectedSuites.has('runProposalReviewTests')){await runProposalReviewTests({browser,origin,DB,axe,addActor});executedSuites.push('runProposalReviewTests');}
if(selectedSuites.has('runStripeTests')){await runStripeTests({browser,origin,DB,axe,addActor,stripe});executedSuites.push('runStripeTests');}
if(selectedSuites.has('runInvoiceTests')){await runInvoiceTests({browser,origin,DB,FILES,axe,addActor,stripe});executedSuites.push('runInvoiceTests');}
if(selectedSuites.has('runRecordLinkTests')){await runRecordLinkTests({browser,origin,DB,axe,addActor,stripe});executedSuites.push('runRecordLinkTests');}
if(selectedSuites.has('runDashboardTests')){await runDashboardTests({browser,origin,DB,axe,addActor,stripe});executedSuites.push('runDashboardTests');}
if(selectedSuites.has('runContractTests')){await runContractTests({browser,origin,DB,FILES,axe,addActor,contractSigning});executedSuites.push('runContractTests');}
if(selectedSuites.has('runContractPdfTests')){await runContractPdfTests({browser,origin,DB,FILES,addActor,contractSigning});executedSuites.push('runContractPdfTests');}
if(selectedSuites.has('runStripeIssuanceTests')){await runStripeIssuanceTests({browser,origin,DB,axe,addActor,stripe});executedSuites.push('runStripeIssuanceTests');}
if(selectedSuites.has('runStripeDeliveryTests')){await runStripeDeliveryTests({browser,origin,DB,axe,addActor,stripe});executedSuites.push('runStripeDeliveryTests');}
if(selectedSuites.has('runOverviewPartTests')){await runOverviewPartTests({browser,origin,DB,axe,addActor,stripe});executedSuites.push('runOverviewPartTests');}
if(selectedSuites.has('runWorkspaceJourneyTests')){await runWorkspaceJourneyTests({browser,origin,DB,FILES,axe,addActor,stripe,contractSigning,billingSigningSecret});executedSuites.push('runWorkspaceJourneyTests');}
assert.deepEqual(executedSuites,[...selectedSuites],'Every selected browser suite must finish exactly once.');
}finally{await browser.close();await new Promise(r=>server.close(r));await mf.dispose();}
