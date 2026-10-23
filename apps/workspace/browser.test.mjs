import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {Miniflare} from 'miniflare';
import {generateKeyPair,SignJWT} from 'jose';
import {createWorker} from './dist/worker.js';
const base=new URL('.',import.meta.url).pathname;
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'qa'},cf:false});
const DB=await mf.getD1Database('DB');const sql=await readFile(base+'/migrations/0001.sql','utf8')+await readFile(base+'/migrations/0002.sql','utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));
await DB.prepare('INSERT INTO actors VALUES(?,?,?,?,NULL,1)').bind('qa','qa@example.invalid','qa-org','staff').run();
const {publicKey,privateKey}=await generateKeyPair('RS256');
const issuer='https://identity.cloudflareaccess.com';
const token=await new SignJWT({email:'qa@example.invalid'}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('qa').setSubject('qa').setIssuedAt().setExpirationTime('10m').sign(privateKey);
const worker=createWorker(publicKey);let origin;
const server=createServer(async(req,res)=>{try{let chunks=[];for await(const c of req)chunks.push(c);const headers=new Headers(req.headers);headers.set('cf-access-jwt-assertion',token);const body=Buffer.concat(chunks);const response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers,...(body.length?{body}: {})}),{DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'qa'});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});
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
await page.getByRole('link',{name:'Time',exact:true}).click();await page.locator('select[name=projectId]').selectOption({label:'QA project'});await page.getByRole('button',{name:'Start timer',exact:true}).click();await page.getByRole('button',{name:'Stop timer',exact:true}).waitFor();await page.getByRole('button',{name:'Stop timer',exact:true}).click();await page.getByText('0 minutes',{exact:true}).waitFor();
const axe=await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8');
for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});await page.getByRole('link',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Reopen task',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(axe);const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>v.id);});assert.deepEqual(violations,[]);console.log(JSON.stringify({width,overflow:false,axeViolations:0}));}
await page.getByRole('button',{name:'Edit QA task revised',exact:true}).click();assert.equal(await page.getByRole('dialog').isVisible(),true);const modalIssues=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>v.id);});assert.deepEqual(modalIssues,[]);await page.keyboard.press('Escape');assert.equal(await page.locator(':focus').textContent(),'Edit QA task revised');
await page.goto(origin);await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').textContent(),'Skip to content');await page.keyboard.press('Enter');assert.equal(await page.locator(':focus').getAttribute('id'),'main');
assert.deepEqual(errors,[]);console.log('Browser workflow, reload, timer, keyboard, responsive and axe checks: PASS');
}finally{await browser.close();await new Promise(r=>server.close(r));await mf.dispose();}
