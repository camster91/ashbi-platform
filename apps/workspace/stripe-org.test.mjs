import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {generateKeyPair,SignJWT} from 'jose';
const {createWorker}=await import(process.env.WORKSPACE_TEST_BUILT_WORKER?'./dist/worker.js':'./worker.mjs');
test('a configured Stripe account belongs to one explicit organization before any provider read',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'stripe-organization'},cf:false});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');await DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>DB.prepare(s)));}
 const {publicKey,privateKey}=await generateKeyPair('RS256'),origin='https://stripe-org.example.invalid',issuer='https://identity.cloudflareaccess.com',tokens={};
 for(const org of ['a','b']){await DB.prepare("INSERT INTO actors VALUES(?,?,?,'staff',NULL,1)").bind('fin-'+org,org+'@example.invalid',org).run();await DB.prepare('INSERT INTO actor_finance_access VALUES(?,?)').bind('fin-'+org,org).run();await DB.prepare('INSERT INTO clients(id,organization_id,name) VALUES(?,?,?)').bind('client-'+org,org,'Synthetic '+org).run();tokens[org]=await new SignJWT({email:org+'@example.invalid'}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('stripe-org').setSubject(org).setIssuedAt().setExpirationTime('10m').sign(privateKey);}
 const env={DB,APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'stripe-org',STRIPE_MODE:'test',STRIPE_ORGANIZATION_ID:'a',STRIPE_ACCOUNT_ID:'acct_fixture',STRIPE_SECRET_KEY:['sk','test','fixture'].join('_')};let calls=0;
 const worker=createWorker(publicKey,{stripeFetch:async url=>{calls++;return Response.json(url.endsWith('/account')?{id:'acct_fixture',object:'account'}:{id:'cus_fixture',object:'customer',livemode:false,name:'Account-private customer',email:'billing@example.invalid',currency:null});}});
 const call=(org,bindings=env)=>worker.fetch(new Request(origin+'/api/stripe/customers/preview',{method:'POST',headers:{origin,'content-type':'application/json','cf-access-jwt-assertion':tokens[org]},body:JSON.stringify({clientId:'client-'+org,customerId:'cus_fixture'})}),bindings);
 assert.equal((await call('b')).status,404);assert.equal(calls,0,'foreign financial actors must not access the shared provider account');
 const allowed=await call('a');assert.equal(allowed.status,200,await allowed.clone().text());assert.equal((await allowed.json()).customer.email,'billing@example.invalid');assert.equal(calls,2);
 for(const STRIPE_ORGANIZATION_ID of [undefined,'', 'a/invalid']){const before=calls;assert.equal((await call('a',{...env,STRIPE_ORGANIZATION_ID})).status,503);assert.equal(calls,before);}
});
