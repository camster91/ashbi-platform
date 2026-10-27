// Test-only, local-only recovery rehearsal. Never imported by the application.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {getPlatformProxy} from 'wrangler';
const exec=promisify(execFile),cli=fileURLToPath(new URL('./node_modules/wrangler/bin/wrangler.js',import.meta.url));
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sorted=rows=>rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));

// A fresh config and empty directory are mandatory: no account, credentials,
// env-file discovery, remote bindings or caller-selected database/bucket names.
export async function localStore(directory,{open=true}={}) {
 const path=resolve(directory);await mkdir(path,{recursive:false});
 const configPath=join(path,'wrangler.json');
 await writeFile(join(path,'fixture.mjs'),'export default {fetch(){return new Response("synthetic recovery fixture")}}');
 await writeFile(configPath,JSON.stringify({name:'ashbi-recovery-fixture',main:'fixture.mjs',compatibility_date:'2026-07-30',d1_databases:[{binding:'DB',database_name:'recovery',database_id:'00000000-0000-4000-8000-000000000001'}],r2_buckets:[{binding:'FILES',bucket_name:'recovery-files'}]}));
 let proxy;
 const store={path,configPath,env:null,async open(){assert.equal(proxy,undefined,'dispose before reopening');proxy=await getPlatformProxy({configPath,envFiles:[],persist:{path:join(path,'.wrangler','state','v3')},remoteBindings:false});store.env=proxy.env;return store;},async dispose(){if(proxy){const current=proxy;proxy=undefined;store.env=null;await current.dispose();}}};
 if(open)await store.open();return store;
}
async function command(store,args){
 // Do not inherit provider credentials into the CLI child. Each command below
 // includes --local; all names/configuration are synthetic and fixed above.
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(path|systemroot|windir|temp|tmp|home|userprofile|localappdata|appdata|comspec)$/i.test(k)));
 env.WRANGLER_SEND_METRICS='false';env.CI='true';env.NO_COLOR='1';
 return exec(process.execPath,[cli,...args,'--config',store.configPath],{cwd:store.path,env,maxBuffer:16*1024*1024,timeout:90000});
}
export async function exportDatabase(store){
 await store.dispose();
 // Native combined dumps put explicit parent UNIQUE indexes after child
 // INSERTs. Install the complete native schema first, then native data.
 // Both exports share one disposed, write-fenced local storage image.
 const image={};for(const [part,flag]of[['schema','--no-data'],['data','--no-schema']]){
  const file=join(store.path,part+'.sql');await command(store,['d1','export','recovery','--local',flag,'--output',file]);image[part]=await readFile(file,'utf8');
 }
 assert.ok(image.schema.includes('CREATE TABLE'),'native export must include schema');assert.ok(image.data.includes('INSERT INTO'),'native export must include data');return image;
}
export async function importDatabase(directory,image){
 const store=await localStore(directory,{open:false});
 try{for(const part of['schema','data']){const file=join(store.path,part+'.sql');await writeFile(file,image[part]);await command(store,['d1','execute','recovery','--local','--file',file]);}return await store.open();}catch(error){await store.dispose();throw error;}
}
export async function databaseImage(DB){
 const schema=(await DB.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND sql IS NOT NULL ORDER BY type,name").all()).results;
 const tables={};for(const entry of schema.filter(s=>s.type==='table'))tables[entry.name]=sorted((await DB.prepare('SELECT * FROM '+quote(entry.name)).all()).results);
 for(const rows of Object.values(tables))for(const row of rows)for(const value of Object.values(row))if(typeof value==='number')assert.ok(Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value)),'unsafe numeric image cannot prove fidelity');
 assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[],'foreign keys must be valid');
 assert.deepEqual((await DB.prepare('PRAGMA quick_check').all()).results,[{quick_check:'ok'}]);
 return {schema,tables};
}
export async function captureObjects(FILES){
 const objects=[];let cursor;const seen=new Set();
 do{
  const page=await FILES.list({limit:2,include:['httpMetadata','customMetadata'],...(cursor?{cursor}:{})});
  for(const item of page.objects){assert.ok(!seen.has(item.key),'duplicate object key');seen.add(item.key);const object=await FILES.get(item.key);assert.ok(object,'listed object must exist');const bytes=Buffer.from(await object.arrayBuffer());assert.equal(bytes.length,object.size);objects.push({key:item.key,size:bytes.length,sha256:hash(bytes),httpMetadata:{...object.httpMetadata,...(object.httpMetadata.cacheExpiry?{cacheExpiry:object.httpMetadata.cacheExpiry.toISOString()}:{})},customMetadata:object.customMetadata,base64:bytes.toString('base64')});}
  if(!page.truncated)break;assert.ok(page.cursor&&page.cursor!==cursor,'truncated inventory must advance');cursor=page.cursor;
 }while(true);
 return objects.sort((a,b)=>a.key.localeCompare(b.key,'en'));
}
export async function restoreObjects(FILES,objects){
 for(const object of objects){const bytes=Buffer.from(object.base64,'base64');assert.equal(bytes.length,object.size,'image length mismatch');assert.equal(hash(bytes),object.sha256,'image hash mismatch');await FILES.put(object.key,bytes,{sha256:object.sha256,httpMetadata:{...object.httpMetadata,...(object.httpMetadata.cacheExpiry?{cacheExpiry:new Date(object.httpMetadata.cacheExpiry)}:{})},customMetadata:object.customMetadata});}
 await verifyObjects(FILES,objects);
}
export async function verifyObjects(FILES,objects){assert.deepEqual(await captureObjects(FILES),objects,'complete private object image must match');}
