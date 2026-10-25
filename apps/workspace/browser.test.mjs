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
const base=fileURLToPath(new URL('.',import.meta.url));
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'qa'},r2Buckets:['FILES'],cf:false});
const DB=await mf.getD1Database('DB'),FILES=await mf.getR2Bucket('FILES');
for(const name of (await readdir(base+'/migrations')).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(base+'/migrations/'+name,'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));}
await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,NULL,1)').bind('qa','qa@example.invalid','qa-org','staff').run();
const {publicKey,privateKey}=await generateKeyPair('RS256');
const issuer='https://identity.cloudflareaccess.com';
const token=await new SignJWT({email:'qa@example.invalid'}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('qa').setSubject('qa').setIssuedAt().setExpirationTime('10m').sign(privateKey);
const worker=createWorker(publicKey);let origin;const fixtureActors=new Map([['staff',token]]);
async function addActor(id,email,role,clientId){await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,?,1)').bind(id,email,'qa-org',role,clientId).run();fixtureActors.set(id,await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('qa').setSubject(id).setIssuedAt().setExpirationTime('10m').sign(privateKey));}
const server=createServer(async(req,res)=>{try{let chunks=[];for await(const c of req)chunks.push(c);const headers=new Headers(req.headers);const assertion=fixtureActors.get(headers.get('x-test-actor')||'staff');if(!assertion){res.writeHead(403);res.end();return;}headers.delete('x-test-actor');headers.set('cf-access-jwt-assertion',assertion);const body=Buffer.concat(chunks);const response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers,...(body.length?{body}: {})}),{DB,FILES,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'qa'});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.WORKSPACE_TEST_CHROMIUM?{executablePath:process.env.WORKSPACE_TEST_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}:{})});
try{
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(origin);await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
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
await page.getByRole('button',{name:'Edit QA task revised',exact:true}).click();assert.equal(await page.getByRole('dialog').isVisible(),true);const modalIssues=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>v.id);});assert.deepEqual(modalIssues,[]);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.textContent==='Edit QA task revised');assert.equal(await page.getByRole('dialog').count(),0);
await page.goto(origin);await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').textContent(),'Skip to content');await page.keyboard.press('Enter');assert.equal(await page.locator(':focus').getAttribute('id'),'main');
assert.deepEqual(errors,[]);console.log('Browser workflow, reload, timer, keyboard, responsive and axe checks: PASS');
await runRegressions({browser,origin,DB});
await runTaskBoardTests({browser,origin,DB,axe});
await runCommentTests({browser,origin,DB,axe,addActor});
await runDocumentTests({browser,origin,DB,axe});
await runDocumentTreeTests({browser,origin,DB,axe});
await runTimerTests({browser,origin,DB,axe,addActor});
await runTimeReviewTests({browser,origin,DB,axe,addActor});
await runFinanceTests({browser,origin,DB,axe,addActor});
}finally{await browser.close();await new Promise(r=>server.close(r));await mf.dispose();}
